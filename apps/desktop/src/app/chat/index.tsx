import {
  type AppendMessage,
  AssistantRuntimeProvider,
  ExportedMessageRepository,
  type ThreadMessage
} from '@assistant-ui/react'
import { useStore } from '@nanostores/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type * as React from 'react'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { WorkflowClarificationPanel, WorkflowDraftPreviewDialog } from '@/app/workflows'
import { applyWorkflowProjectChange, dispatchWorkflowProjectsChanged } from '@/app/workflows/project-events'
import { type WorkflowCopy, workflowCopyFor } from '@/app/workflows/i18n'
import { Thread } from '@/components/assistant-ui/thread'
import { Backdrop } from '@/components/Backdrop'
import { CompactMarkdown } from '@/components/chat/compact-markdown'
import { WordmarkIntro } from '@/components/chat/intro'
import { PromptOverlays } from '@/components/prompt-overlays'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Switch } from '@/components/ui/switch'
import {
  confirmWorkflowIntake,
  getGlobalModelOptions,
  sendWorkflowIntakeMessage,
  startWorkflowIntake,
  submitWorkflowIntakeAnswers,
  type HermesGateway
} from '@/hermes'
import type { ChatMessage } from '@/lib/chat-messages'
import { quickModelOptions, sessionTitle, toRuntimeMessage } from '@/lib/chat-runtime'
import { useIncrementalExternalStoreRuntime } from '@/lib/incremental-external-store-runtime'
import { cn } from '@/lib/utils'
import type { ComposerAttachment } from '@/store/composer'
import { $pinnedSessionIds } from '@/store/layout'
import { $gatewaySwapTarget } from '@/store/profile'
import {
  $activeSessionId,
  $awaitingResponse,
  $busy,
  $contextSuggestions,
  $currentCwd,
  $currentModel,
  $currentProvider,
  $freshDraftReady,
  $gatewayState,
  $introPersonality,
  $introSeed,
  $messages,
  $selectedStoredSessionId,
  $sessions,
  sessionPinId
} from '@/store/session'
import { $workflowLanguage } from '@/store/workflow-language'
import type { ModelOptionsResponse } from '@/types/hermes'
import type {
  ProjectBundle,
  ProjectListResponse,
  Workflow,
  WorkflowIntakeAnswer,
  WorkflowIntakeBatch,
  WorkflowIntakeMessage,
  WorkflowIntakePayload,
  WorkflowIntakeResponse
} from '@/types/workflow'

import { NEW_CHAT_ROUTE, routeSessionId, WORKFLOWS_ROUTE } from '../routes'
import { titlebarHeaderBaseClass, titlebarHeaderShadowClass } from '../shell/titlebar'

import { ChatDropOverlay } from './chat-drop-overlay'
import { ChatSwapOverlay } from './chat-swap-overlay'
import { ChatBar, ChatBarFallback } from './composer'
import { requestComposerInsert, requestComposerInsertRefs } from './composer/focus'
import { droppedFileInlineRef, type SessionDragPayload, sessionInlineRef } from './composer/inline-refs'
import type { ChatBarState } from './composer/types'
import type { DroppedFile } from './hooks/use-composer-actions'
import { useFileDropZone } from './hooks/use-file-drop-zone'
import { SessionActionsMenu } from './sidebar/session-actions-menu'
import { lastVisibleMessageIsUser, threadLoadingState } from './thread-loading'

interface ChatViewProps extends Omit<React.ComponentProps<'div'>, 'onSubmit'> {
  gateway: HermesGateway | null
  onToggleSelectedPin: () => void
  onDeleteSelectedSession: () => void
  onCancel: () => Promise<void> | void
  onAddContextRef: (refText: string, label?: string, detail?: string) => void
  onAddUrl: (url: string) => void
  onBranchInNewChat: (messageId: string) => void
  maxVoiceRecordingSeconds?: number
  onAttachImageBlob: (blob: Blob) => Promise<boolean | void> | boolean | void
  onAttachDroppedItems: (candidates: DroppedFile[]) => Promise<boolean | void> | boolean | void
  onPasteClipboardImage: () => void
  onPickFiles: () => void
  onPickFolders: () => void
  onPickImages: () => void
  onRemoveAttachment: (id: string) => void
  onSubmit: (
    text: string,
    options?: { attachments?: ComposerAttachment[]; fromQueue?: boolean }
  ) => Promise<boolean> | boolean
  onThreadMessagesChange: (messages: readonly ThreadMessage[]) => void
  onEdit: (message: AppendMessage) => Promise<void>
  onReload: (parentId: string | null) => Promise<void>
  onTranscribeAudio?: (audio: Blob) => Promise<string>
}

