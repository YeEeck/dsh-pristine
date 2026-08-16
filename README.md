# dsh-pristine

[中文说明](./README.zh-CN.md)

A DeepSeek Harness agent preset that guarantees the first model request of
every fresh session runs in a pure Minimal prompt state — zero tools, no
baseline or skill injections — then processes the real prompt normally with
the full Standard catalog.

This is a community project. It is not an official DeepSeek preset and is not
affiliated with or endorsed by DeepSeek.

## Features

- **Pure Minimal first request, by construction.** The session's first step is
  replaced with a visible warmup round that carries only the fixed Minimal
  system prompt (`You are a helpful software engineer assistant.`) and NO
  tools. AGENTS.md/CLAUDE.md baselines, the skill catalog, and skill content
  never reach that request.
- **Zero-tool warmup.** Even purer than a real Minimal session: the two tool
  schemas that Minimal normally ships are absent from the warmup request.
- **Injection shield.** The replacement runs outermost on the pre-step
  waterfall, ahead of the instruction and skill injections, so those
  injections are discarded for the warmup request instead of polluting it.
- **Normal flow afterwards.** The user's real first prompt is deferred by one
  turn and is then processed normally with the full Standard catalog, all
  instructions, and all skills.
- **Minimal shell and editor stack.** The full catalog exposes Minimal's
  persistent `bash` (identical name, description, and schema) and
  `str_replace_editor`, while keeping the Standard file tools
  (`read`/`write`/`edit`/`glob`/`grep`).
- **Windows shell choice.** On Windows, persistent Git Bash is the default
  (Git Bash requires **Full access** mode), with WSL and `pwsh` as explicit
  choices and a fail-soft fallback to `pwsh`.
- **Subagent coverage.** Spawn-backed children warm up like the main session;
  fork children skip; `subagents: false` opts all delegated children out.
- **Fail-soft and idempotent.** If the model route cannot be resolved, the
  first step is rejected, or the run is aborted, the warmup is skipped.
  Resumed or reloaded sessions never warm up again.
- **Offline and telemetry-free.** The plugin performs no network requests and
  adds no telemetry.

## Why

DeepSeek V4 Pro reaches its capability ceiling only under a Minimal prompt. On
real projects that state is hard to hold: AGENTS.md/CLAUDE.md baselines, the
skill catalog, and skill content are injected into the first request, so a
nominally "minimal" first request is not actually minimal, and the
capability-maximizing state is lost.

This preset holds the state by construction. The session's very first step is
replaced with a warmup round whose request carries ONLY the fixed Minimal
system prompt and NO tools at all — even purer than a real Minimal session,
whose two tool schemas are absent from this request. The replacement runs
outermost on the pre-step waterfall, ahead of the instruction and skill
injections, so those injections are discarded for this request instead of
polluting it. The user's first prompt is deferred to the next turn and is then
processed normally: full Standard catalog, all instructions and skills.

## How it works

1. On the first input of a fresh session, the first step becomes a warmup
   round instead of answering the user.
2. The replacement runs outermost on the pre-step waterfall, ahead of the
   instruction and skill injections, so those injections are discarded for
   this request instead of polluting it.
3. The warmup request contains only the Minimal fixed system prompt
   (`You are a helpful software engineer assistant.`) and NO tools. No
   AGENTS.md/CLAUDE.md baseline, no skill catalog, no skill content.
4. The warmup message is a bare round-framing sentence: "This round is a
   test. Tools are not open yet; all tools will open next round." It names no
   goal, tool, or command, so the message itself disturbs the pure Minimal
   request as little as possible.
5. The warmup turn is visible in the trajectory like any other turn.
6. The real first prompt is then processed normally with the full Standard
   catalog. The shell in the full catalog is Minimal's persistent `bash`
   (identical name, description, and schema). On Windows the default backend
   is Git Bash, with WSL and `pwsh` available as explicit choices, and
   `str_replace_editor` joins the Standard file tools
   (`read`/`write`/`edit`/`glob`/`grep` are kept).

## Warmup coverage

