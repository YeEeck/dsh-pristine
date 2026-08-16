# dsh-pristine

[English](./README.md)

一个 DeepSeek Harness agent preset：保证每个新会话的第一个模型请求运行在纯净的
Minimal prompt 状态下——零工具、无基线或 skill 注入——之后再把真实请求按完整
Standard 目录正常处理。

这是社区项目，并非 DeepSeek 官方 preset，也不代表 DeepSeek 的认可或背书。

## 主要特性

- **机制上保证纯净 Minimal 首请求。** 会话的第一个 step 会被替换成一个可见的热身
  回合，请求只携带固定的 Minimal system prompt（`You are a helpful software
  engineer assistant.`）且不含任何工具。AGENTS.md/CLAUDE.md 基线、skill 目录与
  skill 内容都不会进入该请求。
- **零工具热身。** 比真实 Minimal 会话更纯粹：Minimal 通常随附的两个工具 schema
  也不会出现在热身请求中。
- **注入屏蔽。** 替换发生在 pre-step 瀑布的最外层，先于指令与 skill 注入执行，
  因此这些注入会在热身请求中被直接丢弃，而不是污染它。
- **热身后恢复正常流程。** 用户的真实第一条提示推迟一个回合，随后以完整 Standard
  目录、全部指令与全部 skills 正常处理。
- **Minimal 的 shell 与编辑器栈。** 完整目录暴露 Minimal 的持久 `bash`（名称、
  描述与 schema 完全一致）与 `str_replace_editor`，同时保留 Standard 文件工具
  （`read`/`write`/`edit`/`glob`/`grep`）。
- **Windows shell 可选。** Windows 上默认使用持久 Git Bash（Git Bash 需要
  **Full access** 完整访问状态），也支持显式选择 WSL 或 `pwsh`；不可用时安全
  回退到 `pwsh`。
- **子代理覆盖。** spawn 子代理与主会话一样热身，fork 子代理跳过；
  `subagents: false` 可让所有被委派子代理退出。
- **失败安全且幂等。** 模型路由无法解析、首个 step 被拒绝或运行被中止时跳过热身；
  恢复或重新加载的会话不会再次热身。
- **无网络、无遥测。** 插件不发起任何网络请求，也不增加任何遥测。

## 为什么这样做

DeepSeek V4 Pro 只有在 Minimal prompt 状态下才能达到能力上限。但在真实项目里，
这个状态很难保持：AGENTS.md/CLAUDE.md 基线、skill 目录和 skill 内容都会注入到
第一次请求里，"名义上的 Minimal"其实并不 Minimal，能力最大化随之失效。

本 preset 从机制上保证了纯净。会话的第一个 step 会被替换成一个热身回合，其请求
只携带固定的 Minimal system prompt，且完全不携带任何工具——比真实 Minimal 会话
还要纯粹（后者的两件工具 schema 也不出现在这一请求里）；替换发生在 pre-step
瀑布的最外层，先于指令与 skill 注入执行，因此那些注入在这一请求中被直接丢弃，
无法污染它。用户的真实第一条提示被推迟到下一回合，此后按正常流程处理：完整
Standard 目录、全部指令与 skills。

## 工作方式

1. 新会话收到第一次输入时，第一个 step 变成热身回合，而不是回答用户。
2. 替换运行在 pre-step 瀑布的最外层，先于指令与 skill 注入执行，因此这些注入
   会在热身请求中被直接丢弃，而不是污染它。
3. 热身请求只包含 Minimal 固定 system prompt（`You are a helpful software
   engineer assistant.`），不含任何工具。没有 AGENTS.md/CLAUDE.md 基线、
   没有 skill 目录、没有 skill 内容。
4. 热身消息是一句纯粹的回合声明："This round is a test. Tools are not open
   yet; all tools will open next round." 它不点名目标、工具或命令，尽量不干扰
   纯净的 Minimal 请求。
