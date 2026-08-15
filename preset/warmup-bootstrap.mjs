/**
 * Run one visible warmup turn before the session's first real request.
 *
 * Harness plugins inject workspace instructions (AGENTS.md/CLAUDE.md), the
 * skill catalog reminder, and user-invoked skill content into the FIRST step
 * that carries messages. To keep the first model request pure, this plugin
 * turns the session's very first step into a warmup round:
 *
 *  1. When the first input of a fresh session is queued, the plugin arms a
 *     per-agent pending flag (`agent/inbox/inserted`).
 *  2. While pending, `system-prompt/assemble` narrows the assembled tool
 *     catalog to NOTHING, so the warmup step's request/header logs a
 *     tool-less request (the system prompt stays the Minimal fixed text
 *     under the `complete` persona).
 *  3. On the first `agent/pre-step`, the claimed real input is moved back to
 *     the next-turn queue and the step's messages are replaced with one
 *     synthetic warmup message. The listener is registered with
 *     `{ prepend: true }`, so it runs OUTERMOST on the waterfall — ahead of
 *     the host-plane `agent-instructions` and `tool-skill` listeners — and
 *     every downstream injection (baseline, skill catalog, skill content) is
 *     discarded with the replacement.
 *  4. The warmup turn runs through the normal loop: turn/step events, a
 *     request/header with the minimal system prompt and NO tools, the model
 *     stream, and an assistant message are all recorded in the trajectory.
 *     The real input is then processed in the following turn with the full
 *     catalog and all normal context.
 *
 * Subagent sessions run the same warmup when they start fresh: in-process
 * `spawn` children (the `subagent` tool, workflow `agent()` calls, ralph
 * rounds) have an empty log and warm up like the main session. Fork children
 * (`subagent_fork`) are seeded with the parent's completed turns, so their
 * first request can never be pure Minimal; they are never warmed up. External
 * CLI subagents (codex, claude-code) do not run the agent loop and are out of
 * scope. `subagents: false` opts every delegated child out (e.g. bulk fan-out
 * that should not pay one warmup turn per child).
 *
 * Failure is fail-soft: a route that cannot resolve, a rejected step, or an
 * abort skips the warmup and the real input proceeds unchanged.
 */

export const name = 'warmup-tool-bootstrap'

/** Prompt assembly must exist before this plugin can narrow the catalog. */
export const inject = ['systemPrompt']

const DEFAULT_MESSAGE = 'This round is a test. Tools are not open yet; all tools will open next round.'

export function apply(ctx, config) {
  const includeSubagents = config.subagents === true
  const message = typeof config.message === 'string' && config.message.length > 0 ? config.message : DEFAULT_MESSAGE

  /** Agents whose next assembly/pre-step must become the warmup round. */
  const pending = new WeakSet()

  /**
   * A session that has never logged a model request of its own and starts
   * without inherited history. Fork children seed the parent's completed
   * turns into their own log (`meta.seedLength` marks the boundary), so they
   * are never fresh; spawn children start with an empty log and warm up like
   * any fresh session unless `subagents: false` opts them out. A fork child
   * spawned before its parent completed a turn has an empty seed and is
   * indistinguishable from spawn — it warms up, which is harmless.
   */
  const freshSession = (agent) => {
    const meta = agent.session.header.meta ?? {}
    if ((meta.seedLength ?? 0) > 0) return false
    if (!includeSubagents && meta.origin === 'subagent') return false
    return !agent.session.events.some(event => event.type === 'request/header')
  }

  // Narrow the assembled tool catalog to NOTHING while the warmup is pending,
  // so the warmup step's request/header logs a tool-less request. `prepend`
  // keeps this filter outermost on the waterfall, so no later listener can
  // widen the catalog back before the request is built.
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    const agent = context.agent
    if (agent === undefined || !pending.has(agent) || !freshSession(agent)) return assembled
    return { ...assembled, tools: [] }
  }, { prepend: true })

  // Arm the warmup when the first input of a fresh session is queued. This
  // fires synchronously during the inbox splice, before the driver wakes, so
  // the very first assembly already sees the pending flag.
  ctx.on('agent/inbox/inserted', ({ agent, message }) => {
    if (agent === undefined || message === undefined || pending.has(agent)) return
    if (freshSession(agent)) pending.add(agent)
  })

  // Turn the session's very first step into the warmup round and defer the
  // real input to the next turn. The `prepend` registration is REQUIRED: the
  // host composition already registers `agent-instructions` and `tool-skill`
  // pre-step listeners at startup, so a plain (push) registration would run
  // inside them and their injections would survive our message replacement.
  // Prepend places this listener outermost on the waterfall, and the
  // replacement returned here becomes the final step decision.
  ctx.on('agent/pre-step', async ({ agent, messages, turn, step, signal }, next) => {
    const decision = await next()
    if (!pending.has(agent)) return decision
    pending.delete(agent)
    if (decision.kind === 'reject' || messages.length === 0 || !freshSession(agent)) return decision
    // Resolve the model route up front: a warmup that cannot run must not
    // consume the real input.
    const seed = { provider: agent.options.provider ?? '', model: agent.options.model ?? '' }
    let proposed
    try {
      proposed = await agent.dispatch.waterfall('agent/request', { turn, step, signal }, () => Promise.resolve(seed))
    } catch (error) {
      ctx.logger.warn('%s: route resolution failed (%s); skipping the warmup round', name, error?.message ?? String(error))
      return decision
    }
    if (signal.aborted) return decision
    if (proposed === undefined || !proposed.provider || !proposed.model) {
      ctx.logger.warn('%s: no provider/model route; skipping the warmup round', name)
      return decision
    }
    for (const claimed of messages) agent.inbox.prepend('next-turn', claimed)
    const warmup = { role: 'user', content: [{ type: 'text', text: message }], source: { kind: 'plugin', plugin: name } }
    ctx.logger.info('%s: warmup round queued as turn %d step %d; real input deferred to the next turn', name, turn, step)
    return { kind: 'enter', messages: [warmup] }
  }, { prepend: true })
}
