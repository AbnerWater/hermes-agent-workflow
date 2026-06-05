import threading
import json
import sys
import types
import zipfile


class FakeWorkflowAgentRunner:
    def run(self, *, project, prompt, session_id, node=None, run=None, system_prompt=None, max_iterations=18, **kwargs):
        from hermes_cli import workflow_api as wf

        if "Create the next clarification batch" in prompt or "Repair the previous workflow intake response" in prompt:
            if "Latest structured answers JSON:\n[]" in prompt or "Latest structured answers JSON:" not in prompt:
                return wf.WorkflowAgentResult(
                    session_id=session_id,
                    text=json.dumps(
                        {
                            "reply": "Choose the key workflow planning preferences.",
                            "ready": False,
                            "summary": "Initial workflow draft context.",
                            "questions": [
                                {
                                    "id": "delivery",
                                    "question": "What should the final delivery optimize for?",
                                    "detail": "This affects node ordering and review gates.",
                                    "options": [
                                        {
                                            "id": "validated-report",
                                            "label": "Validated report",
                                            "description": "Prioritize evidence and acceptance checks.",
                                            "priority": 1,
                                        },
                                        {
                                            "id": "working-code",
                                            "label": "Working code",
                                            "description": "Prioritize implementation and runnable artifacts.",
                                            "priority": 2,
                                        },
                                        {
                                            "id": "research-plan",
                                            "label": "Research plan",
                                            "description": "Prioritize exploration and risk discovery.",
                                            "priority": 3,
                                        },
                                    ],
                                }
                            ],
                        }
                    ),
                )
            return wf.WorkflowAgentResult(
                session_id=session_id,
                text=json.dumps(
                    {
                        "reply": "The workflow plan is ready.",
                        "ready": True,
                        "summary": "Final summary from structured clarification answers.",
                        "questions": [],
                    }
                ),
            )

        if "Return JSON matching this shape exactly" in prompt:
            result = wf.WorkflowAgentResult(
                session_id=session_id,
                text=json.dumps(
                    {
                        "title": project.name,
                        "nodes": [
                            {
                                "id": "intake",
                                "type": "planning",
                                "title": "任务澄清",
                                "description": "Clarify task scope.",
                                "reviewRules": {"required": False, "checklist": ["scope"]},
                            },
                            {
                                "id": "strategy",
                                "type": "review",
                                "title": "执行策略",
                                "description": "Create execution strategy.",
                                "reviewRules": {"required": True, "checklist": ["plan"]},
                            },
                            {
                                "id": "delivery",
                                "type": "delivery",
                                "title": "最终交付",
                                "description": "Deliver result.",
                                "reviewRules": {"required": True, "checklist": ["done"]},
                            },
                        ],
                        "edges": [
                            {"id": "edge-intake-strategy", "source": "intake", "target": "strategy"},
                            {"id": "edge-strategy-delivery", "source": "strategy", "target": "delivery"},
                            {"id": "edge-strategy-intake", "source": "strategy", "target": "intake", "type": "feedback"},
                        ],
                    }
                ),
            )
            self._append_final_event(wf, project, result, node=node, run=run, **kwargs)
            return result

        if "Return only JSON: {\"reply\"" in prompt:
            return wf.WorkflowAgentResult(
                session_id=session_id,
                text=json.dumps({"reply": "已生成 patch proposal", "patch": {"op": "comment", "text": "ok"}}),
            )

        result = wf.WorkflowAgentResult(session_id=session_id, text=f"Agent completed {node.title if node else project.name}.")
        self._append_final_event(wf, project, result, node=node, run=run, **kwargs)
        return result

    def _append_final_event(self, wf, project, result, *, node=None, run=None, **kwargs):
        if kwargs.get("persist_final", True) is False:
            return
        wf._append_event(
            project.id,
            wf.StreamEvent(
                id=wf._new_id("evt"),
                projectId=project.id,
                runId=run.id if run else None,
                nodeId=node.id if node else None,
                type="ai_reply",
                label=kwargs.get("message_label") or "AI 回复",
                summary=result.text,
                details={"messageId": wf._new_id("msg"), "text": result.text, "final": True, "rawReasoningExposed": False},
                status="success",
            ),
        )


