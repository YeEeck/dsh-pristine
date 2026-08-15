# dsh-pristine

[English](./README.md)

一个 DeepSeek Harness agent preset：保证每个新会话的第一个模型请求运行在纯净的
Minimal prompt 状态下，之后再把真实请求按完整 Standard 目录正常处理。

这是社区项目，并非 DeepSeek 官方 preset，也不代表 DeepSeek 的认可或背书。

## 为什么这样做

DeepSeek V4 Pro 只有在 Minimal prompt 状态下才能达到能力上限。但在真实项目里，
这个状态很难保持：AGENTS.md/CLAUDE.md 基线、skill 目录和 skill 内容都会注入到
第一次请求里，"名义上的 Minimal"其实并不 Minimal，能力最大化随之失效。

本 preset 从机制上保证了纯净。会话的第一个 step 会被替换成一个热身回合，其请求
只携带固定的 Minimal system prompt 和两项工具（`bash`/`pwsh` 加 `read`）；替换
发生在 pre-step 瀑布的最外层，先于指令与 skill 注入执行，因此那些注入在这一请求
中被直接丢弃，无法污染它。用户的真实第一条提示被推迟到下一回合，此后按正常流程
处理：完整 Standard 目录、全部指令与 skills。

## 它做什么

1. 新会话收到第一次输入时，第一个 step 变成热身回合，而不是回答用户；
2. 热身请求只包含 Minimal 固定 system prompt（`You are a helpful software
   engineer assistant.`）和两项工具：一个本机 shell（Linux 为 `bash`，
   Windows 为 `pwsh`）加 `read`。没有 AGENTS.md/CLAUDE.md 基线、没有 skill
   目录、没有 skill 内容；
3. 热身消息让 agent 只读地探查仓库（`pwd`、git status、最近提交、顶层文件、
   README、AGENTS.md/CLAUDE.md），并在结尾给出项目状态的简短总结；
4. 热身回合与普通回合一样可见地记录在轨迹里；
5. 真实的第一条提示随后按正常流程处理，带完整 Standard 目录。

子代理会话跳过热身。

## 兼容范围

开发和验证版本：

- DeepSeek Harness `0.1.0-rc.6`
- Linux / Node.js 22

DeepSeek Harness 目前仍是开发者预览版，官方明确说明未来会有破坏性变更。本
preset 是 Standard 组装的完整快照；升级 Harness 后，应先对照上游改动再继续使用。

## 安装

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

完整重启 DeepSeek Harness，新建空 session，选择 **Pristine**。不要在已经产生
内容的会话中途切换 preset。

## 验证加载

- 第一个可见的 assistant 回合就是热身回合：只使用 shell 和 `read`，并以仓库
  摘要结尾；
- 导出 session JSONL，检查 `request/header`：第一份 header 应只有 `bash/read`
  或 `pwsh/read`；下一份 header 应包含完整 Standard 目录。

本仓库的零依赖测试：

```sh
npm test
```

## 重要行为

- 热身是失败安全的：模型路由无法解析、首个 step 被拒绝或运行被中止时，直接
  跳过热身，真实输入按原样处理；
- 热身消耗一个真实回合（及其 token），并可见地记录在轨迹中；
- 已经记录过 `request/header` 的会话（resume/reload）不会再次热身；
- 子代理会话跳过热身（preset 配置 `subagents: false`）；
- 只有热身待执行时才缩窄目录；若配置的两个 shell 无法恰好留下一个（或缺少
  通用工具），热身将带完整目录运行并记录警告；
- preset 与 shell 访问具有相同信任等级，安装前应自行审阅文件；
- 插件不会发起网络请求，也不增加遥测。

## 官方生态要求

DeepSeek 当前建议社区作者把插件放在自己的 GitHub 项目中，并为仓库添加
[`dsh-plugin`](https://github.com/topics/dsh-plugin) topic 方便发现。官方仓库目前
不接受外部 PR，也没有强制社区插件仓库模板。原文见官方
[`CONTRIBUTING.zh.md`](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/CONTRIBUTING.zh.md)。

## 许可证

MIT。`preset/agent.cordis.yml` 基于 DeepSeek Harness Standard preset 修改，原始
DeepSeek 版权和 MIT 许可声明保留在 [`NOTICE`](./NOTICE) 中。
