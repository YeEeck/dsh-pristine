import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, createPwshHidingAssemblyFilter, inject, name, resolveWindowsShell } from '../preset/windows-shell.mjs'

const WIN_ENV = {
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
  USERPROFILE: 'C:\\Users\\me',
  SystemRoot: 'C:\\Windows',
  PATH: 'C:\\Windows\\System32;C:\\Program Files\\Git\\bin',
}

function existsIn(set) {
  return (path) => set.has(path)
}

test('exports plugin metadata', () => {
  assert.equal(name, 'windows-shell-bootstrap')
  assert.deepEqual(inject, ['systemPrompt'])
})

test('defaults to git-bash and resolves a common installation path', () => {
  const existing = new Set(['C:\\Program Files\\Git\\bin\\bash.exe'])
  const result = resolveWindowsShell({}, WIN_ENV, existsIn(existing))

  assert.equal(result.kind, 'bash')
  assert.equal(result.backendType, 'git-bash')
  assert.equal(result.shellPath, 'C:\\Program Files\\Git\\bin\\bash.exe')
  assert.deepEqual(result.shellArgs, ['--noprofile', '--norc', '-i'])
  assert.match(result.description, /Git Bash/)
})

test('honors an explicit gitBashPath override', () => {
  const existing = new Set(['D:\\Custom\\Git\\bin\\bash.exe'])
  const result = resolveWindowsShell(
    { windowsShell: 'git-bash', gitBashPath: 'D:\\Custom\\Git\\bin\\bash.exe' },
    WIN_ENV,
    existsIn(existing),
  )

  assert.equal(result.kind, 'bash')
  assert.equal(result.shellPath, 'D:\\Custom\\Git\\bin\\bash.exe')
})

test('falls back to pwsh when git-bash is not installed', () => {
  const result = resolveWindowsShell({ windowsShell: 'git-bash' }, WIN_ENV, () => false)

  assert.deepEqual(result, { kind: 'pwsh' })
})

test('resolves wsl with the default distribution', () => {
  const existing = new Set(['C:\\Windows\\System32\\wsl.exe'])
  const result = resolveWindowsShell({ windowsShell: 'wsl' }, WIN_ENV, existsIn(existing))

  assert.equal(result.kind, 'bash')
  assert.equal(result.backendType, 'wsl')
  assert.equal(result.shellPath, 'wsl.exe')
  assert.deepEqual(result.shellArgs, ['--', 'bash', '--noprofile', '--norc', '-i'])
  assert.match(result.description, /WSL/)
})

test('resolves wsl with an explicit distribution', () => {
  const existing = new Set(['C:\\Windows\\System32\\wsl.exe'])
  const result = resolveWindowsShell(
    { windowsShell: 'wsl', wslDistro: 'Ubuntu' },
    WIN_ENV,
    existsIn(existing),
  )

  assert.equal(result.kind, 'bash')
  assert.equal(result.backendType, 'wsl')
  assert.deepEqual(result.shellArgs, ['-d', 'Ubuntu', '--', 'bash', '--noprofile', '--norc', '-i'])
})

test('falls back to pwsh when wsl is unavailable', () => {
  const result = resolveWindowsShell({ windowsShell: 'wsl' }, WIN_ENV, () => false)

  assert.deepEqual(result, { kind: 'pwsh' })
})

test('falls back to pwsh for an unsupported windowsShell value', () => {
  const result = resolveWindowsShell({ windowsShell: 'cmd' }, WIN_ENV, () => true)

  assert.deepEqual(result, { kind: 'pwsh' })
})

test('explicit pwsh stays on pwsh', () => {
  const result = resolveWindowsShell({ windowsShell: 'pwsh' }, WIN_ENV, () => true)

  assert.deepEqual(result, { kind: 'pwsh' })
})

test('assembly filter hides pwsh when a bash variant is active', async () => {
  const filter = createPwshHidingAssemblyFilter(true)
  const assembled = await filter(undefined, {}, async () => ({
    tools: [{ name: 'bash' }, { name: 'pwsh' }, { name: 'read' }],
    sections: [{ name: 'tool:pwsh' }, { name: 'persona' }],
  }))

  assert.deepEqual(assembled.tools.map(tool => tool.name), ['bash', 'read'])
  assert.deepEqual(assembled.sections.map(section => section.name), ['persona'])
})

test('assembly filter keeps pwsh when pwsh is active', async () => {
  const filter = createPwshHidingAssemblyFilter(false)
  const assembled = await filter(undefined, {}, async () => ({
    tools: [{ name: 'bash' }, { name: 'pwsh' }, { name: 'read' }],
  }))

  assert.deepEqual(assembled.tools.map(tool => tool.name), ['bash', 'pwsh', 'read'])
})

test('apply with explicit pwsh does not warn or mount a bash stack', async () => {
  const calls = { warn: [], listeners: {} }
  const ctx = {
    logger: { warn: (...args) => calls.warn.push(args) },
    on: (event, callback) => { calls.listeners[event] = callback },
  }

  await apply(ctx, { windowsShell: 'pwsh' })

  assert.equal(calls.warn.length, 0)
  assert.equal(typeof calls.listeners['system-prompt/assemble'], 'function')
})

test('apply warns when a configured bash variant is unavailable', async () => {
  const calls = { warn: [], listeners: {} }
  const ctx = {
    logger: { warn: (...args) => calls.warn.push(args) },
    on: (event, callback) => { calls.listeners[event] = callback },
  }

  await apply(ctx, { windowsShell: 'git-bash', gitBashPath: 'Z:\\definitely\\missing\\bash.exe' })

  assert.equal(calls.warn.length, 1)
  assert.match(String(calls.warn[0][0]), /falling back to pwsh/)
  assert.equal(typeof calls.listeners['system-prompt/assemble'], 'function')
})

test('apply falls back to pwsh when mounting the bash stack fails', async () => {
  const calls = { warn: [], listeners: {} }
  const ctx = {
    logger: { warn: (...args) => calls.warn.push(args) },
    on: (event, callback) => { calls.listeners[event] = callback },
    loader: {
      import: async () => { throw new Error('mount exploded') },
      unwrapExports: (exports) => exports,
    },
  }

  await apply(ctx, { windowsShell: 'git-bash', gitBashPath: process.cwd() })

  assert.equal(calls.warn.length, 1)
  assert.match(String(calls.warn[0][0]), /failed to mount git-bash bash stack/)
  const filter = calls.listeners['system-prompt/assemble']
  const assembled = await filter(undefined, {}, async () => ({
    tools: [{ name: 'bash' }, { name: 'pwsh' }, { name: 'read' }],
  }))
  assert.deepEqual(assembled.tools.map(tool => tool.name), ['bash', 'pwsh', 'read'])
})