interface ChatHeaderProps {
  activeSessionId: null | string
  isRoutedSessionView: boolean
  onDeleteSelectedSession: () => void
  onToggleSelectedPin: () => void
  selectedSessionId: null | string
}

type ChatMode = 'session' | 'workflow'

const WORKFLOW_MODE_PARAM = 'workflow'

function workflowReferencesFromAttachments(attachments: readonly ComposerAttachment[]): string[] {
  const refs: string[] = []
  const seen = new Set<string>()

  for (const attachment of attachments) {
    if (attachment.kind === 'terminal') {
      continue
    }

    const value =
      attachment.path ||
      (attachment.kind === 'url'
        ? attachment.refText?.replace(/^@url:/, '').replace(/^`|`$/g, '') || attachment.detail || attachment.label
        : attachment.detail || attachment.refText?.replace(/^@(file|folder|image):/, '').replace(/^`|`$/g, ''))

    const trimmed = (value || '').trim()
    if (!trimmed || seen.has(trimmed)) {
      continue
    }

    seen.add(trimmed)
    refs.push(trimmed)
  }

  return refs
}

function mergeWorkflowReferences(current: string[], incoming: readonly string[]): string[] {
  const next = [...current]
  const seen = new Set(next)

  for (const ref of incoming) {
    const value = ref.trim()
    if (!value || seen.has(value)) {
      continue
    }

    seen.add(value)
    next.push(value)
  }

  return next
}

function workflowErrorText(error: unknown): string | undefined {
  if (!error) {
    return undefined
  }

  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  return undefined
}

function ChatHeader({
  activeSessionId,
  isRoutedSessionView,
  onDeleteSelectedSession,
  onToggleSelectedPin,
  selectedSessionId
}: ChatHeaderProps) {
  const sessions = useStore($sessions)
  const pinnedSessionIds = useStore($pinnedSessionIds)

  const activeStoredSession =
    sessions.find(session => session.id === selectedSessionId || session._lineage_root_id === selectedSessionId) || null

  const title = activeStoredSession ? sessionTitle(activeStoredSession) : 'New session'

  // Pins live on the durable lineage-root id, but selectedSessionId is the live
  // (tip) id — resolve through the loaded row so the menu reflects the pin
  // state after auto-compression rotates the id.
  const selectedIsPinned = activeStoredSession
    ? pinnedSessionIds.includes(sessionPinId(activeStoredSession))
    : selectedSessionId
      ? pinnedSessionIds.includes(selectedSessionId)
      : false

  // A brand-new session has no session to pin/delete/rename, so the header is
  // just a dead "New session" label + chevron. Drop it (and its border)
  // entirely until there's a real session to act on.
  if (!selectedSessionId && !activeSessionId && !isRoutedSessionView) {
    return null
  }

  return (
    <header className={cn(titlebarHeaderBaseClass, isRoutedSessionView && titlebarHeaderShadowClass)}>
      <div className="min-w-0 flex-1">
        <SessionActionsMenu
          align="start"
          onDelete={selectedSessionId ? onDeleteSelectedSession : undefined}
          onPin={selectedSessionId ? onToggleSelectedPin : undefined}
          pinned={selectedIsPinned}
          sessionId={selectedSessionId || activeSessionId || ''}
          sideOffset={8}
          title={title}
        >
          <Button
            className="pointer-events-auto h-6 min-w-0 gap-1 border border-transparent bg-transparent px-2 py-0 text-(--ui-text-secondary) hover:border-(--ui-stroke-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground data-[state=open]:border-(--ui-stroke-tertiary) data-[state=open]:bg-(--ui-control-active-background) [-webkit-app-region:no-drag]"
            type="button"
            variant="ghost"
          >
            <h2 className="max-w-[52vw] truncate text-[0.75rem] font-medium leading-none">{title}</h2>
            <Codicon className="shrink-0 text-(--ui-text-tertiary)" name="chevron-down" size="0.8125rem" />
          </Button>
        </SessionActionsMenu>
      </div>
    </header>
  )
}

