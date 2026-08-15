# Pristine Context

Domain glossary for the `dsh-pristine` preset: the warmup flow and the session
vocabulary around it. Terms are resolved during design sessions; this file
records vocabulary, not implementation.

## Language

**Warmup round**:
The first visible turn of a fresh session, whose model request carries only
the fixed Minimal system prompt and no tools.
_Avoid_: test round, bootstrap round, calibration round

**Fresh session**:
A session that starts without inherited history and has never logged a model
request of its own; only fresh sessions run a warmup round.
_Avoid_: new session (ambiguous with resumed sessions)

**Spawn child**:
An in-process delegated session that starts from an empty log — the `subagent`
tool, workflow `agent()` calls, and ralph rounds all ride the spawn backend. A
spawn child is a fresh session and warms up like the main session.
_Avoid_: subagent (ambiguous), background child

**Fork child**:
An in-process delegated session created with the delegating session's
completed turns (its inherited history). Its first request replays that
history, so a pure Minimal state is unachievable and it never warms up.
_Avoid_: subagent (ambiguous), context-inheriting child

**Inherited history**:
The completed-turn prefix a fork child is created with, separating what the
child inherited from what it owns. A fork child with an empty inherited history
is indistinguishable from a spawn child and warms up, which is harmless.

**Delegated child**:
Any session created by another session's delegation. The `subagents` preset
option decides whether delegated children participate in the warmup flow;
external CLI subagents (codex, claude-code) are not agent sessions at all and
are out of scope.
_Avoid_: subagent (ambiguous between spawn and fork)