def _fake_git_for_workflow_tests(_root, *args):
    if args[:2] == ("rev-parse", "HEAD"):
        return "c" * 40
    if args and args[0] == "log":
        return f"{'c' * 40}\x1f1700000000\x1fworkflow: test"
    return ""


def _feedback_workflow(wf, *, review_status="waiting_user_confirm"):
    return wf.Workflow(
        id="wf_feedback",
        title="Feedback Workflow",
        nodes=[
            wf.WorkflowNode(id="plan", type="planning", title="Plan", status="completed", maxRetries=2),
            wf.WorkflowNode(id="implement", type="execution", title="Implement", status="completed", maxRetries=2),
            wf.WorkflowNode(
                id="review",
                type="review",
                title="Review",
                status=review_status,
                reviewRules=wf.ReviewRules(required=True, checklist=["passes"]),
            ),
            wf.WorkflowNode(id="delivery", type="delivery", title="Delivery", status="created"),
        ],
        edges=[
            wf.WorkflowEdge(id="edge-plan-implement", source="plan", target="implement"),
            wf.WorkflowEdge(id="edge-implement-review", source="implement", target="review"),
            wf.WorkflowEdge(id="edge-review-delivery", source="review", target="delivery"),
            wf.WorkflowEdge(id="edge-review-plan", source="review", target="plan", type="feedback", label="Revise plan"),
        ],
    )


def _create_feedback_project(tmp_path, monkeypatch):
    from hermes_cli import workflow_api as wf

    monkeypatch.setattr(wf, "_git_init", lambda _root: None)
    monkeypatch.setattr(wf, "_git", _fake_git_for_workflow_tests)
    monkeypatch.setattr(wf._runtime, "start", lambda *_args, **_kwargs: None)
    project = wf._create_project(wf.ProjectCreateRequest(name="Feedback Workflow", root=str(tmp_path / "feedback")))
    wf._register_project(project)
    workflow = _feedback_workflow(wf)
    wf._save_workflow(project, workflow)
    run = wf.ExecutionRun(
        id="run_feedback",
        projectId=project.id,
        mode="semi_auto",
        status="waiting_user_confirm",
        currentNodeId="review",
    )
    wf._save_run(run)
    return wf, project, workflow, run


