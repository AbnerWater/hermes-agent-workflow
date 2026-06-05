# Hermes Workflow Desktop

<p align="center">
  <a href="https://github.com/NousResearch/hermes-agent/releases"><img src="https://img.shields.io/badge/Download-macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-FFD700?style=for-the-badge" alt="Download"></a>
  <a href="https://hermes-agent.nousresearch.com/docs/"><img src="https://img.shields.io/badge/Docs-hermes--agent.nousresearch.com-FFD700?style=for-the-badge" alt="Documentation"></a>
  <a href="https://discord.gg/NousResearch"><img src="https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
  <a href="https://github.com/NousResearch/hermes-agent/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License: MIT"></a>
  <a href="README.md"><img src="https://img.shields.io/badge/Lang-English-lightgrey?style=for-the-badge" alt="English"></a>
</p>

Hermes Workflow Desktop 是 Hermes Workflow 的主要 Workbench app。它把 Hermes Agent runtime 包装在原生 Electron shell 中，并增加一个可视化 workflow 工作空间，用于 AI agent 项目的录入、澄清、节点图生成、执行、审查、产物、文件变更和快照。

主要 workflow 界面位于 `/workflows`，并在 app 侧边栏中显示为 **Workflow Workbench**。

## Workbench 用来做什么？

桌面 app 面向需要规划、观察、审查和恢复的 agent 工作。它可以帮助用户：

- 把粗略目标转成结构化 workflow 项目。
- 在执行开始前提出并回答澄清问题。
- 生成并编辑可执行 workflow 图。
- 带着项目上下文通过 Hermes Agent runtime 运行节点。
- 查看节点 prompt、model override、skills、references 和 review rules。
- 在 stream 面板中跟踪实时执行事件。
- 在批准或返工前审查 artifacts 与 file changes。
- 通过 `.agent-workflow/` 文件、事件日志和 Git snapshots 保存项目状态。

## UI 导览

| 区域 | 用途 |
| --- | --- |
| Project sidebar | 列出 workflow 项目，并提供新建、重新打开、重命名、归档、移出历史和导出操作。 |
| New Workflow intake | 收集项目名、任务背景、项目目录、references、澄清答案和最终生成确认。 |
| Workflow canvas | 展示生成的节点图，包括依赖、success 输出、failure 输出、节点状态和当前运行节点。 |
| Execution toolbar | 选择 `single_step`、`semi_auto` 或 `auto`，并执行 run、pause、resume 或 stop。 |
| Node detail drawer | 展示 prompt、model、skills、references、review rules、review decision、artifacts、file changes 和节点操作。 |
| File tree drawer | 浏览 workflow 相关项目目录，包括 references、workflow metadata、artifacts、outputs 和 logs。 |
| References drawer | 启用或禁用项目级 reference 文件和文件夹。 |
| Skills drawer | 启用项目级 skills，并支持节点级自动或手动 skill 选择。 |
| Snapshots drawer | 创建手动 snapshots，并列出历史 Git-backed workflow checkpoints。 |
| Stream output | 显示过程摘要、工具调用、阶段结果、AI 回复、节点状态事件、审批、错误和 snapshots。 |
| Workflow composer | 向 workflow 发送项目级或节点级消息、slash commands 和文件附件。 |

## UI 展示占位

当前还没有提交截图文件。以下占位是纯文本，确保 README 不会渲染破图。

| 展示位 | 未来建议素材路径 | Alt / 图注 |
| --- | --- | --- |
| Workbench overview | `docs/assets/workflow-workbench-overview.png` | Hermes Workflow Workbench，展示项目侧边栏、workflow canvas、节点抽屉和 stream output。 |
| Intake and clarification | `docs/assets/workflow-intake-clarification.png` | New Workflow intake 页面，包含项目配置、澄清问题和规划摘要。 |
| Canvas execution | `docs/assets/workflow-canvas-execution.png` | 半自动模式下运行的 workflow 图，当前节点被高亮。 |
| Node review drawer | `docs/assets/workflow-node-review-drawer.png` | 节点详情抽屉，展示审查控制、artifacts、文件变更、references 和 skills。 |
| Stream and artifacts | `docs/assets/workflow-stream-artifacts.png` | Stream output 面板，包含工具调用、AI 回复、阶段结果、snapshots 和生成 artifacts。 |

## App 中的 workflow 生命周期

1. 新建或打开 workflow 项目。
2. 添加任务目标、项目目录和 reference 文件。
3. 让 Hermes 提出澄清问题并形成 planning summary。
4. 确认生成，由后端写入 `workflow.flow.json`。
5. 检查或编辑节点、prompts、references、skills、models 和 edges。
6. 选择 `single_step`、`semi_auto` 或 `auto`，然后启动运行。
7. 观察 stream events，并在 canvas 上跟随当前节点。
8. 在 review gates 审查 artifacts 和 file changes。
9. 根据需要执行 pass、fail、return、retry、skip、pause、resume 或 stop。
10. 使用 snapshots 和 export 保存或共享项目。

## 安装

### 随 Hermes 一起安装

给一行安装脚本加上 `--include-desktop`，即可同时安装 runtime 和 desktop app：

```bash
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash -s -- --include-desktop
```

如果已经安装 Hermes CLI，可以直接启动桌面 app：

```bash
hermes desktop
```

桌面 app 会使用与底层 Hermes runtime 相同的 provider 配置、model settings、credentials、sessions、tools 和 skills。

### 预构建安装包

预构建安装包沿用现有 Hermes desktop 发布渠道：

```text
https://hermes-agent.nousresearch.com/desktop
```

## 开发

先在仓库根目录安装 workspace 依赖，再从本目录启动 desktop app：

```bash
npm install
cd apps/desktop
npm run dev
```

常用开发模式：

```bash
HERMES_DESKTOP_HERMES_ROOT=/path/to/clone npm run dev
HERMES_HOME=/tmp/hermes-workflow-dev npm run dev
npm run dev:fake-boot
```

该命令会启动 Vite renderer 和 Electron main process。Electron 启动 Python backend 后，renderer 会通过现有 dashboard APIs 以及 `/api/workflows` 下的 workflow API 与后端通信。

## 构建

```bash
npm run dist:mac
npm run dist:win
npm run dist:linux
npm run pack
```

签名与 notarization 仍沿用现有 Electron Builder credential flow，前提是环境中存在对应凭证变量。

## 验证

提交 PR 前运行：

```bash
npm run fix
npm run type-check
npm run lint
npm run test:desktop:all
```

如果修改了 workflow backend，还应在仓库根目录运行聚焦 Python 测试：

```bash
python -m pytest tests/test_workflow_api.py -q
```

## 故障排查

启动日志位于：

```text
HERMES_HOME/logs/desktop.log
```

默认 Hermes home：

```text
macOS/Linux: ~/.hermes
Windows:     %LOCALAPPDATA%\hermes
```

在 macOS/Linux 上强制重新执行首次启动设置：

```bash
rm "$HOME/.hermes/hermes-agent/.hermes-bootstrap-complete"
rm -rf "$HOME/.hermes/hermes-agent/venv"
```

在 Windows PowerShell 上强制重新执行首次启动设置：

```powershell
Remove-Item "$env:LOCALAPPDATA\hermes\hermes-agent\.hermes-bootstrap-complete"
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\hermes\hermes-agent\venv"
```

## 许可证

MIT - 详见 [LICENSE](../../LICENSE)。

由 [Nous Research](https://nousresearch.com) 构建。
