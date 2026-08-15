# dsh-pristine

[中文说明](./README.zh-CN.md)

A DeepSeek Harness agent preset that guarantees the first model request of
every fresh session runs in a pure Minimal prompt state, then processes the
real prompt normally with the full Standard catalog.

This is a community project. It is not an official DeepSeek preset and is not
affiliated with or endorsed by DeepSeek.

## Why

DeepSeek V4 Pro reaches its capability ceiling only under a Minimal prompt. On
real projects that state is hard to hold: AGENTS.md/CLAUDE.md baselines, the
skill catalog, and skill content are injected into the first request, so a
nominally "minimal" first request is not actually minimal, and the
capability-maximizing state is lost.

This preset holds the state by construction. The session's very first step is
replaced with a warmup round whose request carries ONLY the fixed Minimal
system prompt and two tools (`bash`/`pwsh` plus `read`). The replacement runs
outermost on the pre-step waterfall, ahead of the instruction and skill
injections, so those injections are discarded for this request instead of
polluting it. The user's first prompt is deferred to the next turn and is then
processed normally: full Standard catalog, all instructions and skills.

## What it does

1. On the first input of a fresh session, the first step becomes a warmup
   round instead of answering the user.
2. The warmup request contains only the Minimal fixed system prompt
   (`You are a helpful software engineer assistant.`) and two tools: one
   native shell (`bash` on Linux, `pwsh` on Windows) plus `read`. No
   AGENTS.md/CLAUDE.md baseline, no skill catalog, no skill content.
3. The warmup message asks the agent to explore the repository read-only
   (`pwd`, git status, recent commits, top-level files, README,
   AGENTS.md/CLAUDE.md) and end with a short summary of the project state.
4. The warmup turn is visible in the trajectory like any other turn.
5. The real first prompt is then processed normally with the full Standard
   catalog.

Subagent sessions skip the warmup.

## Compatibility

Developed and tested against:

- DeepSeek Harness `0.1.0-rc.6`
- Node.js 22 on Linux

DeepSeek Harness is currently a developer preview and explicitly permits
breaking changes. This preset is a full snapshot of the Standard composition,
so review upstream changes before using it with a newer release.

## Install

### Scripted install

Linux/macOS:

```sh
./install.sh           # snapshot copy (default)
./install.sh --link    # symlink preset/ so git pull updates apply immediately
```

Windows (PowerShell):

```powershell
.\install.ps1          # snapshot copy (default)
.\install.ps1 -Link    # symlink (requires Developer Mode)
```

Both scripts resolve the preset root from `DSH_HOME` (falling back to `~/.dsh`
or `%USERPROFILE%\.dsh`), install under the id `pristine`, refuse to overwrite
an existing preset, and verify the installed files. Run with `--help` or
`-Help` to list all options. If PowerShell's execution policy blocks the
script, use `powershell -ExecutionPolicy Bypass -File .\install.ps1`.

Remove the preset with `./uninstall.sh` (Linux/macOS) or `.\uninstall.ps1`
(Windows).

### Manual install

Clone this repository, then copy the entire `preset` directory into the user
preset root under the id `pristine`.

PowerShell:

```powershell
$target = Join-Path $env:USERPROFILE '.dsh\.agent-presets\pristine'
if (Test-Path -LiteralPath $target) { throw "Preset already exists: $target" }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
Copy-Item -Recurse -LiteralPath '.\preset' -Destination $target
```

Linux/macOS:

```sh
dsh_home="${DSH_HOME:-$HOME/.dsh}"
mkdir -p "$dsh_home/.agent-presets"
test ! -e "$dsh_home/.agent-presets/pristine"
cp -R preset "$dsh_home/.agent-presets/pristine"
```

Fully restart DeepSeek Harness, create a blank session, and select
**Pristine**. Do not switch an active session from a different preset.

## Verify

- The first visible assistant turn is the warmup: it uses only the shell and
  `read` and ends with a repository summary.
- Export the session JSONL and inspect `request/header` events: the first
  header carries only `bash/read` or `pwsh/read`; the next header carries the
  full Standard catalog.

Run the local zero-dependency tests with:

```sh
npm test
```

## Important behavior

- The warmup is fail-soft: if the model route cannot be resolved, the first
  step is rejected, or the run is aborted, the warmup is skipped and the real
  input proceeds unchanged.
- The warmup consumes one real turn (and its tokens) and is visible in the
  trajectory.
- Sessions that already recorded a `request/header` (resumed or reloaded
  sessions) do not warm up again.
- Subagent sessions skip the warmup (`subagents: false` in the preset config).
- The catalog is narrowed only while a warmup is pending. If exactly one of
  the configured shells is not available (or a common tool is missing), the
  warmup runs with the full catalog and logs a warning.
- The preset has the same trust level as shell access. Review its files before
  installation.
- The plugin performs no network requests and adds no telemetry.

## Official ecosystem guidance

DeepSeek currently asks community plugin authors to publish plugins in their own
GitHub projects and add the [`dsh-plugin`](https://github.com/topics/dsh-plugin)
repository topic for discovery. The official repository does not currently
accept external pull requests and does not mandate a community repository
template. See the official
[`CONTRIBUTING.md`](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/CONTRIBUTING.md).

## Acknowledgments

The core insight behind this preset — that DeepSeek V4 Pro reaches its
capability ceiling only under the Minimal prompt state — comes from
[dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard).
This preset builds on that work and closes the gap it left on real projects:
the first model request is now guaranteed pure Minimal, because
AGENTS.md/CLAUDE.md baselines and skill injections are discarded from the
warmup round instead of polluting it.

## License

MIT. `preset/agent.cordis.yml` is derived from the DeepSeek Harness Standard
preset; the original DeepSeek copyright and MIT notice are retained in
[`NOTICE`](./NOTICE).
