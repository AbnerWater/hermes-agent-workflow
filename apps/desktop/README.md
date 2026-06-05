# Hermes Workflow Desktop

<p align="center">
  <a href="https://github.com/NousResearch/hermes-agent/releases"><img src="https://img.shields.io/badge/Download-macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-FFD700?style=for-the-badge" alt="Download"></a>
  <a href="https://hermes-agent.nousresearch.com/docs/"><img src="https://img.shields.io/badge/Docs-hermes--agent.nousresearch.com-FFD700?style=for-the-badge" alt="Documentation"></a>
  <a href="https://discord.gg/NousResearch"><img src="https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
  <a href="https://github.com/NousResearch/hermes-agent/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License: MIT"></a>
  <a href="README.zh-CN.md"><img src="https://img.shields.io/badge/Lang-%E4%B8%AD%E6%96%87-red?style=for-the-badge" alt="Chinese"></a>
</p>

Hermes Workflow Desktop is the primary Workbench app for Hermes Workflow. It wraps the Hermes Agent runtime in a native Electron shell and adds a visual workflow workspace for AI agent projects: intake, clarification, node graph generation, execution, review, artifacts, file changes, and snapshots.

The main workflow surface lives at `/workflows` and appears in the app sidebar as **Workflow Workbench**.

## What the Workbench is for

The desktop app is designed for agent work that should be planned, observed, reviewed, and resumed. It lets users:

- Turn a rough goal into a structured workflow project.
- Ask and answer clarification questions before execution starts.
- Generate and edit an executable workflow graph.
- Run nodes through the Hermes Agent runtime with project context.
- Inspect node prompts, model overrides, skills, references, and review rules.
- Follow live execution events in a stream panel.
- Review artifacts and file changes before approving or returning work.
- Preserve project state through `.agent-workflow/` files, event logs, and Git snapshots.

## UI tour

| Area | Purpose |
| --- | --- |
| Project sidebar | Lists workflow projects and exposes create, reopen, rename, archive, remove-from-history, and export actions. |
| New Workflow intake | Collects project name, task background, project directory, references, clarification answers, and final generation confirmation. |
| Workflow canvas | Shows the generated node graph with dependencies, success outputs, failure outputs, node status, and the current runtime node. |
| Execution toolbar | Selects `single_step`, `semi_auto`, or `auto`, then runs, pauses, resumes, or stops the current workflow. |
| Node detail drawer | Shows prompt, model, skills, references, review rules, review decision, artifacts, file changes, and node actions. |
| File tree drawer | Browses project directories that matter to the workflow, including references, workflow metadata, artifacts, outputs, and logs. |
| References drawer | Enables or disables project-level reference files and folders. |
| Skills drawer | Enables project-level skills and supports node-level automatic or manual skill selection. |
| Snapshots drawer | Creates manual snapshots and lists previous Git-backed workflow checkpoints. |
| Stream output | Displays process summaries, tool calls, stage results, AI replies, node status events, approvals, errors, and snapshots. |
| Workflow composer | Sends project-level or node-level messages, slash commands, and file attachments into the workflow. |

## UI showcase placeholders

No screenshot files are committed yet. These placeholders are intentionally plain text so the README never renders broken images.

| Slot | Intended future asset | Alt text / caption |
| --- | --- | --- |
| Workbench overview | `docs/assets/workflow-workbench-overview.png` | Hermes Workflow Workbench showing the project sidebar, workflow canvas, node drawer, and stream output. |
| Intake and clarification | `docs/assets/workflow-intake-clarification.png` | New Workflow intake screen with project configuration, clarification questions, and planning summary. |
| Canvas execution | `docs/assets/workflow-canvas-execution.png` | Workflow graph running in semi-auto mode with the current node highlighted. |
| Node review drawer | `docs/assets/workflow-node-review-drawer.png` | Node detail drawer showing review controls, artifacts, file changes, references, and skills. |
| Stream and artifacts | `docs/assets/workflow-stream-artifacts.png` | Stream output panel with tool calls, AI replies, stage results, snapshots, and generated artifacts. |

## Workflow lifecycle in the app

1. Create or open a workflow project.
2. Add the task goal, project directory, and reference files.
3. Let Hermes ask clarification questions and build a planning summary.
4. Confirm generation so the backend writes `workflow.flow.json`.
5. Inspect or edit nodes, prompts, references, skills, models, and edges.
6. Choose `single_step`, `semi_auto`, or `auto`, then start the run.
7. Watch stream events and follow the current node on the canvas.
8. Review artifacts and file changes at review gates.
9. Pass, fail, return, retry, skip, pause, resume, or stop as needed.
10. Use snapshots and export to preserve or share the project.

## Install

### Install with Hermes

Add `--include-desktop` to the one-line installer and it sets up the runtime and desktop app together:

```bash
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash -s -- --include-desktop
```

If the Hermes CLI is already installed, launch the desktop app with:

```bash
hermes desktop
```

The desktop app uses the same provider configuration, model settings, credentials, sessions, tools, and skills as the underlying Hermes runtime.

### Prebuilt installers

Prebuilt installers are distributed through the existing Hermes desktop release channel:

```text
https://hermes-agent.nousresearch.com/desktop
```

## Development

Install workspace dependencies from the repo root once, then run the desktop app from this directory:

```bash
npm install
cd apps/desktop
npm run dev
```

Useful development modes:

```bash
HERMES_DESKTOP_HERMES_ROOT=/path/to/clone npm run dev
HERMES_HOME=/tmp/hermes-workflow-dev npm run dev
npm run dev:fake-boot
```

The app starts a Vite renderer and Electron main process. Electron boots the Python backend, then the renderer talks to the backend over the existing dashboard APIs plus the workflow API under `/api/workflows`.

## Build

```bash
npm run dist:mac
npm run dist:win
npm run dist:linux
npm run pack
```

Signing and notarization still use the existing Electron Builder credential flow when the relevant environment variables are present.

## Verification

Run before opening a PR:

```bash
npm run fix
npm run type-check
npm run lint
npm run test:desktop:all
```

For workflow backend changes, also run the focused Python tests from the repo root:

```bash
python -m pytest tests/test_workflow_api.py -q
```

## Troubleshooting

Boot logs are written to:

```text
HERMES_HOME/logs/desktop.log
```

Default Hermes homes:

```text
macOS/Linux: ~/.hermes
Windows:     %LOCALAPPDATA%\hermes
```

Force a clean first-launch setup on macOS/Linux:

```bash
rm "$HOME/.hermes/hermes-agent/.hermes-bootstrap-complete"
rm -rf "$HOME/.hermes/hermes-agent/venv"
```

Force a clean first-launch setup on Windows PowerShell:

```powershell
Remove-Item "$env:LOCALAPPDATA\hermes\hermes-agent\.hermes-bootstrap-complete"
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\hermes\hermes-agent\venv"
```

## License

MIT - see [LICENSE](../../LICENSE).

Built by [Nous Research](https://nousresearch.com).
