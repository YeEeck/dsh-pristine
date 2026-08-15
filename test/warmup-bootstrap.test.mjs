import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, inject, name } from '../preset/warmup-bootstrap.mjs'

const VALID_CONFIG = { shellTools: ['bash', 'pwsh'], commonTools: ['str_replace_editor'], subagents: false }

function makeCalls() {
  return { warn: [], info: [], prepends: [], route: [] }
}

function harness(config = {}, calls = makeCalls()) {
  const listeners = {}
  const ctx = {
    logger: {
      warn(...args) { calls.warn.push(args) },
      info(...args) { calls.info.push(args) },
    },
    on(event, callback) { listeners[event] = callback },
  }
  apply(ctx, { ...VALID_CONFIG, ...config })
  return { listeners, calls }
}

function makeAgent({ events = [], origin, provider = 'provider-x', model = 'model-y', calls, route } = {}) {
  return {
    options: { provider, model },
    session: {
      events,
      header: { meta: origin === undefined ? {} : { origin } },
    },
    dispatch: {
      waterfall: async (event, context, next) => {
        calls.route.push(event)
        return (route ?? (async (_event, _context, innerNext) => innerNext()))(event, context, next)
      },
    },
    inbox: {
      prepend(queue, message) { calls.prepends.push({ queue, message }) },
    },
  }
}

function tools(...names) {
  return names.map(n => ({ name: n }))
}

function arm(h, agent, message = { role: 'user', content: [{ type: 'text', text: 'hi' }] }) {
  h.listeners['agent/inbox/inserted']({ agent, message })
}

async function assemble(h, agent, toolList) {
  return h.listeners['system-prompt/assemble'](undefined, { agent }, async () => ({ system: 'minimal persona', tools: toolList }))
}

async function preStep(h, agent, { messages, decision, turn = 1, step = 1, signal = {} } = {}) {
  const next = async () => decision ?? { kind: 'enter', messages }
  return h.listeners['agent/pre-step']({ agent, messages, turn, step, signal }, next)
}

test('exports diagnostic plugin metadata', () => {
  assert.equal(name, 'warmup-tool-bootstrap')
  assert.deepEqual(inject, ['systemPrompt'])
})

test('rejects invalid tool-list config', () => {
  const ctx = { logger: { warn() {}, info() {} }, on() {} }
  assert.throws(
    () => apply(ctx, { ...VALID_CONFIG, shellTools: [] }),
    /shellTools must be a non-empty array of non-empty strings/,
  )
  assert.throws(
    () => apply(ctx, { ...VALID_CONFIG, commonTools: ['str_replace_editor', ''] }),
    /commonTools must be a non-empty array of non-empty strings/,
  )
})

test('a pending warmup narrows the catalog to Minimal\'s exact two tools', async () => {
  const h = harness()
  const agent = makeAgent({ calls: h.calls })
  arm(h, agent)
  const result = await assemble(h, agent, tools('bash', 'str_replace_editor', 'read', 'edit'))
  assert.equal(result.system, 'minimal persona')
  assert.deepEqual(result.tools.map(tool => tool.name), ['bash', 'str_replace_editor'])
})

test('without a pending warmup the catalog stays complete', async () => {
  const h = harness()
  const agent = makeAgent({ calls: h.calls })
  const result = await assemble(h, agent, tools('bash', 'read', 'edit'))
  assert.deepEqual(result.tools.map(tool => tool.name), ['bash', 'read', 'edit'])
})

test('two available shells fail soft to the full catalog', async () => {
  const h = harness()
  const agent = makeAgent({ calls: h.calls })
  arm(h, agent)
  const result = await assemble(h, agent, tools('bash', 'pwsh', 'read', 'edit'))
  assert.deepEqual(result.tools.map(tool => tool.name), ['bash', 'pwsh', 'read', 'edit'])
  assert.equal(h.calls.warn.length, 1)
})