5. 热身回合与普通回合一样可见地记录在轨迹里。
6. 真实的第一条提示随后按正常流程处理，带完整 Standard 目录。完整目录中的
   shell 是 Minimal 的持久 `bash`（名称、描述与 schema 完全一致）。Windows
   默认使用 Git Bash，也支持 WSL 和 `pwsh` 作为显式选择；`str_replace_editor`
   加入 Standard 文件工具之列（`read`/`write`/`edit`/`glob`/`grep` 保留）。

## 热身覆盖范围

| 会话类型 | 是否热身 | 原因 |
| --- | --- | --- |
| 主新会话 | 是 | 其首次请求原本会携带基线与 skill 注入。 |
| spawn 子代理（`subagent` 工具、workflow 的 `agent()` 调用、ralph 各轮） | 是 | 每个都从空日志启动，面对同样的注入。 |
| fork 子代理（`subagent_fork`） | 否 | 它继承父会话的已完成轮次，首次请求不可能达到纯 Minimal 状态。空种子的 fork 与 spawn 无法区分，会顺带热身——无害。 |
| 恢复或重新加载的会话 | 否 | 已经记录过 `request/header`。 |
| 外部 CLI 子代理（codex、claude-code） | 不覆盖 | 它不走 agent 循环。 |

## 配置

### 被委派会话

spawn 子代理默认启用热身。要让所有被委派子代理都跳过热身——适合不想为每个子代理
多付一轮 token 的批量 fan-out 场景——请编辑已安装 preset 的 `agent.cordis.yml`：

```yaml
- id: warmup-bootstrap
  name: ./warmup-bootstrap.mjs
  config:
    subagents: false
```

### Windows shell

在 Windows 上，Pristine 默认使用由 Git Bash 支持的持久 `bash`。Git Bash 只有在
会话处于 **Full access**（完整访问）状态时才会生效——使用默认 shell 前，请先把
会话切换到 Full access。要切换 shell，请编辑已安装 preset 的 `agent.cordis.yml`
中 `windows-shell-bootstrap` 的配置：

```yaml
- id: windows-shell-bootstrap
  name: ./windows-shell.mjs
  config:
    windowsShell: git-bash   # git-bash（默认）、wsl 或 pwsh
    gitBashPath: null        # 可选：bash.exe 的绝对路径
    wslDistro: null          # 可选：WSL 发行版名，例如 Ubuntu
```

- `git-bash` 会自动探测常见的 Git for Windows 安装位置；`gitBashPath` 可在
  非标准安装时覆盖探测结果。
- `wsl` 使用 `wsl.exe`；`wslDistro` 用于选择非默认发行版，且必须是 WSL 中
  已安装的发行版。
- 当 bash 变体激活时，模型可见目录只暴露 `bash`，并隐藏 `pwsh`。
- 如果所选 bash 变体不可用或配置值非法，Pristine 会记录警告并回退到 `pwsh`，
  保证会话仍然可用。

## 兼容范围

开发和验证版本：

- DeepSeek Harness `0.1.0-rc.6`
- Linux / Node.js 22

DeepSeek Harness 目前仍是开发者预览版，官方明确说明未来会有破坏性变更。本
preset 是 Standard 组装 + Minimal 的 shell/editor 栈的快照；升级 Harness 后，
应先对照上游改动再继续使用。

## 安装

### 脚本安装

Linux/macOS：

```sh
./install.sh           # 默认快照复制
./install.sh --link    # 软链接 preset/，git pull 后立即生效
```

Windows（PowerShell）：

```powershell
.\install.ps1          # 默认快照复制
.\install.ps1 -Link    # 软链接（需要开发者模式）
```

两个脚本都从 `DSH_HOME` 解析 preset 根目录（缺省回退到 `~/.dsh` 或
`%USERPROFILE%\.dsh`），以 id `pristine` 安装，不覆盖已有安装（内容完全一致时会
报告已安装），并校验安装结果；`--help` / `-Help` 可查看全部选项。若 PowerShell
执行策略拦截脚本，改用 `powershell -ExecutionPolicy Bypass -File .\install.ps1`。

