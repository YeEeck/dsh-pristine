/**
 * Windows shell selection for the pristine preset.
 *
 * On Windows the preset can expose either the one-shot `pwsh` tool or a
 * persistent `bash` tool backed by Git Bash or WSL. This plugin resolves the
 * configured choice, dynamically mounts the persistent bash stack when a bash
 * variant is selected, and keeps `pwsh` out of the model-visible catalog while
 * that bash stack is active.
 *
 * The plugin intentionally has no top-level `@deepseek-ai/*` imports: preset
 * plugin files live under the user's home and cannot resolve the harness's
 * node_modules. The shell packages are imported lazily only when a bash
 * variant is actually selected, through the owning entry tree — the same
 * host-anchored resolution path the preset's own `@deepseek-ai/*` rows use.
 */

import { existsSync } from 'node:fs'
import { win32 } from 'node:path'

const join = win32.join

/** Cordis plugin name used by loader diagnostics. */
export const name = 'windows-shell-bootstrap'

/** Prompt assembly must exist before the pwsh-hiding filter can register. */
export const inject = ['systemPrompt']

const GIT_BASH_DESCRIPTION = `Run commands in a persistent bash shell (Git Bash on Windows)
* When invoking this tool, the contents of the "command" parameter does NOT need to be XML-escaped.
* State is persistent across command calls and discussions with the user.
* Paths use Windows-native form (C:\\...), but commands use bash syntax.
* You don't have access to the internet via this tool.`

const WSL_DESCRIPTION = `Run commands in a persistent bash shell (WSL on Windows)
* When invoking this tool, the contents of the "command" parameter does NOT need to be XML-escaped.
* State is persistent across command calls and discussions with the user.
* Paths use Linux form; Windows files are typically under /mnt/c/...
* You don't have access to the internet via this tool.`

