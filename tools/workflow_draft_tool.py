#!/usr/bin/env python3
"""Workflow draft proposal tool.

This tool is intentionally side-effect free: it only captures a structured
workflow draft inside a normal chat session. The desktop UI can then preview or
initialize the draft into a formal workflow project.
"""

import json
import re
import threading
import time
from typing import Any, Dict, List


MIN_WORKFLOW_CLARIFICATIONS = 2
DECISION_NODE_TYPES = {"review", "test", "testing"}
ORDINARY_NODE_TYPES = {"task", "planning", "reference", "execution", "delivery"}
_planning_lock = threading.RLock()
_planning_state: Dict[str, Dict[str, Any]] = {}


def _clean_string_list(values: Any) -> List[str]:
    if not isinstance(values, list):
        return []
    result = []
    for value in values:
        text = str(value or "").strip()
        if text:
            result.append(text)
    return result


def _clean_title_candidate(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    text = text.lstrip("#").strip()
    while text[:1] in {"-", "*", ">", ":"}:
        text = text[1:].strip()
    if len(text) > 96:
        text = text[:96].rstrip()
    return text


def _slug(value: Any) -> str:
    text = str(value or "").strip().lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = re.sub(r"-{2,}", "-", text).strip("-")
    return text[:72]


def _unique_id(base: str, used: set[str]) -> str:
    candidate = base
    index = 2
    while candidate in used:
        candidate = f"{base}-{index}"
        index += 1
    return candidate


def _coerce_timestamp(value: Any) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    return time.time()


def _derive_workflow_title(workflow: Dict[str, Any], draft_markdown: str) -> str:
    title = _clean_title_candidate(workflow.get("title"))
    if title:
        return title

    for line in str(draft_markdown or "").splitlines():
        title = _clean_title_candidate(line)
        if title:
            return title

    nodes = workflow.get("nodes")
    if isinstance(nodes, list):
        for node in nodes:
            if isinstance(node, dict):
                title = _clean_title_candidate(node.get("title"))
                if title:
                    return title

    return "Hermes Workflow Project"


def _normalized_review_rules(raw: Any, *, decision_node: bool) -> Dict[str, Any]:
    rules = raw if isinstance(raw, dict) else {}
    checklist = _clean_string_list(rules.get("checklist"))
    return {
        "required": bool(rules.get("required", decision_node)),
        "checklist": checklist,
    }


def normalize_workflow_draft(workflow: Any, draft_markdown: str = "") -> tuple[Dict[str, Any] | None, List[str]]:
    """Normalize a model-proposed workflow draft without inventing nodes.

    Chat-session planning is less constrained than the legacy intake endpoint, so
    this accepts useful partial structure and fills transport fields such as ids,
    handles, positions, and timestamps before strict validation.
    """
    issues: List[str] = []
    if not isinstance(workflow, dict):
        return None, ["workflow must be an object."]

    nodes_raw = workflow.get("nodes")
    edges_raw = workflow.get("edges", [])
    if not isinstance(nodes_raw, list) or not nodes_raw:
        return None, ["workflow.nodes must be a non-empty array."]
    if not isinstance(edges_raw, list):
        issues.append("workflow.edges must be an array.")
        edges_raw = []

    normalized_nodes: List[Dict[str, Any]] = []
    used_node_ids: set[str] = set()
    node_types: Dict[str, str] = {}
    for index, node in enumerate(nodes_raw):
        if not isinstance(node, dict):
            issues.append(f"workflow.nodes[{index}] must be an object.")
            continue
        title = str(node.get("title") or node.get("name") or "").strip()
        node_type = str(node.get("type") or "").strip().lower()
        description = str(node.get("description") or node.get("summary") or "").strip()
        if not title:
            issues.append(f"workflow.nodes[{index}].title is required.")
        if not node_type:
            issues.append(f"workflow.nodes[{index}].type is required.")
        if not description:
            issues.append(f"workflow.nodes[{index}].description is required.")
        if not title or not node_type or not description:
            continue

        node_id = _unique_id(_slug(node.get("id") or title) or f"node-{index + 1}", used_node_ids)
        used_node_ids.add(node_id)
        node_types[node_id] = node_type
        position = node.get("position") if isinstance(node.get("position"), dict) else {}
        decision_node = node_type in DECISION_NODE_TYPES
        normalized = dict(node)
        normalized.update(
            {
                "id": node_id,
                "type": node_type,
                "title": title,
                "description": description,
                "position": {
                    "x": float(position.get("x", 60 + (index % 4) * 330)),
                    "y": float(position.get("y", 80 + (index // 4) * 190)),
                },
                "reviewRules": _normalized_review_rules(node.get("reviewRules"), decision_node=decision_node),
                "skills": _clean_string_list(node.get("skills")) if isinstance(node.get("skills"), list) else [],
                "optional": bool(node.get("optional", False)),
                "maxRetries": max(0, int(node.get("maxRetries", 1) or 1)),
                "llmGenerated": True,
            }
        )
        normalized_nodes.append(normalized)

    if not normalized_nodes:
        issues.append("workflow.nodes must include at least one valid node.")

    node_ids = {node["id"] for node in normalized_nodes}
    normalized_edges: List[Dict[str, Any]] = []
    outgoing_ports: set[tuple[str, str]] = set()
    for index, edge in enumerate(edges_raw):
        if not isinstance(edge, dict):
            issues.append(f"workflow.edges[{index}] must be an object.")
            continue
        source = str(edge.get("source") or "").strip()
        target = str(edge.get("target") or "").strip()
        if source not in node_ids:
            issues.append(f"workflow.edges[{index}].source references an unknown node.")
            continue
        if target not in node_ids:
            issues.append(f"workflow.edges[{index}].target references an unknown node.")
            continue
        if source == target:
            issues.append(f"workflow.edges[{index}] cannot connect a node to itself.")
            continue

        edge_type = str(edge.get("type") or "dependency").strip().lower() or "dependency"
        if edge_type not in {"dependency", "feedback"}:
            edge_type = "dependency"
        source_handle = str(edge.get("sourceHandle") or "").strip().lower()
        if source_handle not in {"success", "failure"}:
            source_handle = "failure" if edge_type == "feedback" else "success"
        if source_handle == "failure":
            edge_type = "feedback"
        target_handle = str(edge.get("targetHandle") or "input").strip().lower() or "input"
        if target_handle != "input":
            issues.append(f"workflow.edges[{index}].targetHandle must be 'input'.")
            continue
        if source_handle == "failure" and node_types.get(source) not in DECISION_NODE_TYPES:
            issues.append(f"Node {source} is not a review/test decision node and cannot use a failure output.")
            continue
        port_key = (source, source_handle)
        if port_key in outgoing_ports:
            issues.append(f"Node {source} output '{source_handle}' can connect to only one input.")
            continue
        outgoing_ports.add(port_key)

        edge_id = _unique_id(_slug(edge.get("id") or f"edge-{source}-{target}-{source_handle}") or f"edge-{index + 1}", {item["id"] for item in normalized_edges})
        normalized = dict(edge)
        normalized.update(
            {
                "id": edge_id,
                "source": source,
                "target": target,
                "type": edge_type,
                "sourceHandle": source_handle,
                "targetHandle": "input",
                "label": str(edge.get("label") or ""),
                "optional": bool(edge.get("optional", False)),
            }
        )
        normalized_edges.append(normalized)

    if issues:
        return None, issues

    title = _derive_workflow_title({**workflow, "nodes": normalized_nodes}, draft_markdown)
    workflow_id = _slug(workflow.get("id") or title) or "workflow-draft"
    normalized_workflow = dict(workflow)
    normalized_workflow.update(
        {
            "id": workflow_id if workflow_id.startswith("wf") else f"wf-{workflow_id}",
            "title": title,
            "nodes": normalized_nodes,
            "edges": normalized_edges,
            "updatedAt": _coerce_timestamp(workflow.get("updatedAt")),
        }
    )
    return normalized_workflow, []


def _workflow_error_overview(workflow: Any, draft_markdown: str, issues: List[str]) -> str:
    node_count = 0
    edge_count = 0
    title = "Untitled workflow draft"
    if isinstance(workflow, dict):
        title = _derive_workflow_title(workflow, draft_markdown)
        if isinstance(workflow.get("nodes"), list):
            node_count = len(workflow["nodes"])
        if isinstance(workflow.get("edges"), list):
            edge_count = len(workflow["edges"])

    lead = issues[0] if issues else "Workflow draft validation failed."
    return f"{lead} Draft overview: {title}; nodes={node_count}; edges={edge_count}."


def _workflow_validation_issues(workflow: Any) -> List[str]:
    _, issues = normalize_workflow_draft(workflow)
    return issues


def _validate_workflow_shape(workflow: Any, draft_markdown: str = "") -> Dict[str, Any] | List[str]:
    normalized, issues = normalize_workflow_draft(workflow, draft_markdown)
    if issues:
        return issues
    return normalized or {}


def start_workflow_planning(task_id: str, root: str = "", references: Any = None) -> None:
    """Mark a normal chat session/task as actively planning a workflow."""
    task_key = str(task_id or "").strip()
    if not task_key:
        return
    with _planning_lock:
        state = _planning_state.setdefault(
            task_key,
            {
                "active": True,
                "clarify_count": 0,
                "latest_draft": None,
            },
        )
        state["active"] = True
        state["root"] = str(root or "").strip()
        state["references"] = _clean_string_list(references)


def note_workflow_clarification(task_id: str) -> None:
    """Record that the user completed one clarify round in a workflow planning chat."""
    task_key = str(task_id or "").strip()
    if not task_key:
        return
    with _planning_lock:
        state = _planning_state.get(task_key)
        if not state or not state.get("active"):
            return
        state["clarify_count"] = int(state.get("clarify_count") or 0) + 1


def reset_workflow_planning(task_id: str) -> None:
    """Clear workflow planning state for tests or completed sessions."""
    task_key = str(task_id or "").strip()
    if not task_key:
        return
    with _planning_lock:
        _planning_state.pop(task_key, None)


def _planning_guard_error(task_id: str) -> str | None:
    task_key = str(task_id or "").strip()
    if not task_key:
        return None
    with _planning_lock:
        state = dict(_planning_state.get(task_key) or {})
    if not state.get("active"):
        return None
    clarify_count = int(state.get("clarify_count") or 0)
    if clarify_count >= MIN_WORKFLOW_CLARIFICATIONS:
        return None
    remaining = MIN_WORKFLOW_CLARIFICATIONS - clarify_count
    return (
        "Workflow draft is not ready yet. Continue workflow planning with the clarify tool first: "
        f"at least {MIN_WORKFLOW_CLARIFICATIONS} clarification answers are required before proposing "
        f"a draft ({remaining} remaining). Ask one focused workflow execution question with exactly "
        "three recommended choices ordered by priority."
    )


def workflow_draft_propose_tool(
    draft_markdown: str,
    workflow: Dict[str, Any],
    root: str = "",
    references: Any = None,
    clarification_summary: str = "",
    task_id: str = "",
) -> str:
    """Return a validated workflow draft payload for the UI."""
    guard_error = _planning_guard_error(task_id)
    if guard_error:
        return tool_error(guard_error)

    draft_markdown = str(draft_markdown or "").strip()
    if not draft_markdown:
        return tool_error("draftMarkdown is required.")

    validated = _validate_workflow_shape(workflow, draft_markdown)
    if isinstance(validated, list):
        return tool_error(
            validated[0],
            validationIssues=validated,
            overview=_workflow_error_overview(workflow, draft_markdown, validated),
            draftPreviewOmitted=True,
        )

    payload = {
        "draftMarkdown": draft_markdown,
        "workflow": validated,
        "root": str(root or "").strip(),
        "references": _clean_string_list(references),
        "clarificationSummary": str(clarification_summary or "").strip(),
    }
    task_key = str(task_id or "").strip()
    if task_key:
        with _planning_lock:
            state = _planning_state.setdefault(task_key, {"active": True, "clarify_count": 0})
            state["active"] = True
            state["latest_draft"] = payload
    return json.dumps(payload, ensure_ascii=False)


def check_workflow_draft_requirements() -> bool:
    """Workflow draft proposal has no external requirements."""
    return True


WORKFLOW_DRAFT_PROPOSE_SCHEMA = {
    "name": "workflow_draft_propose",
    "description": (
        "Propose a structured Hermes Workflow draft inside the current chat session. "
        "Use this only after workflow planning details are clear enough. The tool "
        "does not create files or projects; the user must preview and initialize "
        "the draft from the desktop UI. If details are missing, ask the user with "
        "the clarify tool first. In a workflow planning session, at least two "
        "clarify answers are required before this tool can succeed. Each clarify "
        "question should offer exactly three recommended choices ordered by "
        "priority; the UI supplies an Other option."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "draftMarkdown": {
                "type": "string",
                "description": "User-readable Markdown summary of the workflow draft.",
            },
            "clarificationSummary": {
                "type": "string",
                "description": (
                    "Brief summary of the clarification answers that justify this draft. "
                    "Include the workflow execution choices gathered from the user."
                ),
            },
            "workflow": {
                "type": "object",
                "description": (
                    "Strict Workflow JSON. Required top-level field: nodes. Hermes will derive workflow id/title if omitted. "
                    "Every node must include type, title, and description; id is recommended but can be derived from title. "
                    "Normal task nodes have one input and one success output. Review/test nodes have one "
                    "input plus success and failure outputs. Use sourceHandle='success' or 'failure' and "
                    "targetHandle='input' on edges. Invalid drafts return a validation summary only, so fix "
                    "tool errors by calling this tool again instead of pasting the full invalid draft in chat."
                ),
                "properties": {
                    "id": {"type": "string", "description": "Optional workflow id. Hermes can derive this."},
                    "title": {"type": "string", "description": "Optional workflow title. Hermes can derive this."},
                    "nodes": {
                        "type": "array",
                        "minItems": 1,
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string", "description": "Optional stable node id. Hermes can derive this from title."},
                                "type": {
                                    "type": "string",
                                    "description": "Node type: task, planning, reference, execution, review, test, or delivery.",
                                },
                                "title": {"type": "string"},
                                "description": {"type": "string"},
                                "skills": {"type": "array", "items": {"type": "string"}},
                                "reviewRules": {
                                    "type": "object",
                                    "properties": {
                                        "required": {"type": "boolean"},
                                        "checklist": {"type": "array", "items": {"type": "string"}},
                                    },
                                },
                            },
                            "required": ["type", "title", "description"],
                        },
                    },
                    "edges": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string", "description": "Optional edge id. Hermes can derive this."},
                                "source": {"type": "string"},
                                "target": {"type": "string"},
                                "type": {"type": "string", "description": "dependency or feedback"},
                                "sourceHandle": {"type": "string", "description": "success or failure"},
                                "targetHandle": {"type": "string", "description": "input"},
                                "label": {"type": "string"},
                            },
                            "required": ["source", "target"],
                        },
                    },
                },
                "required": ["nodes"],
            },
            "root": {
                "type": "string",
                "description": "Optional workflow project root selected by the user.",
            },
            "references": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional reference file, folder, image, or URL entries from the composer.",
            },
        },
        "required": ["draftMarkdown", "workflow"],
    },
}


from tools.registry import registry, tool_error

registry.register(
    name="workflow_draft_propose",
    toolset="workflow_draft",
    schema=WORKFLOW_DRAFT_PROPOSE_SCHEMA,
    handler=lambda args, **kw: workflow_draft_propose_tool(
        draft_markdown=args.get("draftMarkdown", ""),
        workflow=args.get("workflow") or {},
        root=args.get("root", ""),
        references=args.get("references"),
        clarification_summary=args.get("clarificationSummary", ""),
        task_id=kw.get("task_id", ""),
    ),
    check_fn=check_workflow_draft_requirements,
    emoji="🧭",
)