### 卸载

使用 `./uninstall.sh`（Linux/macOS）或 `.\uninstall.ps1`（Windows）卸载。两个
脚本都会要求确认；`--yes` / `-Yes` 可跳过确认。

### 手动安装

克隆本仓库，将整个 `preset` 目录复制到用户 preset 根目录，并将目标目录命名为
`pristine`。

PowerShell：

```powershell
$target = Join-Path $env:USERPROFILE '.dsh\.agent-presets\pristine'
if (Test-Path -LiteralPath $target) { throw "Preset already exists: $target" }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
Copy-Item -Recurse -LiteralPath '.\preset' -Destination $target
```

Linux/macOS：

```sh
dsh_home="${DSH_HOME:-$HOME/.dsh}"
mkdir -p "$dsh_home/.agent-presets"
test ! -e "$dsh_home/.agent-presets/pristine"
cp -R preset "$dsh_home/.agent-presets/pristine"
```

### 安装后

完整重启 DeepSeek Harness，新建空 session，选择 **Pristine**。不要在已经产生
内容的会话中途切换 preset。

## 验证加载

- 第一个可见的 assistant 回合就是热身回合：其回复只是一句简短确认，而不是对
  用户提示的回答；
- 导出 session JSONL，检查 `request/header`：第一份 header 不应包含任何工具；
  下一份 header 应包含完整 Standard 目录；
- 派生一个子代理（例如通过 `subagent` 工具）并导出其 session JSONL：它的第一份
  header 同样不应包含任何工具。

本仓库的零依赖测试：

```sh
npm test
```

## 行为说明

- **失败处理。** 热身是失败安全的：模型路由无法解析、首个 step 被拒绝或运行被
  中止时，直接跳过热身，真实输入按原样处理。
- **成本与可见性。** 热身消耗一个真实回合（及其 token），并可见地记录在轨迹中。
  每个新会话都要付这笔账——主会话和每个 spawn 子代理都是（`subagents: false`
  可让子代理退出）。
- **每个新会话只热身一次。** 已经记录过 `request/header` 的会话（resume/reload）
  不会再次热身。
- **目录缩窄范围。** 只有热身待执行时才缩窄目录：待执行期间目录被缩窄为零工具，
  下一回合恢复完整目录。
- **Windows 回退。** 在 Windows 上，所选 Git Bash/WSL shell 是失败安全的：如果
  缺失或配置错误，会记录警告并回退到 `pwsh`。
- **信任等级。** preset 与 shell 访问具有相同信任等级，安装前应自行审阅文件。
- **隐私。** 插件不会发起网络请求，也不增加遥测。

## 官方生态要求

DeepSeek 当前建议社区作者把插件放在自己的 GitHub 项目中，并为仓库添加
[`dsh-plugin`](https://github.com/topics/dsh-plugin) topic 方便发现。官方仓库目前
不接受外部 PR，也没有强制社区插件仓库模板。原文见官方
[`CONTRIBUTING.zh.md`](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/CONTRIBUTING.zh.md)。

## 鸣谢

本 preset 的核心洞见——DeepSeek V4 Pro 仅在 Minimal prompt 状态下才能达到能力
上限——来自
[dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard)。
本 preset 在其基础之上补上了真实项目中的缺口：首个模型请求现在被保证为纯净的
Minimal 状态，因为热身回合会丢弃 AGENTS.md/CLAUDE.md 基线与 skill 注入，使它们
无法污染该请求。

## 许可证

MIT。`preset/agent.cordis.yml` 基于 DeepSeek Harness Standard preset 修改，原始
DeepSeek 版权和 MIT 许可声明保留在 [`NOTICE`](./NOTICE) 中。