def test_workflow_feedback_confirm_promotes_normal_downstream(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    wf, project, _workflow, run = _create_feedback_project(tmp_path, monkeypatch)
    app = FastAPI()
    app.include_router(wf.create_workflow_router(lambda _ws: True))
    client = TestClient(app)

    response = client.post(f"/api/workflows/runs/{run.id}/nodes/review/confirm")

    assert response.status_code == 200
    updated = wf._load_workflow(project)
    statuses = {node.id: node.status for node in updated.nodes}
    assert statuses["plan"] == "completed"
    assert statuses["implement"] == "completed"
    assert statuses["review"] == "completed"
    assert statuses["delivery"] == "ready"


def test_workflow_feedback_return_resets_rework_path(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    wf, project, _workflow, run = _create_feedback_project(tmp_path, monkeypatch)
    app = FastAPI()
    app.include_router(wf.create_workflow_router(lambda _ws: True))
    client = TestClient(app)

    response = client.post(
        f"/api/workflows/runs/{run.id}/nodes/review/return",
        json={"targetNodeId": "plan", "reason": "Acceptance checks failed."},
    )

    assert response.status_code == 200
    updated = wf._load_workflow(project)
    by_id = {node.id: node for node in updated.nodes}
    updated_run = wf._load_run(run.id)
    assert by_id["plan"].status == "ready"
    assert by_id["plan"].retryCount == 1
    assert by_id["implement"].status == "revision_needed"
    assert by_id["review"].status == "revision_needed"
    assert by_id["delivery"].status == "created"
    assert by_id["review"].outputs["returnTargetId"] == "plan"
    assert by_id["review"].outputs["reviewDecision"]["decision"] == "return"
    assert updated_run.status == "running"
    assert updated_run.currentNodeId == "plan"


def test_workflow_feedback_return_rejects_invalid_target(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    wf, _project, _workflow, run = _create_feedback_project(tmp_path, monkeypatch)
    app = FastAPI()
    app.include_router(wf.create_workflow_router(lambda _ws: True))
    client = TestClient(app)

    response = client.post(
        f"/api/workflows/runs/{run.id}/nodes/review/return",
        json={"targetNodeId": "delivery", "reason": "Invalid return."},
    )

    assert response.status_code == 422


def test_workflow_auto_review_pass_and_return_decisions(tmp_path, monkeypatch):
    from hermes_cli import workflow_api as wf

    class ReviewDecisionRunner:
        def __init__(self, text):
            self.text = text

        def run(self, *, session_id, **_kwargs):
            return wf.WorkflowAgentResult(session_id=session_id, text=self.text)

    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "home"))
    monkeypatch.setattr(wf, "_git_init", lambda _root: None)
    monkeypatch.setattr(wf, "_git", _fake_git_for_workflow_tests)

    pass_project = wf._create_project(wf.ProjectCreateRequest(name="Auto Pass", root=str(tmp_path / "auto-pass")))
    wf._register_project(pass_project)
    pass_workflow = _feedback_workflow(wf, review_status="ready")
    wf._save_workflow(pass_project, pass_workflow)
    pass_run = wf.ExecutionRun(id="run_auto_pass", projectId=pass_project.id, mode="auto", status="running")
    wf._save_run(pass_run)
    monkeypatch.setattr(
        wf,
        "_agent_runner",
        ReviewDecisionRunner('<workflow_review_decision>{"decision":"pass","targetNodeId":null,"reason":"All checks passed."}</workflow_review_decision>'),
    )
    wf._execute_node(pass_project, pass_workflow, pass_run, wf._node_by_id(pass_workflow, "review"))
    pass_statuses = {node.id: node.status for node in wf._load_workflow(pass_project).nodes}
    assert pass_statuses["review"] == "completed"
    assert pass_statuses["delivery"] == "ready"

    return_project = wf._create_project(wf.ProjectCreateRequest(name="Auto Return", root=str(tmp_path / "auto-return")))
    wf._register_project(return_project)
    return_workflow = _feedback_workflow(wf, review_status="ready")
    wf._save_workflow(return_project, return_workflow)
    return_run = wf.ExecutionRun(id="run_auto_return", projectId=return_project.id, mode="auto", status="running")
    wf._save_run(return_run)
    monkeypatch.setattr(
        wf,
        "_agent_runner",
        ReviewDecisionRunner('<workflow_review_decision>{"decision":"return","targetNodeId":"plan","reason":"Coverage gap."}</workflow_review_decision>'),
    )
    wf._execute_node(return_project, return_workflow, return_run, wf._node_by_id(return_workflow, "review"))
    return_by_id = {node.id: node for node in wf._load_workflow(return_project).nodes}
    assert return_by_id["plan"].status == "ready"
    assert return_by_id["plan"].retryCount == 1
    assert return_by_id["implement"].status == "revision_needed"
    assert return_by_id["review"].status == "revision_needed"


def test_workflow_project_generate_and_run_reaches_review_gate(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "home"))

    from hermes_cli import workflow_api as wf

    def fake_git(_root, *args):
        if args[:2] == ("rev-parse", "HEAD"):
            return "a" * 40
        if args and args[0] == "log":
            return f"{'a' * 40}\x1f1700000000\x1fworkflow: Project initialized"
        return ""

    monkeypatch.setattr(wf, "_git", fake_git)
    monkeypatch.setattr(wf, "_agent_runner", FakeWorkflowAgentRunner())

    project = wf._create_project(
        wf.ProjectCreateRequest(
            name="Demo Workflow",
            goal="Build a workflow-first agent workbench.",
            root=str(tmp_path / "demo"),
        )
    )
    wf._register_project(project)

    assert (tmp_path / "demo" / ".agent-workflow" / "project.json").exists()
    assert (tmp_path / "demo" / ".agent-workflow" / "workflow.db").exists()
    assert (tmp_path / "demo" / "references").is_dir()

    assert wf._generate_workflow_for_project(project, reason="test") is None
    workflow = wf._load_workflow(project)
    assert workflow.nodes
    assert workflow.nodes[0].llmGenerated

    run = wf.ExecutionRun(id="run_test", projectId=project.id, mode="semi_auto", status="running", maxConcurrency=2)
    wf._save_run(run)

    wf._run_engine(project.id, run.id, threading.Event())

    updated_workflow = wf._load_workflow(project)
    statuses = {node.id: node.status for node in updated_workflow.nodes}
    updated_run = wf._load_run(run.id)
    events = wf._read_events(project, since=None, limit=50)

    assert statuses["intake"] == "completed"
    assert statuses["strategy"] == "waiting_user_confirm"
    assert updated_run.status == "waiting_user_confirm"
    assert any(event.type == "approval" and event.nodeId == "strategy" for event in events)
    assert any(event.type == "ai_reply" and event.nodeId == "intake" for event in events)


