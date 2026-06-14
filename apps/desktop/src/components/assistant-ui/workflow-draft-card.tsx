'use client'

import { type ToolCallMessagePartProps } from '@assistant-ui/react'
import { useStore } from '@nanostores/react'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { WorkflowDraftPreviewDialog } from '@/app/workflows'
import { dispatchWorkflowProjectsChanged } from '@/app/workflows/project-events'
import { ToolFallback } from '@/components/assistant-ui/tool-fallback'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { initializeWorkflowFromDraft } from '@/hermes'
import { Loader2 } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { notifyError } from '@/store/notifications'
import { $activeSessionId, $currentCwd } from '@/store/session'
import {
  $planningDraft,
  $planningDraftMarkdown,
  $planningMode,
  $planningReferences,
  advancePhase,
  disablePlanningMode,
  setPlanningDraft
} from '@/store/workflow-planning'
import type { Workflow } from '@/types/workflow'

interface DraftPayload {
  draftMarkdown: string
  workflow: Workflow
  root?: string
  references?: string[]
  clarificationSummary?: string
}

interface DraftError {
  error: string
  validationIssues?: string[]
}

function parseDraftResult(result: unknown): DraftPayload | DraftError | null {
  if (!result) return null

  const raw = typeof result === 'string' ? tryParse(result) : result
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null

  const obj = raw as Record<string, unknown>
  if (typeof obj.error === 'string') {
    return {
      error: obj.error,
      validationIssues: Array.isArray(obj.validationIssues)
        ? obj.validationIssues.filter((v): v is string => typeof v === 'string')
        : undefined
    }
  }

  if (obj.workflow && typeof obj.draftMarkdown === 'string') {
    return {
      draftMarkdown: obj.draftMarkdown,
      workflow: obj.workflow as Workflow,
      root: typeof obj.root === 'string' ? obj.root : undefined,
      references: Array.isArray(obj.references) ? obj.references.filter((r): r is string => typeof r === 'string') : undefined,
      clarificationSummary: typeof obj.clarificationSummary === 'string' ? obj.clarificationSummary : undefined
    }
  }

  return null
}

function tryParse(str: string): unknown {
  try {
    return JSON.parse(str)
  } catch {
    return null
  }
}

function isError(r: DraftPayload | DraftError): r is DraftError {
  return 'error' in r
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '').slice(0, 72) || 'workflow-project'
}

export function WorkflowDraftCard(props: ToolCallMessagePartProps) {
  const isPending = props.result === undefined
  const parsed = useMemo(() => parseDraftResult(props.result), [props.result])

  if (isPending) {
    return <DraftPending />
  }

  if (!parsed) {
    return <ToolFallback {...props} />
  }

  if (isError(parsed)) {
    return <DraftValidationError error={parsed.error} issues={parsed.validationIssues} />
  }

  return <DraftPreview payload={parsed} />
}

function DraftPending() {
  return (
    <div className="mb-3 mt-2 flex items-center gap-2.5 rounded-[0.5rem] border border-border/55 bg-card/30 px-3 py-2.5 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      <span>Generating workflow draft...</span>
    </div>
  )
}

function DraftValidationError({ error, issues }: { error: string; issues?: string[] }) {
  return (
    <div className="mb-3 mt-2 rounded-[0.5rem] border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm">
      <div className="flex items-start gap-2">
        <Codicon className="mt-0.5 shrink-0 text-destructive" name="error" size="0.875rem" />
        <div className="min-w-0">
          <div className="font-medium text-destructive">{error}</div>
          {issues && issues.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-muted-foreground">
              {issues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function DraftPreview({ payload }: { payload: DraftPayload }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const sessionId = useStore($activeSessionId)
  const currentDraft = useStore($planningDraft)
  const planningMode = useStore($planningMode)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const isLatest = currentDraft === payload.workflow
  const isSuperseded = currentDraft !== null && !isLatest

  useEffect(() => {
    if (planningMode && !isSuperseded) {
      const hadPriorDraft = $planningDraft.get() !== null
      setPlanningDraft(payload.workflow, payload.draftMarkdown)
      advancePhase(hadPriorDraft ? 'refine' : 'plan')
    }
  }, [payload, planningMode, isSuperseded])

  const handleCreate = useCallback(async () => {
    setCreating(true)
    try {
      const cwd = $currentCwd.get()
      const titleSlug = slugify(payload.workflow?.title || 'workflow-project')
      const root = cwd ? `${cwd}/workflows/${titleSlug}` : undefined
      const refs = $planningReferences.get().length ? $planningReferences.get() : payload.references ?? []
      const bundle = await initializeWorkflowFromDraft({
        sourceSessionId: sessionId ?? undefined,
        root,
        references: refs.length ? refs : undefined,
        draftMarkdown: $planningDraftMarkdown.get() || payload.draftMarkdown,
        workflow: payload.workflow
      })
      dispatchWorkflowProjectsChanged({ action: 'created', project: bundle.project })
      void queryClient.invalidateQueries({ queryKey: ['workflow-projects'] })
      disablePlanningMode()
      navigate(`/workflows?root=${encodeURIComponent(bundle.project.root)}`)
    } catch (err) {
      notifyError(err, 'Failed to create workflow')
    } finally {
      setCreating(false)
    }
  }, [navigate, payload, queryClient, sessionId])

  const nodeCount = payload.workflow?.nodes?.length ?? 0
  const title = payload.workflow?.title || 'Workflow Draft'

  return (
    <div
      className={cn(
        'mb-3 mt-2 rounded-[0.5rem] border bg-card/40 text-sm transition-opacity',
        isSuperseded ? 'border-border/30 opacity-50' : 'border-border/55'
      )}
    >
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span
          aria-hidden
          className="grid size-6 shrink-0 place-items-center rounded-md bg-[color-mix(in_srgb,var(--dt-primary)_11%,transparent)] text-primary ring-1 ring-inset ring-primary/15"
        >
          <Codicon name="type-hierarchy-sub" size="0.875rem" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-medium leading-snug text-foreground">{title}</div>
          <div className="text-[0.6875rem] text-muted-foreground">
            {nodeCount} node{nodeCount !== 1 ? 's' : ''}
            {payload.clarificationSummary ? ` · ${payload.clarificationSummary.slice(0, 80)}` : ''}
          </div>
        </div>
      </div>

      {payload.draftMarkdown && (
        <div className="border-t border-border/30 px-3 py-2 text-[0.8125rem] leading-relaxed text-foreground/80">
          <div className={cn('whitespace-pre-wrap', isSuperseded && 'line-clamp-2')}>
            {payload.draftMarkdown}
          </div>
        </div>
      )}

      {!isSuperseded && (
        <div className="flex items-center justify-end gap-2 border-t border-border/30 px-3 py-2">
          <Button
            onClick={() => setPreviewOpen(true)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Codicon name="open-preview" size="0.875rem" />
            Preview
          </Button>
          <Button
            disabled={creating}
            onClick={() => void handleCreate()}
            size="sm"
            type="button"
          >
            {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Codicon name="add" size="0.875rem" />}
            Create Workflow
          </Button>
        </div>
      )}

      <WorkflowDraftPreviewDialog
        onOpenChange={setPreviewOpen}
        onSelectNode={setSelectedNodeId}
        open={previewOpen}
        selectedNodeId={selectedNodeId}
        workflow={payload.workflow}
      />
    </div>
  )
}