test('a missing common tool fails soft to the full catalog', async () => {
  const h = harness()
  const agent = makeAgent({ calls: h.calls })
  arm(h, agent)
  const result = await assemble(h, agent, tools('bash', 'edit'))
  assert.deepEqual(result.tools.map(tool => tool.name), ['bash', 'edit'])
  assert.equal(h.calls.warn.length, 1)
})

test('subagent sessions do not arm the warmup by default', async () => {
  const h = harness()
  const agent = makeAgent({ calls: h.calls, origin: 'subagent' })
  arm(h, agent)
  const result = await assemble(h, agent, tools('bash', 'read', 'edit'))
  assert.deepEqual(result.tools.map(tool => tool.name), ['bash', 'read', 'edit'])
  assert.equal(h.calls.warn.length, 0)
})

test('subagents: true arms subagent sessions too', async () => {
  const h = harness({ subagents: true })
  const agent = makeAgent({ calls: h.calls, origin: 'subagent' })
  arm(h, agent)
  const result = await assemble(h, agent, tools('bash', 'str_replace_editor', 'edit'))
  assert.deepEqual(result.tools.map(tool => tool.name), ['bash', 'str_replace_editor'])
})

test('an insert without a message does not arm', async () => {
  const h = harness()
  const agent = makeAgent({ calls: h.calls })
  h.listeners['agent/inbox/inserted']({ agent })
  const result = await assemble(h, agent, tools('bash', 'read', 'edit'))
  assert.deepEqual(result.tools.map(tool => tool.name), ['bash', 'read', 'edit'])
})

test('a resumed session does not arm the warmup', async () => {
  const h = harness()
  const agent = makeAgent({ calls: h.calls, events: [{ type: 'request/header' }] })
  arm(h, agent)
  const result = await assemble(h, agent, tools('bash', 'read', 'edit'))
  assert.deepEqual(result.tools.map(tool => tool.name), ['bash', 'read', 'edit'])
})

test('the pending first step becomes the warmup round and defers the real input', async () => {
  const h = harness({ message: 'Custom warm-up instructions.' })
  const agent = makeAgent({ calls: h.calls })
  const claimed = [{ role: 'user', content: [{ type: 'text', text: 'real request' }] }]
  arm(h, agent, claimed[0])
  const result = await preStep(h, agent, { messages: claimed })
  assert.equal(result.kind, 'enter')
  assert.equal(result.messages.length, 1)
  const [warmup] = result.messages
  assert.equal(warmup.role, 'user')
  assert.deepEqual(warmup.content, [{ type: 'text', text: 'Custom warm-up instructions.' }])
  assert.deepEqual(warmup.source, { kind: 'plugin', plugin: name })
  assert.deepEqual(h.calls.prepends, [{ queue: 'next-turn', message: claimed[0] }])
  assert.deepEqual(h.calls.route, ['agent/request'])
  assert.ok(h.calls.info.some(args => String(args[0]).includes('warmup round queued')))
})

test('the warmup uses the default message when none is configured', async () => {
  const h = harness()
  const agent = makeAgent({ calls: h.calls })
  const claimed = [{ role: 'user', content: [{ type: 'text', text: 'real request' }] }]
  arm(h, agent, claimed[0])
  const result = await preStep(h, agent, { messages: claimed })
  assert.equal(
    result.messages[0].content[0].text,
    'This round is a test. Tools are not open yet; all tools will open next round.',
  )
})

test('the default warmup message names no specific tool or command', async () => {
  const h = harness()
  const agent = makeAgent({ calls: h.calls })
  const claimed = [{ role: 'user', content: [{ type: 'text', text: 'real request' }] }]
  arm(h, agent, claimed[0])
  const result = await preStep(h, agent, { messages: claimed })
  const text = result.messages[0].content[0].text
  assert.ok(!text.includes('`'), 'message must not contain code spans')
  assert.ok(!/\bpwd\b|\bgit\b|\brun\b/i.test(text), 'message must not name shell commands')
  assert.ok(!/\bbash\b|\bpwsh\b|\bstr_replace_editor\b|\bread\b/i.test(text), 'message must not name specific tools')
  assert.ok(!/\buse the available\b/i.test(text), 'message must not steer tool use')
})