function WorkflowChatFooter({
  copy,
  disabled,
  onChooseRoot,
  onEnabledChange,
  onInitialize,
  onResetRoot,
  root,
  workflowEnabled,
  showInitialize
}: {
  copy: WorkflowCopy
  disabled: boolean
  onChooseRoot: () => void
  onEnabledChange: (enabled: boolean) => void
  onInitialize: () => void
  onResetRoot: () => void
  root: string
  workflowEnabled: boolean
  showInitialize: boolean
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <label className="flex shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-full bg-background/35 px-2 py-1 text-foreground/85">
          <Switch
            checked={workflowEnabled}
            disabled={disabled}
            onCheckedChange={onEnabledChange}
            size="xs"
          />
          <span className="font-medium">{copy.workflowMode}</span>
        </label>
        {workflowEnabled && (
          <div className="flex min-w-0 items-center gap-1.5 rounded-full bg-background/35 px-2 py-1">
            <Codicon className="shrink-0 text-muted-foreground" name="folder" size="0.8125rem" />
            <span className="shrink-0 font-medium text-foreground/85">{copy.projectDirectory}</span>
            <button
              className="min-w-0 truncate text-left text-muted-foreground hover:text-foreground"
              disabled={disabled}
              onClick={onChooseRoot}
              title={root || copy.projectDirectoryPlaceholder}
              type="button"
            >
              {root || copy.projectDirectoryPlaceholder}
            </button>
            {root && (
              <button
                aria-label={copy.clearSelectedFile}
                className="grid size-4 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                disabled={disabled}
                onClick={onResetRoot}
                type="button"
              >
                <Codicon name="close" size="0.625rem" />
              </button>
            )}
          </div>
        )}
      </div>
      {workflowEnabled && showInitialize && (
        <Button className="h-7 rounded-full px-3 text-[0.72rem]" disabled={disabled} onClick={onInitialize} type="button">
          <Codicon name={disabled ? 'loading' : 'check'} size="0.8125rem" spinning={disabled} />
          {copy.initializeWorkflow}
        </Button>
      )}
    </div>
  )
}

function WorkflowPlanningThread({
  batch,
  busy,
  copy,
  draftMessageIndex,
  draftWorkflow,
  error,
  messages,
  onPreview,
  onSubmitAnswers
}: {
  batch: WorkflowIntakeBatch | null
  busy: boolean
  copy: WorkflowCopy
  draftMessageIndex: number
  draftWorkflow: Workflow | null
  error?: null | string
  messages: WorkflowIntakeMessage[]
  onPreview: () => void
  onSubmitAnswers: (answers: WorkflowIntakeAnswer[]) => void
}) {
  const empty = messages.length === 0 && !busy

  if (empty) {
    return (
      <div className="flex h-full min-h-0 w-full items-center justify-center px-4 pb-[var(--composer-measured-height)]">
        <WordmarkIntro body={copy.workflowIntakeSubtitle} wordmark="HERMES WORKFLOW" />
      </div>
    )
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto px-4 pb-[calc(var(--composer-measured-height)+2rem)] pt-8">
      <div className="workflow-intake-transcript mx-auto w-[min(var(--composer-width),calc(100%-2rem))] max-w-full">
        {messages.map((message, index) => (
          <div className={cn('workflow-intake-message', message.role === 'user' && 'is-user')} key={`${message.timestamp}-${index}`}>
            <span>{message.role === 'user' ? copy.you : 'Hermes'}</span>
            <CompactMarkdown className="workflow-intake-message-markdown" text={message.content || '...'} />
            {index === draftMessageIndex && draftWorkflow && (
              <Button className="workflow-intake-message__preview" onClick={onPreview} size="xs" type="button" variant="outline">
                <Codicon name="preview" size="0.75rem" />
                {copy.previewWorkflowDraft}
              </Button>
            )}
          </div>
        ))}
        {batch?.questions.length ? (
          <WorkflowClarificationPanel batch={batch} busy={busy} onSubmit={onSubmitAnswers} />
        ) : null}
        {busy && (
          <div className="workflow-intake-message">
            <span>Hermes</span>
            <div className="workflow-intake-message-markdown">
              <Codicon name="loading" size="0.8125rem" spinning />
              {copy.planningWithHermes}
            </div>
          </div>
        )}
        {error && <div className="workflow-error workflow-intake-error">{error}</div>}
      </div>
    </div>
  )
}