def test_workflow_intake_creates_draft_answers_and_confirms_generation(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "home"))

    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from hermes_cli import workflow_api as wf

    def fake_git(_root, *args):
        if args[:2] == ("rev-parse", "HEAD"):
            return "b" * 40
        if args and args[0] == "log":
            return f"{'b' * 40}\x1f1700000000\x1fworkflow: Project initialized"
        return ""

    monkeypatch.setattr(wf, "_git_init", lambda _root: None)
    monkeypatch.setattr(wf, "_git", fake_git)
    monkeypatch.setattr(wf, "_agent_runner", FakeWorkflowAgentRunner())

    app = FastAPI()
    app.include_router(wf.create_workflow_router(lambda _ws: True))
    client = TestClient(app)

    started = client.post(
        "/api/workflows/intake/start",
        json={
            "name": "Intake Workflow",
            "goal": "Build a workflow from structured clarification.",
            "root": str(tmp_path / "intake"),
            "references": [],
        },
    )
    assert started.status_code == 200
    start_data = started.json()
    assert start_data["projectId"]
    assert start_data["ready"] is False
    assert start_data["currentBatch"]["questions"]
    assert len(start_data["currentBatch"]["questions"][0]["options"]) == 3
    project = wf._load_project(start_data["projectId"])
    assert project.status == "clarifying"
    assert (tmp_path / "intake" / ".agent-workflow" / "intake.state.json").exists()

    question = start_data["currentBatch"]["questions"][0]
    answered = client.post(
        f"/api/workflows/intake/{start_data['intakeId']}/answers",
        json={
            "answers": [
                {
                    "questionId": question["id"],
                    "optionId": question["options"][0]["id"],
                    "answer": question["options"][0]["label"],
                    "custom": False,
                }
            ]
        },
    )
    assert answered.status_code == 200
    answered_data = answered.json()
    assert answered_data["ready"] is True
    assert answered_data["summary"] == "Final summary from structured clarification answers."
    assert answered_data["answeredCount"] == 1

    confirmed = client.post(
        f"/api/workflows/intake/{start_data['intakeId']}/confirm",
        json={
            "name": "Intake Workflow",
            "goal": "Build a workflow from structured clarification.",
            "root": str(tmp_path / "intake"),
            "references": [],
            "projectId": start_data["projectId"],
            "summary": answered_data["summary"],
        },
    )
    assert confirmed.status_code == 200
    bundle = confirmed.json()
    assert bundle["project"]["id"] == start_data["projectId"]
    assert bundle["project"]["status"] == "generated"
    assert bundle["workflow"]["nodes"]