| Session | Warmup? | Why |
| --- | --- | --- |
| Main fresh session | Yes | Its first request would otherwise carry the baseline and skill injections. |
| Spawn child (`subagent` tool, workflow `agent()` calls, ralph rounds) | Yes | Each starts from an empty log and faces the same injections. |
| Fork child (`subagent_fork`) | No | It inherits the parent's completed turns, so its first request can never be pure Minimal. A fork child with an empty seed is indistinguishable from spawn and warms up — harmless. |
| Resumed or reloaded session | No | It has already recorded a `request/header`. |
| External CLI subagent (codex, claude-code) | Not covered | It does not run the agent loop. |

## Configuration

### Delegated sessions

The warmup is enabled by default for spawn-backed children. To skip it for
every delegated child — useful for bulk fan-out that should not pay one extra
turn per child — edit the installed preset's `agent.cordis.yml`:

```yaml
- id: warmup-bootstrap
  name: ./warmup-bootstrap.mjs
  config:
    subagents: false
```

### Windows shell

On Windows, Pristine defaults to a persistent `bash` backed by Git Bash. Git
Bash only takes effect while the session is in **Full access** mode — switch
the session to Full access before relying on the default shell. To choose a
different shell, edit the installed preset's `agent.cordis.yml` under the
`windows-shell-bootstrap` config:

```yaml
- id: windows-shell-bootstrap
  name: ./windows-shell.mjs
  config:
    windowsShell: git-bash   # git-bash (default), wsl, or pwsh
    gitBashPath: null        # optional absolute path to bash.exe
    wslDistro: null          # optional WSL distro name, e.g. Ubuntu
```

- `git-bash` auto-detects common Git for Windows locations; `gitBashPath`
  overrides detection when Git is installed somewhere non-standard.
- `wsl` uses `wsl.exe`; `wslDistro` selects a non-default distribution and
  must name a distro already installed in WSL.
- While a bash variant is active, the model-visible catalog exposes only
  `bash` and hides `pwsh`.
- If the selected bash variant is unavailable or the configured value is
  invalid, Pristine logs a warning and falls back to `pwsh` so the session
  remains usable.

## Compatibility

Developed and tested against:

- DeepSeek Harness `0.1.0-rc.6`
- Node.js 22 on Linux

DeepSeek Harness is currently a developer preview and explicitly permits
breaking changes. This preset is a snapshot of the Standard composition with
Minimal's shell and editor stack swapped in, so review upstream changes before
using it with a newer release.

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
or `%USERPROFILE%\.dsh`), install under the id `pristine`, leave an existing
installation untouched (an identical install is reported as already installed),
and verify the installed files. Run with `--help` or `-Help` to list all
options. If PowerShell's execution policy blocks the script, use
`powershell -ExecutionPolicy Bypass -File .\install.ps1`.

### Uninstall

Remove the preset with `./uninstall.sh` (Linux/macOS) or `.\uninstall.ps1`
(Windows). Both scripts prompt for confirmation; use `--yes` or `-Yes` to skip
the prompt.

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

### After installing

Fully restart DeepSeek Harness, create a blank session, and select
**Pristine**. Do not switch an active session from a different preset.

## Verify

- The first visible assistant turn is the warmup: its reply is a short
  acknowledgment, not an answer to the user's prompt.
- Export the session JSONL and inspect `request/header` events: the first
  header carries NO tools; the next header carries the full Standard catalog.
- Spawn a subagent (e.g. via the `subagent` tool) and export its session JSONL:
  its first header also carries NO tools.

Run the local zero-dependency tests with:

```sh
npm test
```

## Behavior notes

- **Failure handling.** The warmup is fail-soft: if the model route cannot be
  resolved, the first step is rejected, or the run is aborted, the warmup is
  skipped and the real input proceeds unchanged.
- **Cost and visibility.** The warmup consumes one real turn (and its tokens)
  and is visible in the trajectory. Every fresh session pays it — the main
  session and each spawn-backed subagent (`subagents: false` opts subagents
  out).
- **One warmup per fresh session.** Sessions that already recorded a
  `request/header` (resumed or reloaded sessions) do not warm up again.
- **Catalog scope.** The catalog is narrowed only while a warmup is pending:
  while pending it is narrowed to zero tools, and the following turn gets the
  full catalog back.
- **Windows fallback.** On Windows, the selected Git Bash/WSL shell is
  fail-soft: if it is missing or misconfigured, the preset logs a warning and
  falls back to `pwsh`.
- **Trust.** The preset has the same trust level as shell access. Review its
  files before installation.
- **Privacy.** The plugin performs no network requests and adds no telemetry.

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
