import type {
  ProjectBundle,
  PromptCalibration,
  RepairContext,
  ReviewDecision,
  ReviewRules,
  StreamEvent,
  VersionSnapshot,
  Workflow,
  WorkflowNode
} from '@/types/workflow'

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

export function nextExpandedSnapshotCommit(
  currentCommit: string | null,
  snapshots: Array<Pick<VersionSnapshot, 'commit'>>
): string | null {
  if (!currentCommit) {
    return null
  }

  return snapshots.some(snapshot => snapshot.commit === currentCommit) ? currentCommit : null
}

export function toggleExpandedSnapshotCommit(currentCommit: string | null, commit: string | null | undefined): string | null {
  if (!commit) {
    return currentCommit
  }

  return currentCommit === commit ? null : commit
}

export function workflowComposerHasContent(text: string, attachmentCount: number): boolean {
  return text.trim().length > 0 || attachmentCount > 0
}

export function workflowComposerCanSubmit(
  text: string,
  attachmentCount: number,
  composing: boolean,
  disabled: boolean
): boolean {
  return !disabled && !composing && workflowComposerHasContent(text, attachmentCount)
}

export function parseReviewDecision(value: unknown): ReviewDecision | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const data = value as Record<string, unknown>
  const rawDecision = typeof data.decision === 'string' ? data.decision : ''

  if (rawDecision !== 'pass' && rawDecision !== 'return' && rawDecision !== 'needs_human') {
    return null
  }

  return {
    decision: rawDecision,
    targetNodeId: typeof data.targetNodeId === 'string' ? data.targetNodeId : null,
    reason: typeof data.reason === 'string' ? data.reason : ''
  }
}

export function parsePromptCalibration(value: unknown): PromptCalibration | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const data = value as Record<string, unknown>
  return {
    updatedPromptOverride: typeof data.updatedPromptOverride === 'string' ? data.updatedPromptOverride : undefined,
    repairObjectives: stringArray(data.repairObjectives),
    mustFixItems: stringArray(data.mustFixItems),
    evidenceToCheck: stringArray(data.evidenceToCheck),
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : undefined,
    error: typeof data.error === 'string' ? data.error : null
  }
}

export function latestRepairContext(outputs: Record<string, unknown> | undefined): RepairContext | null {
  if (!outputs) {
    return null
  }

  return (
    parseRepairContext(outputs.pendingRepairContext) ??
    parseRepairContext(outputs.inheritedRepairContext) ??
    latestRepairContextFromHistory(outputs.repairContextHistory)
  )
}

function latestRepairContextFromHistory(value: unknown): RepairContext | null {
  if (!Array.isArray(value)) {
    return null
  }

  for (const item of [...value].reverse()) {
    const parsed = parseRepairContext(item)
    if (parsed) {
      return parsed
    }
  }

  return null
}

function parseRepairContext(value: unknown): RepairContext | null {
  const source = Array.isArray(value) ? value[0] : value

  if (!source || typeof source !== 'object') {
    return null
  }

  const data = source as Record<string, unknown>
  const id = typeof data.id === 'string' ? data.id : ''
  const sourceNodeId = typeof data.sourceNodeId === 'string' ? data.sourceNodeId : ''
  const targetNodeId = typeof data.targetNodeId === 'string' ? data.targetNodeId : ''

  if (!sourceNodeId || !targetNodeId) {
    return null
  }

  return {
    id,
    sourceNodeId,
    sourceNodeTitle: typeof data.sourceNodeTitle === 'string' ? data.sourceNodeTitle : undefined,
    sourceNodeType: typeof data.sourceNodeType === 'string' ? data.sourceNodeType : undefined,
    targetNodeId,
    targetNodeTitle: typeof data.targetNodeTitle === 'string' ? data.targetNodeTitle : undefined,
    reason: typeof data.reason === 'string' ? data.reason : undefined,
    reviewDecision: parseReviewDecision(data.reviewDecision) ?? undefined,
    reviewSummary: typeof data.reviewSummary === 'string' ? data.reviewSummary : undefined,
    resetNodeIds: stringArray(data.resetNodeIds),
    calibration: parsePromptCalibration(data.calibration),
    inherited: data.inherited === true,
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : undefined,
    consumedAt: typeof data.consumedAt === 'number' ? data.consumedAt : null
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : []
}