test('the route seed carries the agent provider and model', async () => {
  const h = harness()
  let seen
  const agent = makeAgent({
    calls: h.calls,
    provider: 'route-p',
    model: 'route-m',
    route: async (_event, _context, next) => { seen = await next(); return seen },
  })
  const claimed = [{ role: 'user', content: [{ type: 'text', text: 'real request' }] }]
  arm(h, agent, claimed[0])
  await preStep(h, agent, { messages: claimed })
  assert.deepEqual(seen, { provider: 'route-p', model: 'route-m' })
})

test('a step without a pending warmup passes through unchanged', async () => {
  const h = harness()
  const agent = makeAgent({ calls: h.calls })
  const decision = { kind: 'enter', messages: [{ role: 'user' }] }
  const result = await preStep(h, agent, { messages: decision.messages, decision })
  assert.deepEqual(result, decision)
  assert.equal(h.calls.prepends.length, 0)
})

test('a rejected first step skips the warmup', async () => {
  const h = harness()
  const agent = makeAgent({ calls: h.calls })
  const claimed = [{ role: 'user', content: [{ type: 'text', text: 'real request' }] }]
  arm(h, agent, claimed[0])
  const decision = { kind: 'reject', reason: 'blocked' }
  const result = await preStep(h, agent, { messages: claimed, decision })
  assert.deepEqual(result, decision)
  assert.equal(h.calls.prepends.length, 0)
})

test('an empty message list skips the warmup', async () => {
  const h = harness()
  const agent = makeAgent({ calls: h.calls })
  const claimed = [{ role: 'user', content: [{ type: 'text', text: 'real request' }] }]
  arm(h, agent, claimed[0])
  const decision = { kind: 'enter', messages: [] }
  const result = await preStep(h, agent, { messages: [], decision })
  assert.deepEqual(result, decision)
  assert.equal(h.calls.prepends.length, 0)
})

test('a failed route resolution skips the warmup', async () => {
  const h = harness()
  const agent = makeAgent({ calls: h.calls, route: async () => { throw new Error('route down') } })
  const claimed = [{ role: 'user', content: [{ type: 'text', text: 'real request' }] }]
  arm(h, agent, claimed[0])
  const decision = { kind: 'enter', messages: claimed }
  const result = await preStep(h, agent, { messages: claimed, decision })
  assert.deepEqual(result, decision)
  assert.equal(h.calls.prepends.length, 0)
  assert.equal(h.calls.warn.length, 1)
})

test('a route without provider or model skips the warmup', async () => {
  const h = harness()
  const agent = makeAgent({ calls: h.calls, provider: '', model: '' })
  const claimed = [{ role: 'user', content: [{ type: 'text', text: 'real request' }] }]
  arm(h, agent, claimed[0])
  const decision = { kind: 'enter', messages: claimed }
  const result = await preStep(h, agent, { messages: claimed, decision })
  assert.deepEqual(result, decision)
  assert.equal(h.calls.prepends.length, 0)
})

test('an aborted signal skips the warmup', async () => {
  const h = harness()
  const agent = makeAgent({ calls: h.calls })
  const claimed = [{ role: 'user', content: [{ type: 'text', text: 'real request' }] }]
  arm(h, agent, claimed[0])
  const decision = { kind: 'enter', messages: claimed }
  const result = await preStep(h, agent, { messages: claimed, decision, signal: { aborted: true } })
  assert.deepEqual(result, decision)
  assert.equal(h.calls.prepends.length, 0)
})

test('the warmup is single-shot: the following step passes through', async () => {
  const h = harness()
  const agent = makeAgent({ calls: h.calls })
  const claimed = [{ role: 'user', content: [{ type: 'text', text: 'real request' }] }]
  arm(h, agent, claimed[0])
  await preStep(h, agent, { messages: claimed })
  const result = await assemble(h, agent, tools('bash', 'read', 'edit'))
  assert.deepEqual(result.tools.map(tool => tool.name), ['bash', 'read', 'edit'])
})
