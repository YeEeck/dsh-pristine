import assert from 'node:assert/strict'
import test from 'node:test'

import {
  WindowsProcessInspector,
  createWindowsTerminalSubprocessPlugin,
  parseWindowsProcessTable,
  queryWindowsProcessTable,
} from '../preset/windows-subprocess.mjs'

test('parses a single-row PowerShell process snapshot', () => {
  const rows = parseWindowsProcessTable('{"ProcessId":12,"ParentProcessId":4,"CreationDate":"20260816010203"}')

  assert.deepEqual(rows, [{ pid: 12, parentPid: 4, started: '20260816010203' }])
})

test('parses a multi-row snapshot and drops malformed rows', () => {
  const rows = parseWindowsProcessTable(JSON.stringify([
    { ProcessId: 1, ParentProcessId: 0, CreationDate: 'a' },
    { ProcessId: 'bad', ParentProcessId: 0, CreationDate: 'b' },
    { ProcessId: 2, ParentProcessId: 1, CreationDate: 'c' },
  ]))

  assert.deepEqual(rows, [
    { pid: 1, parentPid: 0, started: 'a' },
    { pid: 2, parentPid: 1, started: 'c' },
  ])
})

test('queryWindowsProcessTable runs the supplied PowerShell query', () => {
  const calls = []
  const rows = queryWindowsProcessTable({
    executable: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    run: (executable, args) => {
      calls.push({ executable, args })
      return JSON.stringify([{ ProcessId: 7, ParentProcessId: 1, CreationDate: 'now' }])
    },
  })

  assert.deepEqual(rows, [{ pid: 7, parentPid: 1, started: 'now' }])
  assert.equal(calls[0].executable, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  assert.match(calls[0].args.join(' '), /Get-CimInstance Win32_Process/)
})

test('processTree returns descendants children-first and caches snapshots', () => {
  const rows = [
    { pid: 1, parentPid: 0, started: 'a' },
    { pid: 2, parentPid: 1, started: 'b' },
    { pid: 3, parentPid: 2, started: 'c' },
    { pid: 4, parentPid: 1, started: 'd' },
  ]
  let now = 1000
  let reads = 0
  const inspector = new WindowsProcessInspector({
    processTable: () => {
      reads += 1
      return rows
    },
    now: () => now,
  })

  assert.deepEqual(inspector.processTree(1).map(row => row.pid), [3, 2, 4, 1])
  assert.equal(reads, 1)
  inspector.processTree(1)
  assert.equal(reads, 1)
  now += inspector.ttlMs
  inspector.processTree(1)
  assert.equal(reads, 2)
})

test('processTree degrades to empty when the snapshot fails', () => {
  const inspector = new WindowsProcessInspector({
    processTable: () => {
      throw new Error('powerShell unavailable')
    },
  })

  assert.deepEqual(inspector.processTree(1), [])
})

test('Windows inspector publishes the shell pid as the foreground group', () => {
  const inspector = new WindowsProcessInspector({ processTable: () => [] })

  assert.equal(inspector.foregroundPgid(123), 123)
  assert.equal(inspector.foregroundPgid(-1), undefined)
  assert.equal(inspector.isStdinWaiting(123), false)
  assert.deepEqual(inspector.processSession(123), [])
  assert.equal(inspector.isAlive({ pid: process.pid, started: 'now' }), true)
})

test('SIGINT is delivered as Ctrl-C to the attached terminal', () => {
  const signals = []
  const inspector = new WindowsProcessInspector({
    processTable: () => [],
    signal: (pid, signal) => signals.push({ pid, signal }),
  })
  const terminal = {
    writes: [],
    write(data) {
      this.writes.push(data)
    },
  }
  inspector.attach(terminal)

  inspector.signalGroup(7, 'SIGINT')
  assert.deepEqual(terminal.writes, ['\x03'])
  assert.deepEqual(signals, [])

  inspector.attach(undefined)
  inspector.signalGroup(7, 'SIGINT')
  assert.deepEqual(signals, [])

  inspector.signalGroup(7, 'SIGKILL')
  assert.deepEqual(signals, [{ pid: 7, signal: 'SIGKILL' }])
})

test('createWindowsTerminalSubprocessPlugin installs a fresh inspector per terminal', async () => {
  class FakeRuntime {
    constructor(ctx, config) {
      this.ctx = ctx
      this.config = config
      this.terminalInspector = undefined
    }

    async spawnTerminal(spec) {
      this.spec = spec
      return {
        terminal: {
          writes: [],
          write(data) {
            this.writes.push(data)
          },
        },
      }
    }
  }

  const Plugin = createWindowsTerminalSubprocessPlugin(FakeRuntime)
  assert.equal(Plugin.name, 'WindowsTerminalSubprocessRuntime')

  const ctx = {}
  const instance = new Plugin(ctx, { probe: true })
  assert.equal(instance.ctx, ctx)
  assert.ok(instance.terminalInspector instanceof WindowsProcessInspector)

  const handle = await instance.spawnTerminal({ argv: ['bash.exe'] })
  assert.equal(instance.terminalInspector.terminal, handle.terminal)
  instance.terminalInspector.signalGroup(9, 'SIGINT')
  assert.deepEqual(handle.terminal.writes, ['\x03'])
})
