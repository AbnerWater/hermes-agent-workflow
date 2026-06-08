import type { ProjectBundle, ReviewRules, StreamEvent, VersionSnapshot, Workflow, WorkflowNode } from '@/types/workflow'

const FOLLOWABLE_RUN_STATUSES = new Set(['running', 'waiting_user_confirm', 'paused'])
const RUNTIME_EVENT_TYPES = new Set<StreamEvent['type']>(['node_status', 'approval'])
const SNAPSHOT_RESTORE_BLOCKING_STATUSES = new Set(['running', 'waiting_user_confirm', 'paused'])
const SNAPSHOT_DETAIL_API_VERSION = 2

export function latestWorkflowRuntimeNodeId(
  activeRun: ProjectBundle['latestRun'],
  events: StreamEvent[]
): string | null {
  if (activeRun?.currentNodeId) {
    return activeRun.currentNodeId
  }

  if (!activeRun || !FOLLOWABLE_RUN_STATUSES.has(activeRun.status)) {
    return null
  }

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]

    if (!event.nodeId || !RUNTIME_EVENT_TYPES.has(event.type)) {
      continue
    }

    if (!event.runId || event.runId === activeRun.id) {
      return event.nodeId
    }
  }

  return null
}

export function runtimeNodeTitle(runtimeNode: WorkflowNode | null, fallback: string): string {
  return runtimeNode?.title ?? fallback
}

export function applyWorkflowRetryLimit(workflow: Workflow, maxRetries: number): Workflow {
  const retryLimit = Math.max(0, Math.floor(maxRetries))

  return {
    ...workflow,
    nodes: workflow.nodes.map(node => ({ ...node, maxRetries: retryLimit })),
    updatedAt: Date.now() / 1000
  }
}

export function reviewRulesToDraft(rules: ReviewRules): string {
  return rules.checklist.join('\n')
}

export function reviewRulesFromDraft(required: boolean, draft: string): ReviewRules {
  return {
    required,
    checklist: draft
      .split(/\r?\n/)
      .map(item => item.trim())
      .filter(Boolean)
  }
}

export function snapshotShortCommit(snapshot: Pick<VersionSnapshot, 'commit' | 'shortCommit'>): string {
  return snapshot.shortCommit || snapshot.commit?.slice(0, 8) || ''
}

export function snapshotHasChangeStats(
  snapshot: Pick<VersionSnapshot, 'deletions' | 'fileCount' | 'insertions'>
): boolean {
  return (
    typeof snapshot.fileCount === 'number' &&
    Number.isFinite(snapshot.fileCount) &&
    typeof snapshot.insertions === 'number' &&
    Number.isFinite(snapshot.insertions) &&
    typeof snapshot.deletions === 'number' &&
    Number.isFinite(snapshot.deletions)
  )
}

export function snapshotChangeSummary(
  snapshot: Pick<VersionSnapshot, 'deletions' | 'fileCount' | 'insertions'>,
  unavailableLabel = 'Stats unavailable'
): string {
  if (!snapshotHasChangeStats(snapshot)) {
    return unavailableLabel
  }

  const files = Math.max(0, snapshot.fileCount ?? 0)
  const insertions = Math.max(0, snapshot.insertions ?? 0)
  const deletions = Math.max(0, snapshot.deletions ?? 0)

  return `${files} files · +${insertions} -${deletions}`
}

export function isSnapshotDetailApiReady(snapshotApiVersion: null | number | undefined): boolean {
  return snapshotApiVersion === SNAPSHOT_DETAIL_API_VERSION
}

export function canRestoreWorkflowSnapshot(activeRun: ProjectBundle['latestRun']): boolean {
  return !activeRun || !SNAPSHOT_RESTORE_BLOCKING_STATUSES.has(activeRun.status)
}
