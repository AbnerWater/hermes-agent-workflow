import {
  type AppendMessage,
  AssistantRuntimeProvider,
  ExportedMessageRepository,
  type ThreadMessage
} from '@assistant-ui/react'
import { useStore } from '@nanostores/react'
import { useQuery } from '@tanstack/react-query'
import type * as React from 'react'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { type WorkflowCopy, workflowCopyFor } from '@/app/workflows/i18n'
import { Thread } from '@/components/assistant-ui/thread'
import { Backdrop } from '@/components/Backdrop'
import { PromptOverlays } from '@/components/prompt-overlays'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Switch } from '@/components/ui/switch'
import { getGlobalModelOptions, type HermesGateway } from '@/hermes'
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

import { NEW_CHAT_ROUTE, routeSessionId } from '../routes'
import { titlebarHeaderBaseClass, titlebarHeaderShadowClass } from '../shell/titlebar'

import { ChatDropOverlay } from './chat-drop-overlay'
import { ChatSwapOverlay } from './chat-swap-overlay'
import { ChatBar, ChatBarFallback } from './composer'
import { requestComposerInsert, requestComposerInsertRefs } from './composer/focus'
import { droppedFileInlineRef, type SessionDragPayload, sessionInlineRef } from './composer/inline-refs'
import type { ChatBarState, WorkflowPlanningSubmitContext } from './composer/types'
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
    options?: { attachments?: ComposerAttachment[]; fromQueue?: boolean; workflowPlanning?: WorkflowPlanningSubmitContext }
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
  onResetRoot,
  root,
  workflowEnabled
}: {
  copy: WorkflowCopy
  disabled: boolean
  onChooseRoot: () => void
  onEnabledChange: (enabled: boolean) => void
  onResetRoot: () => void
  root: string
  workflowEnabled: boolean
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
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
  const workflowModeAllowed = true
  const [chatMode, setChatMode] = useState<ChatMode>(workflowModeRequested ? 'workflow' : 'session')
  const workflowModeActive = workflowModeAllowed && chatMode === 'workflow'
  const [workflowRoot, setWorkflowRoot] = useState('')
  const [localComposerSubmitted, setLocalComposerSubmitted] = useState(false)

  const showIntro =
    freshDraftReady && !isRoutedSessionView && !selectedSessionId && !activeSessionId && messages.length === 0
  const showCenteredComposer = showIntro && !localComposerSubmitted

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
    setWorkflowRoot('')
  }, [])

  useEffect(() => {
    if (workflowModeRequested) {
      setChatMode(current => (current === 'workflow' ? current : 'workflow'))
      return
    }

    if (!selectedSessionId && !activeSessionId && !isRoutedSessionView) {
      setChatMode(current => (current === 'session' ? current : 'session'))
      resetWorkflowPlanningState()
    }
  }, [activeSessionId, isRoutedSessionView, resetWorkflowPlanningState, selectedSessionId, workflowModeRequested])

  useEffect(() => {
    setLocalComposerSubmitted(false)
  }, [location.pathname, location.search, selectedSessionId])

  const setMode = useCallback(
    (mode: ChatMode) => {
      if (mode === 'session') {
        resetWorkflowPlanningState()
      }

      setChatMode(mode)
      if (!selectedSessionId && !activeSessionId && !isRoutedSessionView) {
        navigate(mode === 'workflow' ? `${NEW_CHAT_ROUTE}?mode=${WORKFLOW_MODE_PARAM}` : NEW_CHAT_ROUTE, {
          replace: location.pathname === NEW_CHAT_ROUTE
        })
      }
    },
    [activeSessionId, isRoutedSessionView, location.pathname, navigate, resetWorkflowPlanningState, selectedSessionId]
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
    isRunning: busy,
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
          <Thread
            clampToComposer={showChatBar}
            cwd={currentCwd}
            gateway={gateway}
            intro={showCenteredComposer ? { personality: introPersonality, seed: introSeed } : undefined}
            loading={threadLoading}
            onBranchInNewChat={onBranchInNewChat}
            onCancel={onCancel}
            sessionId={activeSessionId}
            sessionKey={threadKey}
          />
          {showChatBar && (
            <Suspense fallback={<ChatBarFallback />}>
              <ChatBar
                busy={busy}
                cwd={currentCwd}
                disabled={!gatewayOpen}
                footerSlot={
                  workflowModeAllowed ? (
                    <WorkflowChatFooter
                      copy={workflowCopy}
                      disabled={busy}
                      onChooseRoot={() => {
                        void window.hermesDesktop
                          ?.selectPaths({ directories: true, title: workflowCopy.chooseWorkflowProjectDirectory })
                          .then(paths => paths?.[0] && setWorkflowRoot(paths[0]))
                      }}
                      onEnabledChange={enabled => setMode(enabled ? 'workflow' : 'session')}
                      onResetRoot={() => setWorkflowRoot('')}
                      root={workflowRoot}
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
                onSubmit={(text, options) => {
                  setLocalComposerSubmitted(true)
                  if (!workflowModeActive) {
                    return onSubmit(text, options)
                  }

                  const references = workflowReferencesFromAttachments(options?.attachments ?? [])
                  return onSubmit(text, {
                    ...options,
                    workflowPlanning: {
                      references,
                      root: workflowRoot || undefined
                    }
                  })
                }}
                onTranscribeAudio={onTranscribeAudio}
                placeholderOverride={workflowModeActive ? workflowCopy.taskPlaceholder : undefined}
                placement={showCenteredComposer ? 'center' : 'bottom'}
                queueSessionKey={selectedSessionId || activeSessionId}
                sessionId={activeSessionId}
                state={
                  workflowModeActive
                    ? {
                        ...chatBarState,
                        tools: { ...chatBarState.tools, label: workflowCopy.projectReferences }
                      }
                    : chatBarState
                }
                submitLabelOverride={workflowModeActive ? workflowCopy.startPlanning : undefined}
              />
            </Suspense>
          )}
        </AssistantRuntimeProvider>
        <ChatDropOverlay kind={dragKind} />
        <ChatSwapOverlay profile={gatewaySwapTarget} />
      </div>
    </div>
  )
}