def test_workflow_chat_uses_agent_patch(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "home"))

    from hermes_cli import workflow_api as wf

    monkeypatch.setattr(wf, "_git", lambda _root, *args: "a" * 40 if args[:2] == ("rev-parse", "HEAD") else "")
    monkeypatch.setattr(wf, "_agent_runner", FakeWorkflowAgentRunner())

    project = wf._create_project(wf.ProjectCreateRequest(name="Chat Workflow", root=str(tmp_path / "chat")))
    wf._register_project(project)
    assert wf._generate_workflow_for_project(project, reason="test") is None
    workflow = wf._load_workflow(project)
    reply, patch = wf._chat_result_from_agent_text(
        FakeWorkflowAgentRunner()
        .run(project=project, prompt='Return only JSON: {"reply"', session_id="sid")
        .text,
        workflow,
        wf.ChatRequest(text="调整策略", nodeId=workflow.nodes[0].id),
    )

    assert reply == "已生成 patch proposal"
    assert patch["op"] == "comment"


def test_workflow_stream_delta_is_transient_and_final_is_persisted(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "home"))

    from hermes_cli import workflow_api as wf

    monkeypatch.setattr(wf, "_git", lambda _root, *args: "")

    project = wf._create_project(wf.ProjectCreateRequest(name="Stream Workflow", root=str(tmp_path / "stream")))
    wf._register_project(project)

    delta = wf.StreamEvent(
        id="evt_delta",
        projectId=project.id,
        type="ai_reply",
        label="AI 输出",
        summary="partial",
        details={"messageId": "msg_1", "text": "partial", "streaming": True},
    )
    wf._append_event(project.id, delta, persist=False)

    final = wf.StreamEvent(
        id="evt_final",
        projectId=project.id,
        type="ai_reply",
        label="AI 输出",
        summary="final",
        details={"messageId": "msg_1", "text": "final", "final": True},
    )
    wf._append_event(project.id, final)

    events = wf._read_events(project, since=None, limit=20)
    jsonl = list((tmp_path / "stream" / ".agent-workflow" / "stream-events").glob("*.jsonl"))

    assert any(event.id == "evt_delta" for event in events)
    assert any(event.id == "evt_final" for event in events)
    assert jsonl
    persisted_text = "".join(path.read_text(encoding="utf-8") for path in jsonl)
    assert "evt_final" in persisted_text
    assert "evt_delta" not in persisted_text


