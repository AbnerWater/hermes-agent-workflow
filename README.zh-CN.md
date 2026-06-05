<p align="center">
  <img src="assets/hermes-workflow-banner.png" alt="Hermes Workflow" width="100%">
</p>

# Hermes Workflow

<p align="center">
  <a href="https://hermes-agent.nousresearch.com/docs/"><img src="https://img.shields.io/badge/Docs-hermes--agent.nousresearch.com-FFD700?style=for-the-badge" alt="Documentation"></a>
  <a href="https://discord.gg/NousResearch"><img src="https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
  <a href="https://github.com/NousResearch/hermes-agent/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License: MIT"></a>
  <a href="https://nousresearch.com"><img src="https://img.shields.io/badge/Built%20by-Nous%20Research-blueviolet?style=for-the-badge" alt="Built by Nous Research"></a>
  <a href="README.md"><img src="https://img.shields.io/badge/Lang-English-lightgrey?style=for-the-badge" alt="English"></a>
</p>

Hermes Workflow 是一个从 Hermes Agent 衍生而来的 workflow-first AI agent 工作台。它保留 Hermes Agent 的运行时、模型、工具和 skills 作为执行底座，并在此之上增加面向项目的 Workflow Workbench app，用于规划、可视化、运行、审查和沉淀多步骤 AI 工作。

它不再把所有任务都压进一条长聊天，而是把目标转成一个项目：先澄清需求，再生成可执行节点图，为每个节点绑定 references 和 skills，带着可见状态运行节点，审查文件变更与产物，并在项目推进过程中保留快照。

## Hermes Workflow 是什么？

Hermes Workflow 面向需要结构化、可审计和人工控制的 AI 工作：

- **项目优先的交互方式**：每个 workflow 都有项目目录、目标、references、生成计划、运行历史、artifacts 和 snapshots。
- **可视化 agent 编排**：桌面工作台用节点图呈现 workflow，包括依赖关系、成功路径和失败/返工路径。
- **Hermes Agent 执行底座**：每个节点可通过底层 Hermes Agent runtime 执行，并复用已配置的 providers、models、tools 和 skills。
- **可审查输出**：节点结果写入 Markdown artifacts，文件变更会被汇总供审查，stream events 记录执行过程。
- **可恢复进度**：workflow 元数据保存在可读项目文件和本地事件数据库中，关键里程碑会创建 Git snapshot。

## Hermes Workflow 能做什么？

| 能力 | 实际含义 |
| --- | --- |
| 目标录入与澄清 | 输入项目名、目标、可选项目目录和 references 后，Hermes 会先提出规划问题，再生成 workflow。 |
| 生成节点图 | 工作台会创建可编辑的 planning、reference、execution、review 和 delivery 节点及其依赖边。 |
| References | 添加项目级和节点级文件或文件夹，让启用的资料进入正确的执行上下文。 |
| Skill bindings | 可让 Hermes 自动选择 skills，也可为节点手动绑定指定 skills。 |
| 节点 prompt 与模型控制 | 查看和编辑每个节点的执行 prompt，并可为单个节点设置模型覆盖。 |
| 执行控制 | 使用 `single_step`、`semi_auto` 或 `auto` 运行 workflow，并支持 pause、resume、stop、retry、skip、pass、fail、return。 |
| 审查门禁 | 可要求部分节点等待人工确认，通过 failure edge 返工，或在 auto 模式下使用结构化自动审查决策。 |
| Stream output | 实时查看过程摘要、工具调用、阶段结果、AI 回复、节点状态、审批、错误和快照事件。 |
| Artifact 与文件审查 | 查看节点 Markdown artifacts，并检查节点执行后新增、修改、删除或二进制业务文件。 |
| Snapshots 与导出 | 创建 Git-backed 项目快照，并将 workflow 项目导出为不含重型运行时文件的 zip。 |

## Workflow Workbench App

桌面 app 是 Hermes Workflow 的主要使用界面。可以从侧边栏打开 **Workflow Workbench**，也可以在桌面 shell 中进入 `/workflows`。

Workbench 由这些 UI 区域组成：