/** Common Git for Windows installation locations. */
function candidateGitBashPaths(env = process.env) {
  const programFiles = env.ProgramFiles || 'C:\\Program Files'
  const programFilesX86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  const localAppData = env.LOCALAPPDATA || ''
  const userProfile = env.USERPROFILE || ''

  const paths = [
    join(programFiles, 'Git', 'bin', 'bash.exe'),
    join(programFilesX86, 'Git', 'bin', 'bash.exe'),
  ]
  if (localAppData) paths.push(join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe'))
  if (userProfile) paths.push(join(userProfile, 'scoop', 'apps', 'git', 'current', 'bin', 'bash.exe'))
  return paths
}

function resolveGitBashPath(config, env, exists) {
  const explicit = config.gitBashPath
  if (typeof explicit === 'string' && explicit.trim().length > 0 && exists(explicit)) {
    return explicit
  }
  return candidateGitBashPaths(env).find(exists) ?? null
}

function isWslAvailable(env, exists) {
  const systemRoot = env.SystemRoot || env.windir || 'C:\\Windows'
  if (exists(join(systemRoot, 'System32', 'wsl.exe'))) return true
  const pathEntries = typeof env.PATH === 'string' ? env.PATH.split(';') : []
  return pathEntries.some(entry => entry.trim().length > 0 && exists(join(entry, 'wsl.exe')))
}

function normalizeWindowsShell(config) {
  return String(config.windowsShell ?? 'git-bash').trim().toLowerCase()
}

/**
 * Resolve the effective Windows shell from preset config.
 *
 * @returns `{ kind: 'bash', backendType, shellPath, shellArgs, description }`
 * for a usable Git Bash or WSL, or `{ kind: 'pwsh' }` for pwsh/fallback.
 */
export function resolveWindowsShell(config = {}, env = process.env, exists = existsSync) {
  const requested = normalizeWindowsShell(config)

  if (requested === 'pwsh') return { kind: 'pwsh' }

  if (requested === 'git-bash') {
    const shellPath = resolveGitBashPath(config, env, exists)
    if (shellPath) {
      return {
        kind: 'bash',
        backendType: 'git-bash',
        shellPath,
        shellArgs: ['--noprofile', '--norc', '-i'],
        description: GIT_BASH_DESCRIPTION,
      }
    }
    return { kind: 'pwsh' }
  }

  if (requested === 'wsl') {
    if (isWslAvailable(env, exists)) {
      const distro = typeof config.wslDistro === 'string' && config.wslDistro.trim().length > 0
        ? config.wslDistro.trim()
        : null
      return {
        kind: 'bash',
        backendType: 'wsl',
        shellPath: 'wsl.exe',
        shellArgs: distro
          ? ['-d', distro, '--', 'bash', '--noprofile', '--norc', '-i']
          : ['--', 'bash', '--noprofile', '--norc', '-i'],
        description: WSL_DESCRIPTION,
      }
    }
    return { kind: 'pwsh' }
  }

  return { kind: 'pwsh' }
}

/**
 * Import a harness package through the loader tree that owns this plugin.
 *
 * `ctx.loader.import()` would be wrong here: `ctx.loader` is the ROOT loader
 * traced to the calling context, so a bare specifier resolves from this
 * plugin's `ctx.baseUrl` — the preset directory under the user's home, where
 * the harness's node_modules is unreachable. The owning entry's tree is the
 * preset include tree, whose `import()` resolves bare specifiers from the
 * host base recorded at mount time (the same path every `@deepseek-ai/*`
 * row in `agent.cordis.yml` uses). Falls back to `ctx.loader.import()` for
 * non-entry contexts such as unit tests.
 */
function importHarnessModule(ctx, specifier) {
  const entryTree = ctx.fiber?.entry?.parent?.tree
  if (entryTree && typeof entryTree.import === 'function') {
    return entryTree.import(specifier)
  }
  return ctx.loader.import(specifier)
}

/**
 * Build the system-prompt assembly filter that hides `pwsh` while a bash
 * variant is the active Windows shell.
 */
export function createPwshHidingAssemblyFilter(hidePwsh) {
  return async (_assembly, _context, next) => {
    const assembled = await next()
    if (!hidePwsh) return assembled
    const filtered = {
      ...assembled,
      tools: assembled.tools.filter(tool => tool.name !== 'pwsh'),
    }
    if (Array.isArray(assembled.sections)) {
      filtered.sections = assembled.sections.filter(section => section?.name !== 'tool:pwsh')
    }
    return filtered
  }
}

/** Cordis plugin entry: mount the selected Windows shell stack. */
export async function apply(ctx, config = {}) {
  const resolved = resolveWindowsShell(config)
  const requested = normalizeWindowsShell(config)
  let hidePwsh = resolved.kind === 'bash'

  if (resolved.kind === 'pwsh' && requested !== 'pwsh') {
    ctx.logger?.warn(`windows-shell: ${requested} is unavailable or invalid; falling back to pwsh`)
  }

  if (hidePwsh) {
    try {
      const load = async (specifier) => ctx.loader.unwrapExports(await importHarnessModule(ctx, specifier))
      const terminal = await load('@deepseek-ai/dsh-terminal')
      const terminalBash = await load('@deepseek-ai/dsh-terminal-bash')
      const toolBash = await load('@deepseek-ai/dsh-tool-bash-persistent')

      await ctx.plugin(terminal)
      await ctx.plugin(terminalBash, {
        backendType: resolved.backendType,
        shellPath: resolved.shellPath,
        shellArgs: resolved.shellArgs,
        timeoutMs: 300000,
      })
      await ctx.plugin(toolBash, {
        backendType: resolved.backendType,
        timeoutMs: 300000,
        description: resolved.description,
      })
    } catch (error) {
      ctx.logger?.warn(
        `windows-shell: failed to mount ${resolved.backendType} bash stack; falling back to pwsh: ${error?.message ?? String(error)}`,
      )
      hidePwsh = false
    }
  }

  ctx.on('system-prompt/assemble', createPwshHidingAssemblyFilter(hidePwsh), { prepend: true })
}
