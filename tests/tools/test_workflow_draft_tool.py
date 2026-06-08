"""Tests for the normal-chat workflow draft proposal tool."""

import json

from tools.workflow_draft_tool import (
    note_workflow_clarification,
    reset_workflow_planning,
    start_workflow_planning,
    workflow_draft_propose_tool,
)


def _workflow():
    return {
        "id": "workflow-draft",
        "title": "Draft Workflow",
        "nodes": [
            {"id": "task-1", "title": "Collect inputs", "type": "task", "description": "Collect required inputs."},
            {"id": "review-1", "title": "Review result", "type": "review", "description": "Review the result."},
        ],
        "edges": [
            {
                "id": "edge-1",
                "source": "task-1",
                "sourceHandle": "success",
                "target": "review-1",
                "targetHandle": "input",
            }
        ],
        "updatedAt": "2026-06-07T00:00:00Z",
    }


def test_workflow_planning_requires_two_clarifications_before_draft():
    task_id = "session-workflow-guard"
    reset_workflow_planning(task_id)
    start_workflow_planning(task_id)

    result = json.loads(
        workflow_draft_propose_tool(
            draft_markdown="## Draft",
            workflow=_workflow(),
            clarification_summary="summary",
            task_id=task_id,
        )
    )

    assert "error" in result
    assert "clarification answers are required" in result["error"]

    note_workflow_clarification(task_id)
    note_workflow_clarification(task_id)

    result = json.loads(
        workflow_draft_propose_tool(
            draft_markdown="## Draft",
            workflow=_workflow(),
            clarification_summary="summary",
            task_id=task_id,
        )
    )

    assert result["draftMarkdown"] == "## Draft"
    assert result["clarificationSummary"] == "summary"
    assert result["workflow"]["title"] == "Draft Workflow"


def test_workflow_draft_tool_still_works_outside_guarded_planning_session():
    result = json.loads(
        workflow_draft_propose_tool(
            draft_markdown="## Draft",
            workflow=_workflow(),
            clarification_summary="summary",
            task_id="",
        )
    )

    assert "error" not in result
    assert result["workflow"]["nodes"][0]["id"] == "task-1"


def test_workflow_draft_tool_derives_missing_workflow_title():
    workflow = _workflow()
    workflow.pop("title")

    result = json.loads(
        workflow_draft_propose_tool(
            draft_markdown="# Derived Draft Title\n\n- Plan\n- Execute",
            workflow=workflow,
            clarification_summary="summary",
            task_id="",
        )
    )

    assert "error" not in result
    assert result["workflow"]["title"] == "Derived Draft Title"


def test_workflow_draft_tool_omits_preview_for_invalid_draft():
    result = json.loads(
        workflow_draft_propose_tool(
            draft_markdown="# Full Invalid Draft\n\nThis long draft should not be returned on validation failure.",
            workflow={
                "id": "workflow-invalid",
                "title": "Invalid Draft",
                "nodes": [],
                "edges": [],
                "updatedAt": "2026-06-07T00:00:00Z",
            },
            clarification_summary="summary",
            task_id="",
        )
    )

    assert result["error"] == "workflow.nodes must be a non-empty array."
    assert result["draftPreviewOmitted"] is True
    assert "validationIssues" in result
    assert "overview" in result
    assert "draftMarkdown" not in result
    assert "workflow" not in result


def test_workflow_draft_tool_derives_missing_workflow_id():
    workflow = _workflow()
    workflow.pop("id")
    workflow.pop("title")

    result = json.loads(
        workflow_draft_propose_tool(
            draft_markdown="# Derived Draft Title\n\n- Plan\n- Execute",
            workflow=workflow,
            clarification_summary="summary",
            task_id="",
        )
    )

    assert "error" not in result
    assert result["workflow"]["id"].startswith("wf-")
    assert result["workflow"]["title"] == "Derived Draft Title"


def test_workflow_draft_tool_normalizes_node_and_edge_transport_fields():
    workflow = _workflow()
    workflow.pop("id")
    workflow["nodes"][0].pop("id")
    workflow["edges"][0].pop("id")
    workflow["edges"][0].pop("sourceHandle")
    workflow["edges"][0].pop("targetHandle")
    workflow["edges"][0]["source"] = "collect-inputs"

    result = json.loads(
        workflow_draft_propose_tool(
            draft_markdown="## Draft",
            workflow=workflow,
            clarification_summary="summary",
            task_id="",
        )
    )

    assert "error" not in result
    assert result["workflow"]["nodes"][0]["id"] == "collect-inputs"
    assert result["workflow"]["edges"][0]["id"].startswith("edge-collect-inputs-review-1")
    assert result["workflow"]["edges"][0]["sourceHandle"] == "success"
    assert result["workflow"]["edges"][0]["targetHandle"] == "input"


def test_workflow_draft_tool_rejects_ordinary_node_failure_output():
    workflow = _workflow()
    workflow["edges"].append(
        {
            "id": "edge-failure",
            "source": "task-1",
            "sourceHandle": "failure",
            "target": "review-1",
            "targetHandle": "input",
        }
    )

    result = json.loads(
        workflow_draft_propose_tool(
            draft_markdown="## Draft",
            workflow=workflow,
            clarification_summary="summary",
            task_id="",
        )
    )

    assert result["draftPreviewOmitted"] is True
    assert any("cannot use a failure output" in issue for issue in result["validationIssues"])
