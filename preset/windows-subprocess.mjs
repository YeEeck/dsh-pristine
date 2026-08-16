/**
 * Windows terminal support for the pristine preset's persistent bash stack.
 *
 * The harness's `@deepseek-ai/dsh-subprocess-local` only ships process-table
 * inspectors for Linux and macOS; its first terminal spawn on win32 fails with
 * `terminal inspection is unsupported on platform win32`. This module fills
 * that gap for Git Bash/WSL:
 *
 * - `WindowsProcessInspector` implements the inspector seam over PowerShell's
 *   `Win32_Process` table, with `taskkill` for tree teardown.
 * - `createWindowsTerminalSubprocessPlugin()` wraps the harness's local
 *   subprocess runtime, installing that inspector per terminal and wiring
 *   SIGINT to a Ctrl-C byte on the ConPTY input stream.
 *
 * The wrapped runtime is mounted INSIDE the preset's `windows-shell` group
 * (the group isolates `subprocess`), so the host subprocess service stays
 * unmodified.
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { win32 } from 'node:path'

const join = win32.join

/** Seconds a Win32_Process snapshot stays usable for descendant tracking. */
const PROCESS_TABLE_TTL_MS = 2000

const PROCESS_QUERY = [
  '$ErrorActionPreference = "Stop"',
  'Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CreationDate | ConvertTo-Json -Compress',
].join('; ')

function systemExecutable(env, exists, systemRoot, name) {
  const root = systemRoot || env.SystemRoot || env.windir || 'C:\\Windows'
  const candidate = join(root, 'System32', name)
  return exists(candidate) ? candidate : name
}

function powershellExecutable(env = process.env, exists = existsSync) {
  const root = env.SystemRoot || env.windir || 'C:\\Windows'
  const candidate = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return exists(candidate) ? candidate : 'powershell.exe'
}

function taskkillExecutable(env = process.env, exists = existsSync) {
  const root = env.SystemRoot || env.windir || 'C:\\Windows'
  return systemExecutable(env, exists, root, 'taskkill.exe')
}

/**
 * Parse one PowerShell `ConvertTo-Json` process snapshot into rows.
 * @param text - JSON output from the Win32_Process query.
 * @returns pid/parentPid/started rows, malformed rows dropped.
 */
export function parseWindowsProcessTable(text) {
  if (typeof text !== 'string' || text.trim().length === 0) return []
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  const result = []
  for (const row of rows) {
    const pid = Number(row?.ProcessId)
    const parentPid = Number(row?.ParentProcessId)
    if (!Number.isSafeInteger(pid) || pid <= 0) continue
    result.push({
      pid,
      parentPid: Number.isSafeInteger(parentPid) ? parentPid : 0,
      started: String(row?.CreationDate ?? ''),
    })
  }
  return result
}

/** Read one Win32_Process snapshot through PowerShell. */
export function queryWindowsProcessTable({ executable = powershellExecutable(), run = execFileSync } = {}) {
  const text = run(executable, ['-NoProfile', '-NonInteractive', '-NoLogo', '-Command', PROCESS_QUERY], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10000,
    maxBuffer: 10 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  return parseWindowsProcessTable(text)
}

/** Terminate one Windows process tree; `taskkill /T /F` on SIGKILL. */
function signalWindowsProcess(pid, signal, env = process.env, run = execFileSync, exists = existsSync) {
  const args = ['/PID', String(pid), '/T']
  if (signal === 'SIGKILL') args.push('/F')
  try {
    run(taskkillExecutable(env, exists), args, {
      windowsHide: true,
      timeout: 10000,
      stdio: 'ignore',
    })
  } catch {
    // The process (or its tree) already exited; taskkill has nothing to kill.
  }
}

/**
 * Process inspector for ConPTY-backed Windows shells.
 *
 * ConPTY has no POSIX process-group concept, so the shell pid is published as
 * the foreground group and stdin-wait detection is deliberately `false`: the
 * persistent-bash backend falls back to its prompt/idle inference, which is
 * the supported behavior for this platform.
 */
export class WindowsProcessInspector {
  constructor(options = {}) {
    this.processTable = options.processTable
      ?? (() => queryWindowsProcessTable({
        executable: options.powershell ?? powershellExecutable(),
        run: options.run ?? execFileSync,
      }))
    this.signal = options.signal ?? signalWindowsProcess
    this.now = options.now ?? Date.now
    this.ttlMs = options.ttlMs ?? PROCESS_TABLE_TTL_MS
    this.cached = null
    this.cachedAt = -Infinity
    this.terminal = undefined
  }

  attach(terminal) {
    this.terminal = terminal
  }

  table() {
    const now = this.now()
    if (this.cached === null || now - this.cachedAt >= this.ttlMs) {
      try {
        this.cached = this.processTable()
      } catch {
        // The process table only refines descendant tracking; ConPTY teardown
        // still works without it, so a failed snapshot must not break the shell.
        this.cached = []
      }
      this.cachedAt = now
    }
    return this.cached
  }

  foregroundPgid(shellPid) {
    return Number.isSafeInteger(shellPid) && shellPid > 0 ? shellPid : undefined
  }

  isStdinWaiting(_pgid) {
    return false
  }

  processTree(rootPid) {
    const children = new Map()
    const roots = new Map()
    for (const row of this.table()) {
      if (row.pid === rootPid) {
        roots.set(row.pid, row)
        continue
      }
      const siblings = children.get(row.parentPid) ?? []
      siblings.push(row)
      children.set(row.parentPid, siblings)
    }
    const result = []
    const visit = (row) => {
      for (const child of children.get(row.pid) ?? []) visit(child)
      result.push({
        pid: row.pid,
        started: row.started,
      })
    }
    const root = roots.get(rootPid)
    if (root !== undefined) visit(root)
    return result
  }

  processSession(_sessionId) {
    return []
  }

  isAlive(identity) {
    try {
      process.kill(identity.pid, 0)
      return true
    } catch {
      return false
    }
  }

  signalGroup(pgid, signal) {
    if (signal === 'SIGINT') {
      if (this.terminal && typeof this.terminal.write === 'function') this.terminal.write('\x03')
      // Without an attached ConPTY there is no safe Windows Ctrl-C delivery;
      // never escalate an interrupt into killing the persistent shell.
      return
    }
    this.signalProcess({ pid: pgid, started: String(pgid) }, signal)
  }

  signalProcess(identity, signal) {
    try {
      this.signal(identity.pid, signal)
    } catch {
      // Signaling an already-exited process is not an error.
    }
  }
}

/**
 * Subclass the harness's local subprocess runtime with Windows terminal
 * inspection. Each terminal spawn installs a fresh inspector so SIGINT can
 * reach that terminal's own ConPTY input.
 */
export function createWindowsTerminalSubprocessPlugin(LocalSubprocessRuntime, options = {}) {
  const inspectorFactory = options.inspectorFactory
    ?? (() => new WindowsProcessInspector(options))

  return class WindowsTerminalSubprocessRuntime extends LocalSubprocessRuntime {
    constructor(ctx, config) {
      super(ctx)
      this.terminalInspector = inspectorFactory()
    }

    async spawnTerminal(spec) {
      const inspector = inspectorFactory()
      this.terminalInspector = inspector
      const handle = await super.spawnTerminal(spec)
      inspector.attach(handle?.terminal)
      return handle
    }
  }
}
