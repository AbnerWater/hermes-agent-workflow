import { type ToolCallMessagePartProps } from '@assistant-ui/react'
import { useStore } from '@nanostores/react'
import { useQueryClient } from '@tanstack/react-query'
import { type FC, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { WORKFLOWS_ROUTE } from '@/app/routes'
import { WorkflowDraftPreviewDialog } from '@/app/workflows'
import { applyWorkflowProjectChange, dispatchWorkflowProjectsChanged } from '@/app/workflows/project-events'
import { workflowCopyFor } from '@/app/workflows/i18n'
import { CompactMarkdown } from '@/components/chat/compact-markdown'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { initializeWorkflowFromDraft } from '@/hermes'
import { cn } from '@/lib/utils'
import { $activeSessionId, $selectedStoredSessionId } from '@/store/session'
import { notifyError } from '@/store/notifications'
import { $workflowLanguage } from '@/store/workflow-language'
import type { ProjectListResponse, Workflow } from '@/types/workflow'

interface WorkflowDraftPayload {
  clarificationSummary?: string
  draftPreviewOmitted?: boolean
  draftMarkdown: string
  error?: string
  overview?: string
  references: string[]
  root?: string
  validationIssues: string[]
  workflow: Workflow | null
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  const parsed = parseJson(value)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.map(item => String(item ?? '').trim()).filter(Boolean)
}

function titleCandidate(value: unknown): string {
  let text = String(value ?? '').trim()
  if (!text) {
    return ''
  }

  text = text.replace(/^#+\s*/, '').trim()
  while (/^[-*>:]\s*/.test(text)) {
    text = text.replace(/^[-*>:]\s*/, '').trim()
  }

  return text.slice(0, 96).trim()
}

function deriveWorkflowTitle(workflow: Record<string, unknown>, draftMarkdown: string): string {
  const explicitTitle = titleCandidate(workflow.title)
  if (explicitTitle) {
    return explicitTitle
  }

  for (const line of draftMarkdown.split(/\r?\n/)) {
    const markdownTitle = titleCandidate(line)
    if (markdownTitle) {
      return markdownTitle
    }
  }

  if (Array.isArray(workflow.nodes)) {
    for (const node of workflow.nodes) {
      const nodeRecord = asRecord(node)
      const nodeTitle = titleCandidate(nodeRecord?.title)
      if (nodeTitle) {
        return nodeTitle
      }
    }
  }

  return 'Hermes Workflow Project'
}

function workflowFrom(value: unknown, draftMarkdown: string): Workflow | null {
  const workflow = asRecord(value)
  if (!workflow) {
    return null
  }

  if (typeof workflow.id !== 'string') {
    return null
  }

  if (!Array.isArray(workflow.nodes) || !Array.isArray(workflow.edges)) {
    return null
  }

  return {
    ...workflow,
    title: deriveWorkflowTitle(workflow, draftMarkdown)
  } as unknown as Workflow
}

function payloadFrom(args: unknown, result: unknown): WorkflowDraftPayload {
  const resultRecord = asRecord(result)
  const argsRecord = asRecord(args)
  const source = resultRecord || argsRecord || {}
  const resultRejectedDraft = Boolean(
    resultRecord && (resultRecord.error || resultRecord.draftPreviewOmitted || resultRecord.success === false)
  )
  const draftMarkdown = String(source.draftMarkdown ?? (resultRejectedDraft || !resultRecord ? '' : argsRecord?.draftMarkdown) ?? '')

  return {
    clarificationSummary: String(source.clarificationSummary ?? argsRecord?.clarificationSummary ?? '').trim() || undefined,
    draftPreviewOmitted: Boolean(source.draftPreviewOmitted),
    draftMarkdown,
    error: typeof source.error === 'string' ? source.error : undefined,
    overview: typeof source.overview === 'string' ? source.overview : undefined,
    references: stringArray(source.references ?? (resultRejectedDraft ? undefined : argsRecord?.references)),
    root: String(source.root ?? argsRecord?.root ?? '').trim() || undefined,
    validationIssues: stringArray(source.validationIssues),
    workflow: resultRejectedDraft || !resultRecord ? null : workflowFrom(source.workflow ?? argsRecord?.workflow, draftMarkdown)
  }
}

export const WorkflowDraftTool: FC<ToolCallMessagePartProps> = ({ args, isError, result }) => {
  const copy = workflowCopyFor(useStore($workflowLanguage))
  const activeSessionId = useStore($activeSessionId)
  const selectedSessionId = useStore($selectedStoredSessionId)
  const sourceSessionId = selectedSessionId || activeSessionId || ''
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [previewOpen, setPreviewOpen] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [initializing, setInitializing] = useState(false)
  const pending = result === undefined && !isError
  const payload = useMemo(() => payloadFrom(args, result), [args, result])
  const workflow = payload.workflow
  const draftMarkdown = payload.draftMarkdown || workflow?.title || ''

  const initialize = async () => {
    if (!workflow || initializing) {
      return
    }

    setInitializing(true)
    try {
      const bundle = await initializeWorkflowFromDraft({
        draftMarkdown,
        references: payload.references,
        root: payload.root,
        sourceSessionId,
        workflow
      })

      queryClient.setQueryData<ProjectListResponse>(['workflow-projects'], current => ({
        projects: applyWorkflowProjectChange(current?.projects ?? [], { action: 'created', project: bundle.project })
      }))
      dispatchWorkflowProjectsChanged({ action: 'created', project: bundle.project })
      await queryClient.invalidateQueries({ queryKey: ['workflow-projects'] })
      navigate(`${WORKFLOWS_ROUTE}?project=${encodeURIComponent(bundle.project.id)}`)
    } catch (error) {
      notifyError(error, 'Workflow initialization failed')
    } finally {
      setInitializing(false)
    }
  }

  if (pending) {
    return (
      <div
        className="mt-2 flex items-center gap-2 rounded-[var(--dt-radius-md)] border border-(--ui-stroke-secondary) bg-(--ui-bg-card)/55 px-3 py-2 text-[0.78rem] text-(--ui-text-secondary) shadow-sm backdrop-blur-sm"
        data-slot="workflow-draft-pending"
        role="status"
      >
        <Codicon className="text-(--ui-text-tertiary)" name="loading" size="0.875rem" spinning />
        <span>{copy.planningWithHermes}</span>
      </div>
    )
  }

  if (isError || payload.error || payload.draftPreviewOmitted || !workflow) {
    return (
      <div
        className="mt-2 rounded-[var(--dt-radius-md)] border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        data-slot="workflow-draft-error"
      >
        <p className="m-0 font-medium">{payload.error || 'Workflow draft failed validation.'}</p>
        {payload.overview && <p className="mt-2 mb-0 text-[0.78rem] leading-5 text-destructive/85">{payload.overview}</p>}
        {payload.validationIssues.length > 0 && (
          <ul className="mt-2 mb-0 grid gap-1 pl-4 text-[0.75rem] leading-5 text-destructive/85">
            {payload.validationIssues.slice(0, 5).map(issue => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <div
      className="mt-3 w-full max-w-full overflow-hidden rounded-[var(--dt-radius-lg)] border border-(--ui-stroke-secondary) bg-(--ui-bg-card)/80 p-3 shadow-sm backdrop-blur-sm"
      data-slot="workflow-draft-card"
    >
      <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[0.78rem] font-semibold text-(--ui-text-primary)">
            <Codicon name={pending ? 'loading' : 'graph'} size="0.875rem" spinning={pending} />
            <span>{copy.workflowDraftPreviewTitle}</span>
          </div>
          {workflow?.title && <p className="m-0 truncate text-[0.7rem] text-(--ui-text-tertiary)">{workflow.title}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button disabled={!workflow || pending} onClick={() => setPreviewOpen(true)} size="xs" type="button" variant="outline">
            <Codicon name="preview" size="0.75rem" />
            {copy.previewWorkflowDraft}
          </Button>
          <Button disabled={!workflow || pending || initializing} onClick={initialize} size="xs" type="button">
            <Codicon name={initializing ? 'loading' : 'check'} size="0.75rem" spinning={initializing} />
            {copy.initializeWorkflow}
          </Button>
        </div>
      </div>
      <div
        className={cn(
          'max-h-[28rem] overflow-auto rounded-[var(--dt-radius-md)] border border-(--ui-stroke-tertiary) bg-(--ui-chat-surface-background)/50 p-3',
          pending && 'text-(--ui-text-tertiary)'
        )}
      >
        {payload.clarificationSummary && !pending && (
          <div className="mb-3 rounded-[var(--dt-radius-sm)] border border-(--ui-stroke-tertiary) bg-(--ui-bg-elevated)/45 px-2.5 py-2 text-[0.75rem] text-(--ui-text-secondary)">
            {payload.clarificationSummary}
          </div>
        )}
        <CompactMarkdown text={pending ? copy.planningWithHermes : draftMarkdown || 'Workflow draft is ready.'} />
      </div>
      <WorkflowDraftPreviewDialog
        onOpenChange={setPreviewOpen}
        onSelectNode={setSelectedNodeId}
        open={previewOpen}
        selectedNodeId={selectedNodeId}
        workflow={workflow}
      />
    </div>
  )
}