def test_workflow_agent_runner_uses_workflow_history_not_session_db(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "home"))

    from hermes_cli import workflow_api as wf

    captured = {"init": [], "history": []}

    class FakeAIAgent:
        def __init__(self, **kwargs):
            captured["init"].append(kwargs)
            self.session_id = kwargs.get("session_id")

        def run_conversation(self, prompt, conversation_history=None, stream_callback=None, task_id=None):
            captured["history"].append(list(conversation_history or []))
            if stream_callback:
                stream_callback("partial")
            return {"final_response": f"done: {prompt}"}

    run_agent_mod = types.ModuleType("run_agent")
    run_agent_mod.AIAgent = FakeAIAgent

    tui_gateway_pkg = types.ModuleType("tui_gateway")
    tui_gateway_server = types.ModuleType("tui_gateway.server")
    tui_gateway_server._load_enabled_toolsets = lambda: ["file", "memory", "session_search"]
    tui_gateway_server._load_reasoning_config = lambda: {}
    tui_gateway_server._load_service_tier = lambda: None
    tui_gateway_server._resolve_startup_runtime = lambda: ("test-model", "test-provider")

    runtime_provider_mod = types.ModuleType("hermes_cli.runtime_provider")
    runtime_provider_mod.resolve_runtime_provider = lambda requested=None, target_model=None: {
        "provider": requested,
        "base_url": None,
        "api_key": None,
        "api_mode": None,
        "command": None,
        "args": None,
        "credential_pool": None,
    }

    monkeypatch.setitem(sys.modules, "run_agent", run_agent_mod)
    monkeypatch.setitem(sys.modules, "tui_gateway", tui_gateway_pkg)
    monkeypatch.setitem(sys.modules, "tui_gateway.server", tui_gateway_server)
    monkeypatch.setitem(sys.modules, "hermes_cli.runtime_provider", runtime_provider_mod)
    monkeypatch.setattr(wf, "_git", lambda _root, *args: "")
    monkeypatch.setattr(wf, "_set_workflow_session_context", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(wf, "_clear_workflow_session_context", lambda _tokens: None)

    project = wf._create_project(wf.ProjectCreateRequest(name="Isolated Workflow", root=str(tmp_path / "isolated")))
    wf._register_project(project)

    runner = wf.WorkflowAgentRunner()
    runner.run(project=project, prompt="first workflow turn", session_id="workflow-project-test")
    runner.run(project=project, prompt="second workflow turn", session_id="workflow-project-test")

    assert captured["init"]
    first_init = captured["init"][0]
    assert first_init["session_db"] is None
    assert first_init["skip_memory"] is True
    assert "memory" not in first_init["enabled_toolsets"]
    assert "session_search" not in first_init["enabled_toolsets"]
    assert "memory" in first_init["disabled_toolsets"]
    assert "session_search" in first_init["disabled_toolsets"]
    assert captured["history"][0] == []
    assert captured["history"][1] == [
        {"role": "user", "content": "first workflow turn"},
        {"role": "assistant", "content": "done: first workflow turn"},
    ]


def test_node_file_changes_collect_untracked_output_file(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "home"))

    from hermes_cli import workflow_api as wf

    def fake_git(_root, *args):
        if args and args[0] == "status":
            return "?? outputs/result.txt"
        return ""

    monkeypatch.setattr(wf, "_git", fake_git)

    project = wf._create_project(wf.ProjectCreateRequest(name="Diff Workflow", root=str(tmp_path / "diff")))
    wf._register_project(project)
    output = tmp_path / "diff" / "outputs" / "result.txt"
    output.write_text("line one\nline two\n", encoding="utf-8")

    changes = wf._collect_node_file_changes(project, before_paths=set())

    assert len(changes) == 1
    assert changes[0].path == "outputs/result.txt"
    assert changes[0].status == "added"
    assert changes[0].isArtifact
    assert not changes[0].isBinary
    assert changes[0].previewable
    assert "+line one" in changes[0].diff


def test_node_file_changes_omit_binary_untracked_preview(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "home"))

    from hermes_cli import workflow_api as wf

    def fake_git(_root, *args):
        if args and args[0] == "status":
            return "?? outputs/image.png"
        return ""

    monkeypatch.setattr(wf, "_git", fake_git)

    project = wf._create_project(wf.ProjectCreateRequest(name="Binary Workflow", root=str(tmp_path / "binary")))
    wf._register_project(project)
    image = tmp_path / "binary" / "outputs" / "image.png"
    image.parent.mkdir(parents=True, exist_ok=True)
    image.write_bytes(b"\x89PNG\r\n\x1a\n\x00binary")

    changes = wf._collect_node_file_changes(project, before_paths=set())

    assert len(changes) == 1
    assert changes[0].path == "outputs/image.png"
    assert changes[0].isArtifact
    assert changes[0].isBinary
    assert not changes[0].previewable
    assert changes[0].diff == ""


def test_node_file_changes_omit_git_binary_diff_preview(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "home"))

    from hermes_cli import workflow_api as wf

    def fake_git(_root, *args):
        if args and args[0] == "status":
            return " M outputs/blob.bin"
        if args and args[0] == "diff":
            return "Binary files a/outputs/blob.bin and b/outputs/blob.bin differ\n"
        return ""

    monkeypatch.setattr(wf, "_git", fake_git)

    project = wf._create_project(wf.ProjectCreateRequest(name="Binary Diff Workflow", root=str(tmp_path / "binary-diff")))
    wf._register_project(project)

    changes = wf._collect_node_file_changes(project, before_paths={"outputs/blob.bin"})

    assert len(changes) == 1
    assert changes[0].path == "outputs/blob.bin"
    assert changes[0].status == "modified"
    assert changes[0].isBinary
    assert not changes[0].previewable
    assert changes[0].diff == ""


