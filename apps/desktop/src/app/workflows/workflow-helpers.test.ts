import { describe, expect, it } from 'vitest'

import type { ExecutionRun, StreamEvent, Workflow, WorkflowNode } from '@/types/workflow'

import {
  applyWorkflowRetryLimit,
  canRestoreWorkflowSnapshot,
  isSnapshotDetailApiReady,
  latestWorkflowRuntimeNodeId,
  reviewRulesFromDraft,
  reviewRulesToDraft,
  runtimeNodeTitle,
  snapshotChangeSummary,
  snapshotHasChangeStats,
  snapshotShortCommit
} from './workflow-helpers'

function node(id: string, maxRetries = 1): WorkflowNode {
  return {
    id,
    type: 'execution',
    title: id,
    description: '',
    position: { x: 0, y: 0 },
    status: 'created',
    inputs: {},
    outputs: {},
    reviewRules: { required: false, checklist: [] },
    skills: [],
    model: null,
    promptOverride: null,
    skillMode: 'auto',
    references: [],
    modelOverride: null,
    fileChanges: [],
    artifacts: [],
    optional: false,
    maxRetries,
    retryCount: 0,
    agentSessionId: null,
    lastRunId: null,
    llmGenerated: false
  }
}

function workflow(nodes: WorkflowNode[]): Workflow {
  return {
    id: 'workflow',
    title: 'Workflow',
    nodes,
    edges: [],
    updatedAt: 1
  }
}

function run(overrides: Partial<ExecutionRun> = {}): ExecutionRun {
  return {
    id: 'run-1',
    projectId: 'project',
    mode: 'auto',
    status: 'running',
    currentNodeId: null,
    maxConcurrency: 2,
    startedAt: 1,
    updatedAt: 1,
    completedAt: null,
    ...overrides
  }
}

function event(overrides: Partial<StreamEvent>): StreamEvent {
  return {
    id: `event-${overrides.timestamp ?? 1}`,
    projectId: 'project',
    runId: 'run-1',
    nodeId: null,
    type: 'node_status',
    label: '',
    timestamp: 1,
    summary: '',
    details: {},
    status: 'info',
    durationMs: null,
    ...overrides
  }
}

describe('workflow helpers', () => {
  it('resolves the runtime node from run state or runtime events only', () => {
    expect(latestWorkflowRuntimeNodeId(run({ currentNodeId: 'current' }), [])).toBe('current')
    expect(
      latestWorkflowRuntimeNodeId(run(), [
        event({ id: 'old', nodeId: 'selected', timestamp: 1, type: 'ai_reply' }),
        event({ id: 'new', nodeId: 'runtime', timestamp: 2, type: 'node_status' })
      ])
    ).toBe('runtime')
    expect(runtimeNodeTitle(null, 'No current execution node')).toBe('No current execution node')
  })

  it('applies a workflow retry limit to every current node', () => {
    const updated = applyWorkflowRetryLimit(workflow([node('a', 1), node('b', 3)]), 4.8)

    expect(updated.nodes.map(item => item.maxRetries)).toEqual([4, 4])
    expect(updated.updatedAt).toBeGreaterThan(1)
  })

  it('round-trips review rules through editable text', () => {
    const draft = reviewRulesToDraft({ required: true, checklist: ['Check output', 'Run validation'] })

    expect(draft).toBe('Check output\nRun validation')
    expect(reviewRulesFromDraft(false, '  Check output  \n\nRun validation\n')).toEqual({
      required: false,
      checklist: ['Check output', 'Run validation']
    })
  })

  it('formats snapshot metadata and blocks restore during active runs', () => {
    expect(snapshotShortCommit({ commit: '1234567890abcdef', shortCommit: null })).toBe('12345678')
    expect(snapshotShortCommit({ commit: '1234567890abcdef', shortCommit: 'abcdef12' })).toBe('abcdef12')
    expect(snapshotChangeSummary({ deletions: 2, fileCount: 3, insertions: 10 })).toBe('3 files · +10 -2')
    expect(snapshotChangeSummary({ deletions: undefined, fileCount: undefined, insertions: undefined }, 'Unavailable')).toBe(
      'Unavailable'
    )
    expect(snapshotChangeSummary({ deletions: 0, fileCount: 0, insertions: 0 }, 'Unavailable')).toBe('0 files · +0 -0')
    expect(snapshotHasChangeStats({ deletions: undefined, fileCount: undefined, insertions: undefined })).toBe(false)
    expect(snapshotHasChangeStats({ deletions: 0, fileCount: 0, insertions: 0 })).toBe(true)
    expect(isSnapshotDetailApiReady(undefined)).toBe(false)
    expect(isSnapshotDetailApiReady(1)).toBe(false)
    expect(isSnapshotDetailApiReady(2)).toBe(true)
    expect(canRestoreWorkflowSnapshot(null)).toBe(true)
    expect(canRestoreWorkflowSnapshot(run({ status: 'completed' }))).toBe(true)
    expect(canRestoreWorkflowSnapshot(run({ status: 'waiting_user_confirm' }))).toBe(false)
    expect(canRestoreWorkflowSnapshot(run({ status: 'paused' }))).toBe(false)
  })
})