- **Project sidebar**：浏览 workflow 项目，新建 workflow，重新打开项目目录，重命名、归档、移出历史或导出项目。
- **New Workflow intake**：填写任务背景，选择项目目录，添加 references，回答澄清问题，然后确认生成 workflow。
- **Canvas**：查看和编辑 workflow 图，移动节点，连接 success/failure 端口，并跟随当前运行节点。
- **Execution toolbar**：选择 `single_step`、`semi_auto` 或 `auto`，然后 run、pause、resume 或 stop 当前 workflow。
- **Node detail drawer**：查看节点状态、prompt、model、skills、references、review rules、review decisions、artifacts 和 file changes。
- **References / skills drawers**：不离开工作台即可管理项目上下文和可用 skills。
- **Snapshots drawer**：创建手动快照，并查看历史 workflow checkpoint。
- **Project file tree**：浏览 workflow 项目的 references、workflow metadata、artifacts、outputs 和 logs。
- **Stream output**：在独立 stream 面板里跟踪实时执行事件和 AI 回复，而不是把所有输出散落在聊天气泡中。
- **Workflow composer**：向全局 workflow 或当前节点发送指令、slash commands 和文件附件。

### UI 展示占位

README 暂时使用不会渲染成破图的文字占位，等真实产品截图提交后再替换。

| 展示位 | 未来建议素材路径 | Alt / 图注 |
| --- | --- | --- |
| Workbench overview | `docs/assets/workflow-workbench-overview.png` | Hermes Workflow Workbench，展示项目侧边栏、workflow canvas、节点抽屉和 stream output。 |
| Intake and clarification | `docs/assets/workflow-intake-clarification.png` | New Workflow intake 页面，包含项目配置、澄清问题和规划摘要。 |
| Canvas execution | `docs/assets/workflow-canvas-execution.png` | 半自动模式下运行的 workflow 图，当前节点被高亮。 |
| Node review drawer | `docs/assets/workflow-node-review-drawer.png` | 节点详情抽屉，展示审查控制、artifacts、文件变更、references 和 skills。 |
| Stream and artifacts | `docs/assets/workflow-stream-artifacts.png` | Stream output 面板，包含工具调用、AI 回复、阶段结果、snapshots 和生成 artifacts。 |

更多桌面端说明见：[apps/desktop/README.zh-CN.md](apps/desktop/README.zh-CN.md)。

## Workflow 执行模式

Hermes Workflow 当前提供三种运行模式：

- `single_step`：执行一个节点后等待用户确认，再继续下一个节点。
- `semi_auto`：普通节点自动向前推进，但在 review gate 或要求确认的节点暂停。
- `auto`：workflow engine 自动推进，并在可能时应用结构化 review decision。

所有模式都保留显式用户控制：pause、resume、stop、retry、skip、pass、fail 和 return。Review 与 failure 路径是一等 workflow edge，因此审查不通过时可以回到上游节点返工，而不是直接结束运行。

## 项目文件与持久化

如果没有选择自定义项目目录，项目默认创建在：

```text
HERMES_HOME/workflows/<project-slug>
```

每个 workflow 项目的状态保存在 `.agent-workflow/`：

```text
.agent-workflow/
  project.json
  workflow.flow.json
  references.manifest.json
  skills.config.json
  settings.json
  artifacts.manifest.json
  workflow.db
  intake.state.json
  stream-events/YYYY-MM-DD.jsonl
```

生成内容会放在项目内的 `artifacts/`、`outputs/`、`logs/`、`references/` 和 `workflow/` 等目录中。如果 Git 可用，项目初始化、workflow 生成、workflow 编辑、节点完成、审查流转和最终交付等里程碑都会创建 snapshot。

## 安装 / 运行

在 workflow-first app 开发过程中，Hermes Workflow 仍沿用现有 Hermes 安装方式和命令名。

### Linux、macOS、WSL2、Termux

```bash
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
```

### Windows PowerShell

```powershell
iex (irm https://hermes-agent.nousresearch.com/install.ps1)
```

安装后：

```bash
hermes setup
hermes model
hermes desktop
```

也可以在安装 agent 时一并安装桌面 app：

```bash
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash -s -- --include-desktop
```

## 开发

在仓库根目录执行：

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
uv venv .venv --python 3.11
source .venv/bin/activate
uv pip install -e ".[all,dev]"
npm install
```

运行桌面工作台：

```bash
cd apps/desktop
npm run dev
```

常用检查：

```bash
scripts/run_tests.sh
cd apps/desktop
npm run type-check
npm run lint
npm run test:desktop:all
```

开发时如需隔离真实配置，可使用临时 workflow home：

```bash
HERMES_HOME=/tmp/hermes-workflow-dev npm run dev
```

## 许可证

MIT - 详见 [LICENSE](LICENSE)。

Hermes Workflow Workbench 由 [AbnerWater](https://github.com/AbnerWater) 构建。

Hermes Agent 由 [Nous Research](https://nousresearch.com) 构建。