def test_workflow_project_actions_archive_and_remove_history(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "home"))

    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from hermes_cli import workflow_api as wf

    monkeypatch.setattr(wf, "_git_init", lambda _root: None)

    project = wf._create_project(wf.ProjectCreateRequest(name="Action Workflow", root=str(tmp_path / "action")))
    wf._register_project(project)

    app = FastAPI()
    app.include_router(wf.create_workflow_router(lambda _ws: True))
    client = TestClient(app)

    listed = client.get("/api/workflows/projects")
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()["projects"]] == [project.id]

    patched = client.patch(f"/api/workflows/projects/{project.id}", json={"name": "Renamed Workflow", "archived": True})
    assert patched.status_code == 200
    assert patched.json()["project"]["name"] == "Renamed Workflow"
    assert patched.json()["project"]["archived"] is True

    assert client.get("/api/workflows/projects").json()["projects"] == []
    archived = client.get("/api/workflows/projects?include_archived=true").json()["projects"]
    assert [item["id"] for item in archived] == [project.id]

    removed = client.delete(f"/api/workflows/projects/{project.id}")
    assert removed.status_code == 200
    assert removed.json()["rootPreserved"] is True
    assert (tmp_path / "action").exists()
    assert project.id not in wf._read_registry()

    alias_project = wf._create_project(
        wf.ProjectCreateRequest(name="Remove Alias Workflow", root=str(tmp_path / "remove-alias"))
    )
    wf._register_project(alias_project)

    alias_removed = client.post(f"/api/workflows/projects/{alias_project.id}/remove-from-history")
    assert alias_removed.status_code == 200
    assert alias_removed.json()["rootPreserved"] is True
    assert (tmp_path / "remove-alias").exists()
    assert alias_project.id not in wf._read_registry()


def test_workflow_project_export_zip_excludes_heavy_and_runtime_paths(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "home"))

    from hermes_cli import workflow_api as wf

    monkeypatch.setattr(wf, "_git_init", lambda _root: None)

    project = wf._create_project(wf.ProjectCreateRequest(name="Export Workflow", root=str(tmp_path / "export")))
    root = tmp_path / "export"
    (root / "outputs" / "result.txt").write_text("keep", encoding="utf-8")
    (root / ".git").mkdir(exist_ok=True)
    (root / ".git" / "config").write_text("skip", encoding="utf-8")
    (root / "node_modules" / "pkg").mkdir(parents=True)
    (root / "node_modules" / "pkg" / "index.js").write_text("skip", encoding="utf-8")
    (root / ".agent-workflow" / "workflow.db-wal").write_text("skip", encoding="utf-8")

    archive_path = wf._create_project_export_zip(project)
    try:
        with zipfile.ZipFile(archive_path) as archive:
            names = set(archive.namelist())
    finally:
        wf._safe_unlink(archive_path)

    assert "outputs/result.txt" in names
    assert ".agent-workflow/project.json" in names
    assert ".git/config" not in names
    assert "node_modules/pkg/index.js" not in names
    assert ".agent-workflow/workflow.db-wal" not in names


def test_workflow_validation_allows_feedback_but_rejects_dependency_cycle():
    from fastapi import HTTPException

    from hermes_cli import workflow_api as wf

    base_nodes = [
        wf.WorkflowNode(id="a", title="A"),
        wf.WorkflowNode(id="b", title="B"),
    ]

    feedback = wf.Workflow(
        id="wf",
        title="ok",
        nodes=base_nodes,
        edges=[
            wf.WorkflowEdge(id="ab", source="a", target="b"),
            wf.WorkflowEdge(id="ba", source="b", target="a", type="feedback"),
        ],
    )
    wf._validate_workflow(feedback)

    cyclic = wf.Workflow(
        id="wf",
        title="bad",
        nodes=base_nodes,
        edges=[
            wf.WorkflowEdge(id="ab", source="a", target="b"),
            wf.WorkflowEdge(id="ba", source="b", target="a"),
        ],
    )

    try:
        wf._validate_workflow(cyclic)
    except HTTPException as exc:
        assert exc.status_code == 422
    else:
        raise AssertionError("dependency cycle should be rejected")