export function ChatView({
  className,
  gateway,
  onToggleSelectedPin,
  onDeleteSelectedSession,
  onCancel,
  onAddContextRef,
  onAddUrl,
  onAttachImageBlob,
  onAttachDroppedItems,
  onBranchInNewChat,
  maxVoiceRecordingSeconds,
  onPasteClipboardImage,
  onPickFiles,
  onPickFolders,
  onPickImages,
  onRemoveAttachment,
  onSubmit,
  onThreadMessagesChange,
  onEdit,
  onReload,
  onTranscribeAudio
}: ChatViewProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const activeSessionId = useStore($activeSessionId)
  const awaitingResponse = useStore($awaitingResponse)
  const busy = useStore($busy)
  const contextSuggestions = useStore($contextSuggestions)
  const currentCwd = useStore($currentCwd)
  const currentModel = useStore($currentModel)
  const currentProvider = useStore($currentProvider)
  const freshDraftReady = useStore($freshDraftReady)
  const gatewayState = useStore($gatewayState)
  const gatewaySwapTarget = useStore($gatewaySwapTarget)
  const gatewayOpen = gatewayState === 'open'
  const introPersonality = useStore($introPersonality)
  const introSeed = useStore($introSeed)
  const messages = useStore($messages)
  const selectedSessionId = useStore($selectedStoredSessionId)
  const workflowCopy = workflowCopyFor(useStore($workflowLanguage))
  const runtimeMessageCacheRef = useRef(new WeakMap<ChatMessage, ThreadMessage>())
  const isRoutedSessionView = Boolean(routeSessionId(location.pathname))
  const modeParam = new URLSearchParams(location.search).get('mode')
  const workflowModeRequested = modeParam === WORKFLOW_MODE_PARAM
  const workflowModeAllowed = !isRoutedSessionView && !selectedSessionId && !activeSessionId
  const [chatMode, setChatMode] = useState<ChatMode>(workflowModeRequested ? 'workflow' : 'session')
  const workflowModeActive = workflowModeAllowed && chatMode === 'workflow'
  const [workflowIntakeId, setWorkflowIntakeId] = useState<string | null>(null)
  const [workflowGoal, setWorkflowGoal] = useState('')
  const [workflowRoot, setWorkflowRoot] = useState('')
  const [workflowReferences, setWorkflowReferences] = useState<string[]>([])
  const [workflowMessages, setWorkflowMessages] = useState<WorkflowIntakeMessage[]>([])
  const [workflowPhase, setWorkflowPhase] = useState<WorkflowIntakeResponse['phase']>('idle')
  const [workflowPlanningStarted, setWorkflowPlanningStarted] = useState(false)
  const [workflowDraftMarkdown, setWorkflowDraftMarkdown] = useState('')
  const [workflowDraft, setWorkflowDraft] = useState<Workflow | null>(null)
  const [workflowBatch, setWorkflowBatch] = useState<WorkflowIntakeBatch | null>(null)
  const [workflowError, setWorkflowError] = useState<string | null>(null)
  const [workflowPreviewOpen, setWorkflowPreviewOpen] = useState(false)
  const [workflowPreviewNodeId, setWorkflowPreviewNodeId] = useState<string | null>(null)

  const showIntro =
    freshDraftReady && !isRoutedSessionView && !selectedSessionId && !activeSessionId && messages.length === 0

  // Session is still loading if the route references a session we haven't
  // resumed yet. Once `activeSessionId` is set (runtime has resumed), the
  // session exists — even if it has zero messages (a brand-new routed
  // session). The flicker where `busy` flips true briefly during hydrate
  // is handled by `threadLoadingState`'s last-visible-user gate.
  const loadingSession = isRoutedSessionView && messages.length === 0 && !activeSessionId
  const threadLoading = threadLoadingState(loadingSession, busy, awaitingResponse, lastVisibleMessageIsUser(messages))
  const showChatBar = !loadingSession
  const threadKey = selectedSessionId || activeSessionId || (isRoutedSessionView ? location.pathname : 'new')

  const modelOptionsQuery = useQuery<ModelOptionsResponse>({
    queryKey: ['model-options', activeSessionId || 'global'],
    queryFn: () => {
      if (!activeSessionId) {
        return getGlobalModelOptions()
      }

      if (!gateway) {
        throw new Error('Hermes gateway unavailable')
      }

      return gateway.request<ModelOptionsResponse>('model.options', { session_id: activeSessionId })
    },
    enabled: gatewayOpen
  })

  const quickModels = useMemo(
    () => quickModelOptions(modelOptionsQuery.data, currentProvider, currentModel),
    [currentModel, currentProvider, modelOptionsQuery.data]
  )

  const chatBarState = useMemo<ChatBarState>(
    () => ({
      model: {
        model: currentModel,
        provider: currentProvider,
        canSwitch: gatewayOpen,
        loading: !gatewayOpen || (!currentModel && !currentProvider),
        quickModels
      },
      tools: {
        enabled: true,
        label: 'Add context',
        suggestions: contextSuggestions
      },
      voice: {
        enabled: true,
        active: false
      }
    }),
    [contextSuggestions, currentModel, currentProvider, gatewayOpen, quickModels]
  )

  const resetWorkflowPlanningState = useCallback(() => {
    setWorkflowIntakeId(null)
    setWorkflowGoal('')
    setWorkflowReferences([])
    setWorkflowMessages([])
    setWorkflowPhase('idle')
    setWorkflowPlanningStarted(false)
    setWorkflowDraftMarkdown('')
    setWorkflowDraft(null)
    setWorkflowBatch(null)
    setWorkflowError(null)
    setWorkflowPreviewOpen(false)
    setWorkflowPreviewNodeId(null)
  }, [])

  useEffect(() => {
    const nextMode = workflowModeRequested && workflowModeAllowed ? 'workflow' : 'session'
    setChatMode(current => (current === nextMode ? current : nextMode))

    if (nextMode === 'session') {
      resetWorkflowPlanningState()
    }
  }, [resetWorkflowPlanningState, workflowModeAllowed, workflowModeRequested])

  const setMode = useCallback(
    (mode: ChatMode) => {
      if (mode === 'session') {
        resetWorkflowPlanningState()
      }

      setChatMode(mode)
      navigate(mode === 'workflow' ? `${NEW_CHAT_ROUTE}?mode=${WORKFLOW_MODE_PARAM}` : NEW_CHAT_ROUTE, {
        replace: location.pathname === NEW_CHAT_ROUTE
      })
    },
    [location.pathname, navigate, resetWorkflowPlanningState]
  )

  const applyWorkflowIntakeResponse = useCallback((response: WorkflowIntakeResponse) => {
    setWorkflowPlanningStarted(true)
    setWorkflowIntakeId(response.intakeId)
    setWorkflowMessages(response.messages)
    setWorkflowError(response.error ?? null)
    setWorkflowPhase(response.phase ?? (response.canConfirm || response.ready ? 'draft_ready' : 'clarifying'))
    setWorkflowDraftMarkdown(response.draftMarkdown ?? response.summary ?? '')
    setWorkflowDraft(response.draftWorkflow ?? null)
    setWorkflowBatch(response.currentBatch ?? null)

    if (response.draftWorkflow?.nodes.length) {
      setWorkflowPreviewNodeId(response.draftWorkflow.nodes[0].id)
    }
  }, [])

  const workflowDraftReady = Boolean(workflowDraft && (workflowPhase === 'draft_ready' || workflowDraftMarkdown))
  const workflowTranscriptActive =
    workflowModeActive && (workflowPlanningStarted || workflowMessages.length > 0 || workflowPhase !== 'idle')
  const workflowActiveBatch = Boolean(workflowBatch?.questions.length && !workflowDraftReady)
  const workflowPlaceholderOverride = workflowModeActive
    ? workflowDraftReady
      ? workflowCopy.revisionDetailsPlaceholder
      : workflowTranscriptActive
        ? workflowCopy.taskPlaceholder
        : undefined
    : undefined
  const workflowDraftMessageIndex = useMemo(() => {
    if (!workflowDraftReady) {
      return -1
    }

    for (let index = workflowMessages.length - 1; index >= 0; index -= 1) {
      if (workflowMessages[index]?.role === 'assistant') {
        return index
      }
    }

    return -1
  }, [workflowDraftReady, workflowMessages])

  const startWorkflowPlanningMutation = useMutation({
    mutationFn: (payload: WorkflowIntakePayload) => startWorkflowIntake(payload),
    onSuccess: applyWorkflowIntakeResponse
  })

  const sendWorkflowPlanningMutation = useMutation({
    mutationFn: ({ message, references }: { message: string; references: string[] }) =>
      sendWorkflowIntakeMessage(workflowIntakeId!, message, references),
    onSuccess: applyWorkflowIntakeResponse
  })

  const submitWorkflowAnswersMutation = useMutation({
    mutationFn: (answers: WorkflowIntakeAnswer[]) => submitWorkflowIntakeAnswers(workflowIntakeId!, answers),
    onSuccess: applyWorkflowIntakeResponse
  })

  const confirmWorkflowPlanningMutation = useMutation({
    mutationFn: () =>
      confirmWorkflowIntake(workflowIntakeId!, {
        goal: workflowGoal,
        references: workflowReferences,
        root: workflowRoot || undefined
      }),
    onSuccess: async (bundle: ProjectBundle) => {
      queryClient.setQueryData<ProjectListResponse>(['workflow-projects'], current => ({
        projects: applyWorkflowProjectChange(current?.projects ?? [], { action: 'created', project: bundle.project })
      }))
      dispatchWorkflowProjectsChanged({ action: 'created', project: bundle.project })
      await queryClient.invalidateQueries({ queryKey: ['workflow-projects'] })
      navigate(`${WORKFLOWS_ROUTE}?project=${encodeURIComponent(bundle.project.id)}`)
    }
  })

  const workflowBusy =
    startWorkflowPlanningMutation.isPending ||
    sendWorkflowPlanningMutation.isPending ||
    submitWorkflowAnswersMutation.isPending ||
    confirmWorkflowPlanningMutation.isPending

  const workflowMutationError =
    workflowErrorText(
      startWorkflowPlanningMutation.error ||
        sendWorkflowPlanningMutation.error ||
        submitWorkflowAnswersMutation.error ||
        confirmWorkflowPlanningMutation.error
    ) || workflowError

  const submitWorkflowPlanning = useCallback(
    async (text: string, options?: { attachments?: ComposerAttachment[] }) => {
      const message = text.trim()

      if (!message || workflowBusy || workflowActiveBatch) {
        return false
      }

      const incomingReferences = workflowReferencesFromAttachments(options?.attachments ?? [])
      const nextReferences = mergeWorkflowReferences(workflowReferences, incomingReferences)
      setWorkflowReferences(nextReferences)
      setWorkflowError(null)
      setWorkflowPlanningStarted(true)

      try {
        if (!workflowIntakeId) {
          setWorkflowGoal(message)
          const response = await startWorkflowPlanningMutation.mutateAsync({
            goal: message,
            references: nextReferences,
            root: workflowRoot || undefined
          })
          applyWorkflowIntakeResponse(response)
        } else {
          const response = await sendWorkflowPlanningMutation.mutateAsync({
            message,
            references: incomingReferences
          })
          applyWorkflowIntakeResponse(response)
        }

        return true
      } catch (error) {
        setWorkflowError(workflowErrorText(error) ?? workflowCopy.planningFailed)
        return false
      }
    },
    [
      applyWorkflowIntakeResponse,
      sendWorkflowPlanningMutation,
      startWorkflowPlanningMutation,
      workflowActiveBatch,
      workflowBusy,
      workflowCopy.planningFailed,
      workflowIntakeId,
      workflowReferences,
      workflowRoot
    ]
  )

  const runtimeMessageRepository = useMemo(() => {
    const items: { message: ThreadMessage; parentId: string | null }[] = []
    const branchParentByGroup = new Map<string, string | null>()
    let visibleParentId: string | null = null
    let headId: string | null = null

    for (const message of messages) {
      let parentId = visibleParentId

      if (message.role === 'assistant' && message.branchGroupId) {
        if (!branchParentByGroup.has(message.branchGroupId)) {
          branchParentByGroup.set(message.branchGroupId, visibleParentId)
        }

        parentId = branchParentByGroup.get(message.branchGroupId) ?? null
      }

      const cachedMessage = runtimeMessageCacheRef.current.get(message)
      const runtimeMessage = cachedMessage ?? toRuntimeMessage(message)

      if (!cachedMessage) {
        runtimeMessageCacheRef.current.set(message, runtimeMessage)
      }

      items.push({ message: runtimeMessage, parentId })

      if (!message.hidden) {
        visibleParentId = message.id
        headId = message.id
      }
    }

    return ExportedMessageRepository.fromBranchableArray(items, { headId })
  }, [messages])

  const runtime = useIncrementalExternalStoreRuntime<ThreadMessage>({
    messageRepository: runtimeMessageRepository,
    isRunning: workflowModeActive ? workflowBusy : busy,
    setMessages: onThreadMessagesChange,
    onNew: async () => {
      // Submission is handled explicitly by ChatBar.
      // Keeping this no-op avoids duplicate prompt.submit calls.
    },
    onEdit,
    onCancel: async () => onCancel(),
    onReload
  })

  // Drop files anywhere in the conversation area, not just on the composer
  // input — appending the same inline `@file:` ref chips the composer drop
  // produces (vs. attachment cards) so both surfaces behave identically.
  const onDropFiles = useCallback(
    (candidates: DroppedFile[]) => {
      const refs = candidates
        .map(candidate => droppedFileInlineRef(candidate, currentCwd))
        .filter((ref): ref is string => Boolean(ref))

      if (refs.length) {
        requestComposerInsert(refs.join(' '), { mode: 'inline', target: 'main' })
      }
    },
    [currentCwd]
  )

  // Dropping a sidebar session inserts an @session link the agent can resolve
  // via session_search (carries the source profile, so cross-profile works).
  const onDropSession = useCallback((session: SessionDragPayload) => {
    requestComposerInsertRefs([sessionInlineRef(session)], { target: 'main' })
  }, [])

  const { dragKind, dropHandlers } = useFileDropZone({ enabled: showChatBar, onDropFiles, onDropSession })

  return (
    <div
      className={cn(
        'relative isolate flex h-full min-w-0 flex-col overflow-hidden bg-(--ui-chat-surface-background)',
        className
      )}
    >
      <Backdrop />
      <ChatHeader
        activeSessionId={activeSessionId}
        isRoutedSessionView={isRoutedSessionView}
        onDeleteSelectedSession={onDeleteSelectedSession}
        onToggleSelectedPin={onToggleSelectedPin}
        selectedSessionId={selectedSessionId}
      />

      <PromptOverlays />

      <div
        className="relative min-h-0 max-w-full flex-1 overflow-hidden bg-(--ui-chat-surface-background) contain-[layout_paint]"
        {...dropHandlers}
      >
        <AssistantRuntimeProvider runtime={runtime}>
          {workflowTranscriptActive ? (
            <WorkflowPlanningThread
              batch={workflowBatch}
              busy={workflowBusy}
              copy={workflowCopy}
              draftMessageIndex={workflowDraftMessageIndex}
              draftWorkflow={workflowDraft}
              error={workflowMutationError}
              messages={workflowMessages}
              onPreview={() => setWorkflowPreviewOpen(true)}
              onSubmitAnswers={answers => submitWorkflowAnswersMutation.mutate(answers)}
            />
          ) : (
            <Thread
              clampToComposer={showChatBar}
              cwd={currentCwd}
              gateway={gateway}
              intro={showIntro ? { personality: introPersonality, seed: introSeed } : undefined}
              loading={threadLoading}
              onBranchInNewChat={onBranchInNewChat}
              onCancel={onCancel}
              sessionId={activeSessionId}
              sessionKey={threadKey}
            />
          )}
          {showChatBar && (
            <Suspense fallback={<ChatBarFallback />}>
              <ChatBar
                busy={workflowModeActive ? workflowBusy : busy}
                cwd={currentCwd}
                disabled={!gatewayOpen || (workflowModeActive && workflowActiveBatch)}
                footerSlot={
                  workflowModeAllowed ? (
                    <WorkflowChatFooter
                      copy={workflowCopy}
                      disabled={workflowBusy}
                      onChooseRoot={() => {
                        void window.hermesDesktop
                          ?.selectPaths({ directories: true, title: workflowCopy.chooseWorkflowProjectDirectory })
                          .then(paths => paths?.[0] && setWorkflowRoot(paths[0]))
                      }}
                      onEnabledChange={enabled => setMode(enabled ? 'workflow' : 'session')}
                      onInitialize={() => confirmWorkflowPlanningMutation.mutate()}
                      onResetRoot={() => setWorkflowRoot('')}
                      root={workflowRoot}
                      showInitialize={workflowModeActive && workflowDraftReady && Boolean(workflowIntakeId)}
                      workflowEnabled={workflowModeActive}
                    />
                  ) : null
                }
                focusKey={activeSessionId}
                gateway={gateway}
                maxRecordingSeconds={maxVoiceRecordingSeconds}
                onAddContextRef={onAddContextRef}
                onAddUrl={onAddUrl}
                onAttachDroppedItems={onAttachDroppedItems}
                onAttachImageBlob={onAttachImageBlob}
                onCancel={onCancel}
                onPasteClipboardImage={onPasteClipboardImage}
                onPickFiles={onPickFiles}
                onPickFolders={onPickFolders}
                onPickImages={onPickImages}
                onRemoveAttachment={onRemoveAttachment}
                onSubmit={(text, options) =>
                  workflowModeActive ? submitWorkflowPlanning(text, options) : onSubmit(text, options)
                }
                onTranscribeAudio={onTranscribeAudio}
                placeholderOverride={workflowPlaceholderOverride}
                placement={showIntro && !workflowTranscriptActive ? 'center' : 'bottom'}
                queueSessionKey={selectedSessionId || activeSessionId}
                sessionId={activeSessionId}
                state={
                  workflowModeActive
                    ? {
                        ...chatBarState,
                        tools: { ...chatBarState.tools, label: workflowCopy.projectReferences },
                        voice: { active: false, enabled: false }
                      }
                    : chatBarState
                }
                submitLabelOverride={workflowModeActive ? workflowCopy.startPlanning : undefined}
              />
            </Suspense>
          )}
          <WorkflowDraftPreviewDialog
            onOpenChange={setWorkflowPreviewOpen}
            onSelectNode={setWorkflowPreviewNodeId}
            open={workflowPreviewOpen}
            selectedNodeId={workflowPreviewNodeId}
            workflow={workflowDraft}
          />
        </AssistantRuntimeProvider>
        <ChatDropOverlay kind={dragKind} />
        <ChatSwapOverlay profile={gatewaySwapTarget} />
      </div>
    </div>
  )
}
