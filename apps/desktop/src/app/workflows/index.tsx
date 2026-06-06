import '@xyflow/react/dist/style.css'
import './workflows.css'

import { useStore } from '@nanostores/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Background,
  Controls,
  type Edge,
  Handle,
  MarkerType,
  MiniMap,
  type Node,
  type NodeProps,
  type OnConnect,
  type OnNodeDrag,
  type OnNodesChange,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState
} from '@xyflow/react'
import type * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Backdrop } from '@/components/Backdrop'
import { CompactMarkdown } from '@/components/chat/compact-markdown'
import { WordmarkIntro } from '@/components/chat/intro'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { COMPOSER_ROOT_FRAME_CLASS, ComposerRichInput, ComposerSurface } from '@/app/chat/composer/shared'
import {
  attachWorkflowComposerFiles,
  completeWorkflowComposer,
  confirmWorkflowIntake,
  createWorkflowSnapshot,
  executeWorkflowSlashCommand,
  failWorkflowNode,
  generateWorkflow,
  getGlobalModelOptions,
  getSkills,
  getWorkflowFiles,
  getWorkflowProject,
  listWorkflowEvents,
  listWorkflowProjects,
  passWorkflowNode,
  pauseWorkflowRun,
  retryWorkflowNode,
  saveWorkflow,
  sendWorkflowChat,
  sendWorkflowIntakeMessage,
  skipWorkflowNode,
  startWorkflowIntake,
  startWorkflowRun,
  stopWorkflowRun,
  submitWorkflowIntakeAnswers,
  updateWorkflowReferences,
  updateWorkflowSkills
} from '@/hermes'
import { cn } from '@/lib/utils'
import { $workflowLanguage } from '@/store/workflow-language'
import { useTheme } from '@/themes/context'
import type { ModelOptionsResponse, SkillInfo } from '@/types/hermes'
import type {
  ExecutionMode,
  ProjectBundle,
  ProjectListResponse,
  ReferenceItem,
  ReviewDecision,
  SkillBinding,
  StreamEvent,
  VersionSnapshot,
  Workflow,
  WorkflowComposerCompletionItem,
  WorkflowEdge,
  WorkflowFileNode,
  WorkflowIntakeAnswer,
  WorkflowIntakeBatch,
  WorkflowIntakeMessage,
  WorkflowIntakePayload,
  WorkflowIntakeResponse,
  WorkflowNode,
  WorkflowNodeStatus
} from '@/types/workflow'

import { type WorkflowCopy, workflowCopyFor } from './i18n'
import { applyWorkflowProjectChange, dispatchWorkflowProjectsChanged } from './project-events'

type DrawerMode = 'files' | 'references' | 'skills' | 'snapshots' | 'task'

interface WorkflowNodeData extends Record<string, unknown> {
  decisionNode: boolean
  node: WorkflowNode
}

interface WorkflowIntakeReference {
  kind: 'file' | 'folder'
  path: string
}

type FlowNode = Node<WorkflowNodeData, 'workflow'>
type FlowEdge = Edge<{ kind: string }>

const STATUS_TONE: Record<WorkflowNodeStatus, string> = {
  aborted: 'danger',
  completed: 'success',
  created: 'neutral',
  failed: 'danger',
  queued: 'info',
  ready: 'ready',
  retrying: 'warning',
  reviewing: 'warning',
  revision_needed: 'warning',
  running: 'running',
  skipped: 'neutral',
  waiting_user_confirm: 'warning'
}

function useWorkflowCopy(): WorkflowCopy {
  return workflowCopyFor(useStore($workflowLanguage))
}

function statusMeta(copy: WorkflowCopy, status: WorkflowNodeStatus): { label: string; tone: string } {
  return {
    label: copy.status[status] ?? status,
    tone: STATUS_TONE[status] ?? 'neutral'
  }
}

function edgeSourceHandle(edge: WorkflowEdge): 'failure' | 'success' {
  if (edge.sourceHandle === 'failure' || edge.type === 'feedback') {
    return 'failure'
  }

  return 'success'
}

function workflowNodeIsDecisionNode(workflow: Workflow | null, node: WorkflowNode): boolean {
  const nodeType = String(node.type || '')
    .trim()
    .toLowerCase()

  return (
    nodeType === 'review' ||
    nodeType === 'test' ||
    nodeType === 'testing' ||
    node.reviewRules.required ||
    Boolean(workflow?.edges.some(edge => edge.source === node.id && edgeSourceHandle(edge) === 'failure'))
  )
}

const EVENT_ICON: Record<StreamEvent['type'], string> = {
  ai_reply: 'sparkle',
  approval: 'pass',
  error: 'error',
  node_status: 'pulse',
  process_summary: 'list-tree',
  snapshot: 'git-commit',
  stage_result: 'checklist',
  tool_call: 'tools'
}

const STREAM_BOTTOM_THRESHOLD = 48
const WORKFLOW_NODE_WIDTH = 260
const WORKFLOW_NODE_HEIGHT = 112
const WORKFLOW_LAYOUT_COLUMN_GAP = 360
const WORKFLOW_LAYOUT_ROW_GAP = 170
const WORKFLOW_LAYOUT_BAND_GAP = 250
const WORKFLOW_LAYOUT_MAX_COLUMNS = 5

const DEFAULT_SKILLS: SkillBinding[] = [
  { id: 'planner', name: 'planner', enabled: true, source: 'hermes' },
  { id: 'file', name: 'file', enabled: true, source: 'hermes' },
  { id: 'terminal', name: 'terminal', enabled: true, source: 'hermes' },
  { id: 'reviewer', name: 'reviewer', enabled: true, source: 'hermes' },
  { id: 'writer', name: 'writer', enabled: true, source: 'hermes' }
]

const DEFAULT_MAX_CONCURRENCY = 2
const RIGHT_DRAWER_WIDTH_KEY = 'hermes.workflow.rightDrawerWidth'
const RIGHT_DRAWER_MIN_WIDTH = 280
const RIGHT_DRAWER_MAX_WIDTH = 640
const RIGHT_DRAWER_DEFAULT_WIDTH = 352

function WorkflowNodeCard({ data, selected }: NodeProps<FlowNode>) {
  const copy = useWorkflowCopy()
  const status = statusMeta(copy, data.node.status)
  const hasReview = data.decisionNode
  const nodeType = copy.nodeType[data.node.type as keyof typeof copy.nodeType] ?? data.node.type.toUpperCase()

  return (
    <div className={cn('workflow-node-card', selected && 'is-selected', `tone-${status.tone}`)}>
      <Handle
        className="workflow-handle workflow-handle--input"
        id="input"
        position={Position.Left}
        title={copy.input}
        type="target"
      />
      <div className="workflow-node-card__top">
        <span className="workflow-node-card__type">{nodeType}</span>
        <span className={cn('workflow-status-pill', `tone-${status.tone}`)}>{status.label}</span>
      </div>
      <div className="workflow-node-card__title">{data.node.title}</div>
      <div className="workflow-node-card__description">{data.node.description}</div>
      <div className="workflow-node-card__meta">
        <span>{data.node.skills.length ? data.node.skills.join(' / ') : copy.noSkill}</span>
        {hasReview && <span>{copy.reviewGate}</span>}
      </div>
      <Handle
        className={cn(
          'workflow-handle workflow-handle--success',
          !data.decisionNode && 'workflow-handle--single-output'
        )}
        id="success"
        position={Position.Right}
        title={copy.successOutput}
        type="source"
      />
      {data.decisionNode && (
        <Handle
          className="workflow-handle workflow-handle--failure"
          id="failure"
          position={Position.Right}
          title={copy.failureOutput}
          type="source"
        />
      )}
    </div>
  )
}

const nodeTypes = { workflow: WorkflowNodeCard }

export function WorkflowsView() {
  return (
    <ReactFlowProvider>
      <WorkflowWorkbench />
    </ReactFlowProvider>
  )
}

function WorkflowWorkbench() {
  const workflowLanguage = useStore($workflowLanguage)
  const { resolvedMode } = useTheme()
  const copy = workflowCopyFor(workflowLanguage)
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [autoFollowRunNode, setAutoFollowRunNode] = useState(true)
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('task')
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [streamExpanded, setStreamExpanded] = useState(false)
  const [filterSelectedNode, setFilterSelectedNode] = useState(false)
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('semi_auto')
  const [streamEvents, setStreamEvents] = useState<StreamEvent[]>([])
  const [wsHealthy, setWsHealthy] = useState(false)
  const [flowNodes, setFlowNodes, onNodesChangeBase] = useNodesState<FlowNode>([])
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState<FlowEdge>([])
  const latestEventTimestampRef = useRef<number | undefined>(undefined)
  const requestedProjectId = searchParams.get('project')
  const requestNewProject = searchParams.get('new') === '1'

  const projectsQuery = useQuery({
    queryKey: ['workflow-projects'],
    queryFn: () => listWorkflowProjects()
  })

  useEffect(() => {
    const firstProject = projectsQuery.data?.projects[0]

    if (requestedProjectId && requestedProjectId !== activeProjectId) {
      setActiveProjectId(requestedProjectId)
      setSelectedNodeId(null)
      setAutoFollowRunNode(true)
      setStreamEvents([])
      latestEventTimestampRef.current = undefined

      return
    }

    if (requestNewProject && activeProjectId) {
      setActiveProjectId(null)
      setSelectedNodeId(null)
      setAutoFollowRunNode(true)
      setStreamEvents([])
      latestEventTimestampRef.current = undefined

      return
    }

    if (!activeProjectId && firstProject && !requestNewProject) {
      setActiveProjectId(firstProject.id)
    }
  }, [activeProjectId, projectsQuery.data?.projects, projectsQuery.isSuccess, requestNewProject, requestedProjectId])

  const bundleQuery = useQuery({
    queryKey: ['workflow-project', activeProjectId],
    queryFn: () => getWorkflowProject(activeProjectId!),
    enabled: Boolean(activeProjectId),
    refetchInterval: 1800
  })

  const filesQuery = useQuery({
    queryKey: ['workflow-files', activeProjectId],
    queryFn: () => getWorkflowFiles(activeProjectId!),
    enabled: Boolean(activeProjectId && drawerMode === 'files'),
    refetchInterval: drawerMode === 'files' ? 3000 : false
  })

  const availableSkillsQuery = useQuery({
    queryKey: ['workflow-available-skills'],
    queryFn: getSkills
  })

  const modelOptionsQuery = useQuery({
    queryKey: ['workflow-model-options'],
    queryFn: getGlobalModelOptions
  })

  const eventsQuery = useQuery({
    queryKey: ['workflow-events', activeProjectId],
    queryFn: () => listWorkflowEvents(activeProjectId!, latestEventTimestampRef.current),
    enabled: Boolean(activeProjectId) && !wsHealthy,
    refetchInterval: wsHealthy ? false : 1500
  })

  useEffect(() => {
    if (eventsQuery.data?.events.length) {
      setStreamEvents(previous => mergeEvents(previous, eventsQuery.data.events))
    }
  }, [eventsQuery.data])

  useEffect(() => {
    if (!activeProjectId) {
      return
    }

    let disposed = false
    let socket: WebSocket | null = null

    void window.hermesDesktop
      .getConnection()
      .then(connection => {
        if (disposed) {
          return
        }

        const wsBase = connection.baseUrl.replace(/^http/i, connection.baseUrl.startsWith('https') ? 'wss' : 'ws')
        const since = latestEventTimestampRef.current

        const suffix = new URLSearchParams({
          token: connection.token,
          ...(typeof since === 'number' ? { since: String(since) } : {})
        })

        socket = new WebSocket(
          `${wsBase}/api/workflows/projects/${encodeURIComponent(activeProjectId)}/events?${suffix}`
        )
        socket.onopen = () => setWsHealthy(true)
        socket.onclose = () => setWsHealthy(false)
        socket.onerror = () => setWsHealthy(false)

        socket.onmessage = event => {
          try {
            const payload = JSON.parse(String(event.data)) as StreamEvent
            setStreamEvents(previous => mergeEvents(previous, [payload]))
          } catch {
            // Ignore malformed side-channel events; polling remains active on reconnect.
          }
        }
      })
      .catch(() => setWsHealthy(false))

    return () => {
      disposed = true
      setWsHealthy(false)
      socket?.close()
    }
  }, [activeProjectId])

  const bundle = bundleQuery.data ?? null
  const workflow = bundle?.workflow ?? null

  const selectedNode = useMemo(
    () => workflow?.nodes.find(node => node.id === selectedNodeId) ?? workflow?.nodes[0] ?? null,
    [selectedNodeId, workflow]
  )

  const activeRun = bundle?.latestRun ?? null
  const runtimeNodeId = useMemo(() => latestWorkflowRuntimeNodeId(activeRun, streamEvents), [activeRun, streamEvents])

  const runtimeNode = useMemo(
    () => workflow?.nodes.find(node => node.id === runtimeNodeId) ?? null,
    [runtimeNodeId, workflow]
  )

  useEffect(() => {
    const latest = streamEvents.at(-1)
    const previousTimestamp = latestEventTimestampRef.current

    if (latest && previousTimestamp && latest.timestamp > previousTimestamp && workflowEventNeedsCue(latest)) {
      playWorkflowCue()
    }
  }, [streamEvents])

  useEffect(() => {
    latestEventTimestampRef.current = streamEvents.at(-1)?.timestamp
  }, [streamEvents])

  useEffect(() => {
    if (selectedNode && selectedNode.id !== selectedNodeId) {
      setSelectedNodeId(selectedNode.id)
    }
  }, [selectedNode, selectedNodeId])

  useEffect(() => {
    if (!autoFollowRunNode || !runtimeNode || selectedNodeId === runtimeNode.id) {
      return
    }

    setSelectedNodeId(runtimeNode.id)

    if (activeRun?.status === 'waiting_user_confirm') {
      setDrawerMode('task')
    }
  }, [activeRun?.status, autoFollowRunNode, runtimeNode, selectedNodeId])

  useEffect(() => {
    if (!workflow) {
      setFlowNodes([])
      setFlowEdges([])

      return
    }

    const displayWorkflow = workflowWithDisplayLayout(workflow)
    setFlowNodes(toFlowNodes(displayWorkflow))
    setFlowEdges(toFlowEdges(displayWorkflow, copy))
  }, [copy, setFlowEdges, setFlowNodes, workflow])

  const invalidateProject = useCallback(
    async (projectId = activeProjectId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workflow-projects'] }),
        queryClient.invalidateQueries({ queryKey: ['workflow-project', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['workflow-events', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['workflow-files', projectId] })
      ])
    },
    [activeProjectId, queryClient]
  )

  const handleIntakeComplete = useCallback(
    async (data: ProjectBundle) => {
      queryClient.setQueryData<ProjectListResponse>(['workflow-projects'], current => ({
        projects: applyWorkflowProjectChange(current?.projects ?? [], { action: 'created', project: data.project })
      }))
      dispatchWorkflowProjectsChanged({ action: 'created', project: data.project })
      setActiveProjectId(data.project.id)
      setSelectedNodeId(data.workflow.nodes[0]?.id ?? null)
      setAutoFollowRunNode(true)
      setDrawerMode('task')
      setStreamEvents([])
      latestEventTimestampRef.current = undefined
      setSearchParams({ project: data.project.id })
      await invalidateProject(data.project.id)
    },
    [invalidateProject, queryClient, setSearchParams]
  )

  const generateMutation = useMutation({
    mutationFn: () => generateWorkflow(activeProjectId!),
    onSuccess: async data => {
      queryClient.setQueryData<ProjectListResponse>(['workflow-projects'], current => ({
        projects: applyWorkflowProjectChange(current?.projects ?? [], { action: 'updated', project: data.project })
      }))
      dispatchWorkflowProjectsChanged({ action: 'updated', project: data.project })
      setSelectedNodeId(data.workflow.nodes[0]?.id ?? null)
      setAutoFollowRunNode(true)
      await invalidateProject(data.project.id)
    }
  })

  const saveWorkflowMutation = useMutation({
    mutationFn: ({ nextWorkflow, snapshotLabel }: { nextWorkflow: Workflow; snapshotLabel: string }) =>
      saveWorkflow(activeProjectId!, nextWorkflow, snapshotLabel),
    onSuccess: data => invalidateProject(data.project.id)
  })

  const runMutation = useMutation({
    mutationFn: () =>
      startWorkflowRun(activeProjectId!, { maxConcurrency: DEFAULT_MAX_CONCURRENCY, mode: executionMode }),
    onSuccess: data => invalidateProject(data.project?.id)
  })

  const pauseMutation = useMutation({
    mutationFn: (runId: string) => pauseWorkflowRun(runId),
    onSuccess: data => invalidateProject(data.run.projectId)
  })

  const stopMutation = useMutation({
    mutationFn: (runId: string) => stopWorkflowRun(runId),
    onSuccess: data => invalidateProject(data.run.projectId)
  })

  const nodeActionMutation = useMutation({
    mutationFn: ({
      action,
      nodeId,
      reason,
      runId,
      targetNodeId
    }: {
      action: 'fail' | 'pass' | 'retry' | 'skip'
      nodeId: string
      reason?: string
      runId: string
      targetNodeId?: string
    }) => {
      if (action === 'pass') {
        return passWorkflowNode(runId, nodeId)
      }

      if (action === 'fail') {
        if (!targetNodeId) {
          throw new Error('Failure target is required')
        }

        return failWorkflowNode(runId, nodeId, { reason, targetNodeId })
      }

      if (action === 'retry') {
        return retryWorkflowNode(runId, nodeId)
      }

      return skipWorkflowNode(runId, nodeId)
    },
    onSuccess: data => invalidateProject(data.run?.projectId ?? activeProjectId)
  })

  const chatMutation = useMutation({
    mutationFn: ({ attachments, text }: { attachments: string[]; text: string }) =>
      sendWorkflowChat({
        attachments,
        projectId: activeProjectId!,
        nodeId: selectedNode?.id ?? null,
        text
      }),
    onSuccess: () => invalidateProject()
  })

  const slashMutation = useMutation({
    mutationFn: (command: string) =>
      executeWorkflowSlashCommand(activeProjectId!, { command, nodeId: selectedNode?.id ?? null }),
    onSuccess: () => invalidateProject()
  })

  const composerAttachmentMutation = useMutation({
    mutationFn: (paths: string[]) => attachWorkflowComposerFiles(activeProjectId!, paths),
    onSuccess: data => {
      if (data.references) {
        return invalidateProject()
      }

      return undefined
    }
  })

  const referencesMutation = useMutation({
    mutationFn: (references: ReferenceItem[]) => updateWorkflowReferences(activeProjectId!, references),
    onSuccess: data => invalidateProject(data.project.id)
  })

  const skillsMutation = useMutation({
    mutationFn: (skills: SkillBinding[]) => updateWorkflowSkills(activeProjectId!, skills),
    onSuccess: data => invalidateProject(data.project.id)
  })

  const snapshotMutation = useMutation({
    mutationFn: () => createWorkflowSnapshot(activeProjectId!),
    onSuccess: () => invalidateProject()
  })

  const onNodesChange = useCallback<OnNodesChange<FlowNode>>(
    changes => {
      onNodesChangeBase(changes)
    },
    [onNodesChangeBase]
  )

  const persistNodePosition = useCallback<OnNodeDrag<FlowNode>>(
    (_event, draggedNode) => {
      if (!workflow) {
        return
      }

      const nextNodes = flowNodes.map(node => (node.id === draggedNode.id ? draggedNode : node))
      saveWorkflowMutation.mutate({
        nextWorkflow: workflowWithPositions(workflow, nextNodes),
        snapshotLabel: 'Canvas node moved'
      })
    },
    [flowNodes, saveWorkflowMutation, workflow]
  )

  const onConnect = useCallback<OnConnect>(
    connection => {
      if (!workflow || !connection.source || !connection.target) {
        return
      }

      const sourceHandle = connection.sourceHandle === 'failure' ? 'failure' : 'success'
      const sourceNode = workflow.nodes.find(node => node.id === connection.source)

      if (!sourceNode) {
        return
      }

      if (sourceHandle === 'failure' && !workflowNodeIsDecisionNode(workflow, sourceNode)) {
        return
      }

      if (workflow.edges.some(edge => edge.source === connection.source && edgeSourceHandle(edge) === sourceHandle)) {
        return
      }

      const edge: WorkflowEdge = {
        id: `edge-${connection.source}-${connection.target}-${Date.now()}`,
        source: connection.source,
        target: connection.target,
        type: sourceHandle === 'failure' ? 'feedback' : 'dependency',
        sourceHandle,
        targetHandle: 'input',
        label: sourceHandle === 'failure' ? copy.failureOutput : copy.successOutput,
        optional: false
      }

      saveWorkflowMutation.mutate({
        nextWorkflow: { ...workflow, edges: [...workflow.edges, edge], updatedAt: Date.now() / 1000 },
        snapshotLabel: 'Canvas edge created'
      })
    },
    [copy.failureOutput, copy.successOutput, saveWorkflowMutation, workflow]
  )

  const saveNodeConfig = useCallback(
    (nextNode: WorkflowNode) => {
      if (!workflow) {
        return
      }

      saveWorkflowMutation.mutate({
        nextWorkflow: {
          ...workflow,
          nodes: workflow.nodes.map(node => (node.id === nextNode.id ? nextNode : node)),
          updatedAt: Date.now() / 1000
        },
        snapshotLabel: `Node config updated: ${nextNode.title}`
      })
    },
    [saveWorkflowMutation, workflow]
  )

  const followRuntimeNode = useCallback(() => {
    setAutoFollowRunNode(true)

    if (runtimeNode) {
      setSelectedNodeId(runtimeNode.id)
      setDrawerMode('task')
    }
  }, [runtimeNode])

  const visibleEvents = useMemo(() => {
    if (!filterSelectedNode || !selectedNode) {
      return streamEvents
    }

    return streamEvents.filter(event => !event.nodeId || event.nodeId === selectedNode.id)
  }, [filterSelectedNode, selectedNode, streamEvents])

  const busy =
    generateMutation.isPending ||
    saveWorkflowMutation.isPending ||
    runMutation.isPending ||
    pauseMutation.isPending ||
    stopMutation.isPending ||
    nodeActionMutation.isPending ||
    slashMutation.isPending ||
    composerAttachmentMutation.isPending

  const showIntake = requestNewProject || (projectsQuery.isSuccess && !activeProjectId)

  return (
    <div className={cn('workflow-workbench', workflowLanguage === 'zh' && 'workflow-workbench--zh')}>
      {showIntake ? (
        <WorkflowIntakePage onComplete={handleIntakeComplete} />
      ) : (
        <>
          <ExecutionToolbar
            activeRun={activeRun}
            busy={busy}
            executionMode={executionMode}
            onModeChange={setExecutionMode}
            onPause={() => activeRun && pauseMutation.mutate(activeRun.id)}
            onRun={() => {
              setAutoFollowRunNode(true)
              runMutation.mutate()
            }}
            onStop={() => activeRun && stopMutation.mutate(activeRun.id)}
            project={bundle?.project ?? null}
            selectedNode={selectedNode}
          />

          <div className="workflow-main">
            <section aria-label="Workflow canvas workbench" className="workflow-center">
              <WorkflowFloatingToolbar active={drawerMode} onToggle={setDrawerMode} />
              <WorkflowStatusOverlay
                activeRun={activeRun}
                executionMode={executionMode}
                onFollowRuntimeNode={followRuntimeNode}
                runtimeNode={runtimeNode}
                selectedNode={selectedNode}
                workflow={workflow}
              />
              {bundleQuery.isLoading || projectsQuery.isLoading ? (
                <WorkbenchLoading />
              ) : workflow && workflow.nodes.length > 0 ? (
                <ReactFlow
                  className="workflow-flow"
                  colorMode={resolvedMode}
                  connectOnClick={false}
                  edges={flowEdges}
                  elementsSelectable
                  fitView
                  maxZoom={1.4}
                  minZoom={0.35}
                  nodes={flowNodes}
                  nodesConnectable
                  nodesDraggable
                  nodeTypes={nodeTypes}
                  onConnect={onConnect}
                  onEdgesChange={onEdgesChange}
                  onNodeClick={(_event, node) => {
                    setAutoFollowRunNode(false)
                    setSelectedNodeId(node.id)
                    setDrawerMode('task')
                  }}
                  onNodeDragStop={persistNodePosition}
                  onNodesChange={onNodesChange}
                  proOptions={{ hideAttribution: true }}
                >
                  <Background color="var(--workflow-canvas-dot)" gap={24} size={1} />
                  <MiniMap
                    className="workflow-minimap"
                    maskColor="var(--workflow-minimap-mask)"
                    nodeColor={node => statusColor((node.data as WorkflowNodeData).node.status)}
                    pannable
                    zoomable
                  />
                  <Controls className="workflow-controls" showInteractive={false} />
                </ReactFlow>
              ) : (
                <EmptyWorkbench
                  busy={generateMutation.isPending}
                  hasProject={Boolean(activeProjectId)}
                  onAddReference={() => setDrawerMode('references')}
                  onCreate={() => setSearchParams({ new: '1' })}
                  onGenerate={() => activeProjectId && generateMutation.mutate()}
                />
              )}

              <StreamOutputPanel
                events={visibleEvents}
                expanded={streamExpanded}
                filterSelectedNode={filterSelectedNode}
                onFilterSelectedNode={setFilterSelectedNode}
                onToggleExpanded={() => setStreamExpanded(value => !value)}
                selectedNode={selectedNode}
                wsHealthy={wsHealthy}
              />
              <WorkflowChatBox
                disabled={!activeProjectId || chatMutation.isPending || slashMutation.isPending}
                onAttach={paths => composerAttachmentMutation.mutateAsync(paths).then(() => undefined)}
                onSlash={command => slashMutation.mutate(command)}
                onSubmit={(text, attachments) => chatMutation.mutate({ attachments, text })}
                projectId={activeProjectId}
                projectRoot={bundle?.project.root}
                selectedNode={selectedNode}
              />
            </section>

            {(drawerMode === 'task' ||
              drawerMode === 'files' ||
              drawerMode === 'references' ||
              drawerMode === 'skills' ||
              drawerMode === 'snapshots') && (
              <RightDrawer
                activeRun={activeRun}
                artifacts={bundle?.artifacts ?? []}
                availableSkills={availableSkillsQuery.data ?? []}
                files={filesQuery.data?.tree ?? []}
                filesLoading={filesQuery.isLoading}
                mode={drawerMode}
                modelOptions={modelOptionsQuery.data ?? null}
                node={selectedNode}
                onAddReferences={paths => {
                  const current = bundle?.references ?? []

                  const next = [
                    ...current,
                    ...paths
                      .map(path => referenceFromPath(path))
                      .filter(ref => !current.some(item => item.path === ref.path))
                  ]

                  referencesMutation.mutate(next)
                }}
                onClose={() => setDrawerMode('task')}
                onNodeAction={(action, nodeId, runId, payload) => {
                  setAutoFollowRunNode(true)
                  setSelectedNodeId(payload?.targetNodeId ?? nodeId)
                  nodeActionMutation.mutate({ action, nodeId, runId, ...payload })
                }}
                onOpenFile={openPath}
                onSaveNode={saveNodeConfig}
                onSelectFile={setSelectedFilePath}
                onSnapshot={() => snapshotMutation.mutate()}
                onToggleReference={(reference, enabled) => {
                  const references = (bundle?.references ?? []).map(item =>
                    item.id === reference.id ? { ...item, enabled } : item
                  )

                  referencesMutation.mutate(references)
                }}
                onToggleSkill={(skill, enabled) => {
                  const current = bundle?.skills.length ? bundle.skills : DEFAULT_SKILLS
                  const skills = current.map(item => (item.id === skill.id ? { ...item, enabled } : item))
                  skillsMutation.mutate(skills)
                }}
                references={bundle?.references ?? []}
                root={bundle?.project.root}
                selectedFilePath={selectedFilePath}
                skills={bundle?.skills.length ? bundle.skills : DEFAULT_SKILLS}
                snapshots={bundle?.snapshots ?? []}
                workflow={workflow}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}

function ExecutionToolbar({
  activeRun,
  busy,
  executionMode,
  onModeChange,
  onPause,
  onRun,
  onStop,
  project,
  selectedNode
}: {
  activeRun: ProjectBundle['latestRun']
  busy: boolean
  executionMode: ExecutionMode
  onModeChange: (mode: ExecutionMode) => void
  onPause: () => void
  onRun: () => void
  onStop: () => void
  project: ProjectBundle['project'] | null
  selectedNode: WorkflowNode | null
}) {
  const copy = useWorkflowCopy()
  const running = activeRun?.status === 'running'

  return (
    <section aria-label="Workflow execution controls" className="workflow-execution-toolbar">
      <div className="workflow-execution-toolbar__identity">
        <div className="workflow-title">{project?.name ?? 'hermes-workflow'}</div>
        <div className="workflow-subtitle">
          {selectedNode ? `${copy.currentNodePrefix}${selectedNode.title}` : (project?.root ?? copy.workflowStartHint)}
        </div>
      </div>

      <div className="workflow-execution-toolbar__controls">
        <Select onValueChange={value => onModeChange(value as ExecutionMode)} value={executionMode}>
          <SelectTrigger className="h-8 w-28 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="single_step">{copy.mode.single_step}</SelectItem>
            <SelectItem value="semi_auto">{copy.mode.semi_auto}</SelectItem>
            <SelectItem value="auto">{copy.mode.auto}</SelectItem>
          </SelectContent>
        </Select>

        <Button disabled={!project || busy || running} onClick={onRun} size="sm" type="button">
          <Codicon name="play" size="0.875rem" />
          {copy.run}
        </Button>
        <Button disabled={!running || busy} onClick={onPause} size="sm" type="button" variant="outline">
          <Codicon name="debug-pause" size="0.875rem" />
          {copy.pause}
        </Button>
        <Button
          disabled={!activeRun || busy || activeRun.status === 'stopped'}
          onClick={onStop}
          size="sm"
          type="button"
          variant="outline"
        >
          <Codicon name="debug-stop" size="0.875rem" />
          {copy.stop}
        </Button>
      </div>
    </section>
  )
}

function WorkflowStatusOverlay({
  activeRun,
  executionMode,
  onFollowRuntimeNode,
  runtimeNode,
  selectedNode,
  workflow
}: {
  activeRun: ProjectBundle['latestRun']
  executionMode: ExecutionMode
  onFollowRuntimeNode: () => void
  runtimeNode: WorkflowNode | null
  selectedNode: WorkflowNode | null
  workflow: Workflow | null
}) {
  const copy = useWorkflowCopy()
  const running = activeRun?.status === 'running'
  const waiting = activeRun?.status === 'waiting_user_confirm'
  const completed = workflow ? workflow.nodes.filter(node => node.status === 'completed').length : 0
  const total = workflow?.nodes.length ?? 0
  const displayedNode = runtimeNode ?? selectedNode

  return (
    <div aria-label="Workflow execution status" className="workflow-status-overlay">
      <span className={cn('workflow-run-dot', running && 'is-running', waiting && 'is-waiting')} />
      <span>{activeRun ? runStatusLabel(copy, activeRun.status) : copy.notRun}</span>
      <span>{total ? `${completed}/${total}` : '0/0'}</span>
      <span>{activeRun ? copy.mode[activeRun.mode] : copy.mode[executionMode]}</span>
      {runtimeNode ? (
        <button
          className="workflow-status-overlay__node"
          onClick={onFollowRuntimeNode}
          title={runtimeNode.title}
          type="button"
        >
          <strong>{runtimeNode.title}</strong>
        </button>
      ) : (
        <strong title={displayedNode?.title ?? undefined}>
          {displayedNode ? displayedNode.title : copy.noNodeSelected}
        </strong>
      )}
    </div>
  )
}

function WorkflowFloatingToolbar({ active, onToggle }: { active: DrawerMode; onToggle: (mode: DrawerMode) => void }) {
  const copy = useWorkflowCopy()

  const items: Array<{ icon: string; label: string; mode: DrawerMode }> = [
    { icon: 'graph', label: copy.nodeDetails, mode: 'task' },
    { icon: 'files', label: copy.fileTree, mode: 'files' },
    { icon: 'references', label: copy.references, mode: 'references' },
    { icon: 'symbol-misc', label: copy.skills, mode: 'skills' },
    { icon: 'git-commit', label: copy.snapshots, mode: 'snapshots' }
  ]

  return (
    <div aria-label={copy.tools} className="workflow-floating-toolbar" role="toolbar">
      {items.map(item => (
        <button
          aria-label={item.label}
          className={cn(active === item.mode && 'is-active')}
          key={item.mode}
          onClick={() => onToggle(item.mode)}
          title={item.label}
          type="button"
        >
          <Codicon name={item.icon} size="1rem" />
        </button>
      ))}
    </div>
  )
}

function FileTreeDrawer({
  files,
  loading,
  onOpenFile,
  onOpenProjectRoot,
  onSelectFile,
  root,
  selectedFilePath
}: {
  files: WorkflowFileNode[]
  loading: boolean
  onOpenFile: (path: string) => void
  onOpenProjectRoot: () => void
  onSelectFile: (path: string) => void
  root?: string
  selectedFilePath: string | null
}) {
  const copy = useWorkflowCopy()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    setExpanded(current => {
      if (current.size) {
        return current
      }

      return new Set(files.filter(item => item.kind === 'folder').map(item => item.path))
    })
  }, [files])

  const toggleExpanded = useCallback((path: string) => {
    setExpanded(current => {
      const next = new Set(current)

      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }

      return next
    })
  }, [])

  return (
    <div className="workflow-file-drawer">
      <div className="workflow-drawer-header">
        <div>
          <h2>{copy.projectFiles}</h2>
          <p>{root ?? copy.noProjectSelected}</p>
        </div>
        <Button
          disabled={!root}
          onClick={onOpenProjectRoot}
          size="icon-sm"
          title={copy.openProjectInExplorer}
          type="button"
          variant="ghost"
        >
          <Codicon name="folder-opened" size="0.875rem" />
        </Button>
      </div>
      <div className="workflow-file-tree">
        {loading ? (
          <div className="workflow-muted">Loading...</div>
        ) : files.length ? (
          files.map(item => (
            <FileTreeItem
              expanded={expanded}
              item={item}
              key={item.path}
              onOpenFile={onOpenFile}
              onSelectFile={onSelectFile}
              onToggleExpanded={toggleExpanded}
              openLabel={copy.openFile}
              selectedFilePath={selectedFilePath}
            />
          ))
        ) : (
          <div className="workflow-muted">{copy.noFiles}</div>
        )}
      </div>
    </div>
  )
}

function FileTreeItem({
  expanded,
  item,
  level = 0,
  onOpenFile,
  onSelectFile,
  onToggleExpanded,
  openLabel,
  selectedFilePath
}: {
  expanded: Set<string>
  item: WorkflowFileNode
  level?: number
  onOpenFile: (path: string) => void
  onSelectFile: (path: string) => void
  onToggleExpanded: (path: string) => void
  openLabel: string
  selectedFilePath: string | null
}) {
  const isFolder = item.kind === 'folder'
  const isExpanded = expanded.has(item.path)
  const selected = selectedFilePath === item.path

  return (
    <div>
      <div
        className={cn('workflow-file-row', selected && 'is-selected')}
        style={{ paddingLeft: `${level * 0.75 + 0.5}rem` }}
      >
        <button
          className="workflow-file-main"
          onClick={() => {
            if (isFolder) {
              onToggleExpanded(item.path)
            } else {
              onSelectFile(item.path)
            }
          }}
          onDoubleClick={() => !isFolder && onOpenFile(item.path)}
          title={item.path}
          type="button"
        >
          <Codicon name={isFolder ? (isExpanded ? 'folder-opened' : 'folder') : 'file'} size="0.8125rem" />
          <span>{item.name}</span>
        </button>
        {!isFolder && (
          <Button
            aria-label={openLabel}
            className="workflow-file-open"
            onClick={() => onOpenFile(item.path)}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <Codicon name="go-to-file" size="0.75rem" />
          </Button>
        )}
      </div>
      {isFolder && isExpanded
        ? item.children?.map(child => (
            <FileTreeItem
              expanded={expanded}
              item={child}
              key={child.path}
              level={level + 1}
              onOpenFile={onOpenFile}
              onSelectFile={onSelectFile}
              onToggleExpanded={onToggleExpanded}
              openLabel={openLabel}
              selectedFilePath={selectedFilePath}
            />
          ))
        : null}
    </div>
  )
}

function RightDrawer({
  activeRun,
  artifacts,
  availableSkills,
  files,
  filesLoading,
  mode,
  modelOptions,
  node,
  onAddReferences,
  onOpenFile,
  onSaveNode,
  onSelectFile,
  onNodeAction,
  onSnapshot,
  onToggleReference,
  onToggleSkill,
  references,
  root,
  selectedFilePath,
  skills,
  snapshots,
  workflow
}: {
  activeRun: ProjectBundle['latestRun']
  artifacts: ProjectBundle['artifacts']
  availableSkills: SkillInfo[]
  files: WorkflowFileNode[]
  filesLoading: boolean
  mode: DrawerMode
  modelOptions: ModelOptionsResponse | null
  node: WorkflowNode | null
  onAddReferences: (paths: string[]) => void
  onClose: () => void
  onOpenFile: (path: string) => void
  onSaveNode: (node: WorkflowNode) => void
  onSelectFile: (path: string) => void
  onNodeAction: (
    action: 'fail' | 'pass' | 'retry' | 'skip',
    nodeId: string,
    runId: string,
    payload?: { reason?: string; targetNodeId?: string }
  ) => void
  onSnapshot: () => void
  onToggleReference: (reference: ReferenceItem, enabled: boolean) => void
  onToggleSkill: (skill: SkillBinding, enabled: boolean) => void
  references: ReferenceItem[]
  root?: string
  selectedFilePath: string | null
  skills: SkillBinding[]
  snapshots: VersionSnapshot[]
  workflow: Workflow | null
}) {
  const [width, setWidth] = useState(readStoredRightDrawerWidth)

  const beginResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      const startX = event.clientX
      const startWidth = width

      const onMove = (moveEvent: PointerEvent) => {
        const nextWidth = clampRightDrawerWidth(startWidth + startX - moveEvent.clientX)
        setWidth(nextWidth)
      }

      const onUp = (upEvent: PointerEvent) => {
        const nextWidth = clampRightDrawerWidth(startWidth + startX - upEvent.clientX)
        setWidth(nextWidth)
        persistRightDrawerWidth(nextWidth)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [width]
  )

  return (
    <aside className="workflow-right-drawer" style={{ width }}>
      <div aria-hidden className="workflow-right-drawer__resize" onPointerDown={beginResize} />
      {mode === 'task' && (
        <TaskDetailDrawer
          activeRun={activeRun}
          artifacts={artifacts}
          availableSkills={availableSkills}
          modelOptions={modelOptions}
          node={node}
          onNodeAction={onNodeAction}
          onOpenFile={onOpenFile}
          onSaveNode={onSaveNode}
          root={root}
          selectedFilePath={selectedFilePath}
          workflow={workflow}
        />
      )}
      {mode === 'files' && (
        <FileTreeDrawer
          files={files}
          loading={filesLoading}
          onOpenFile={onOpenFile}
          onOpenProjectRoot={() => root && openPath(root)}
          onSelectFile={onSelectFile}
          root={root}
          selectedFilePath={selectedFilePath}
        />
      )}
      {mode === 'references' && (
        <ReferenceDrawer
          onAddReferences={onAddReferences}
          onToggleReference={onToggleReference}
          references={references}
        />
      )}
      {mode === 'skills' && <SkillDrawer onToggleSkill={onToggleSkill} skills={skills} />}
      {mode === 'snapshots' && <SnapshotDrawer onSnapshot={onSnapshot} snapshots={snapshots} />}
    </aside>
  )
}

function TaskDetailDrawer({
  activeRun,
  artifacts,
  availableSkills,
  modelOptions,
  node,
  onNodeAction,
  onOpenFile,
  onSaveNode,
  root,
  selectedFilePath,
  workflow
}: {
  activeRun: ProjectBundle['latestRun']
  artifacts: ProjectBundle['artifacts']
  availableSkills: SkillInfo[]
  modelOptions: ModelOptionsResponse | null
  node: WorkflowNode | null
  onNodeAction: (
    action: 'fail' | 'pass' | 'retry' | 'skip',
    nodeId: string,
    runId: string,
    payload?: { reason?: string; targetNodeId?: string }
  ) => void
  onOpenFile: (path: string) => void
  onSaveNode: (node: WorkflowNode) => void
  root?: string
  selectedFilePath: string | null
  workflow: Workflow | null
}) {
  const copy = useWorkflowCopy()
  const [draft, setDraft] = useState<WorkflowNode | null>(node)
  const [skillsOpen, setSkillsOpen] = useState(false)
  const [referencesOpen, setReferencesOpen] = useState(false)
  const [changesOpen, setChangesOpen] = useState(true)
  const [openFilePreviews, setOpenFilePreviews] = useState<Set<string>>(new Set())
  const [promptEditing, setPromptEditing] = useState(false)
  const [promptDraft, setPromptDraft] = useState('')
  const [returnTargetId, setReturnTargetId] = useState('')

  const failureTargets = useMemo(() => {
    if (!workflow || !node) {
      return []
    }

    return workflow.edges
      .filter(edge => edge.source === node.id && edgeSourceHandle(edge) === 'failure')
      .map(edge => ({
        edge,
        node: workflow.nodes.find(candidate => candidate.id === edge.target) ?? null
      }))
      .filter((item): item is { edge: WorkflowEdge; node: WorkflowNode } => Boolean(item.node))
  }, [node, workflow])

  useEffect(() => {
    setDraft(node)
    setSkillsOpen(false)
    setReferencesOpen(false)
    setChangesOpen(true)
    setOpenFilePreviews(new Set())
    setPromptEditing(false)
    setPromptDraft(node?.promptOverride || node?.description || '')
    setReturnTargetId('')
  }, [node])

  useEffect(() => {
    setReturnTargetId(current => {
      if (current && failureTargets.some(item => item.node.id === current)) {
        return current
      }

      return failureTargets[0]?.node.id ?? ''
    })
  }, [failureTargets])

  if (!node) {
    return (
      <div className="workflow-drawer-empty">
        <Codicon name="graph" size="1.25rem" />
        <span>{copy.drawerEmptyNode}</span>
      </div>
    )
  }

  const editable = draft ?? node
  const status = statusMeta(copy, node.status)
  const runId = activeRun?.id ?? null
  const waiting = Boolean(runId && node.status === 'waiting_user_confirm')

  const nodeArtifacts = artifacts.filter(
    artifact => artifact.nodeId === node.id || node.artifacts.includes(artifact.path)
  )

  const modelChoices = flattenModelChoices(modelOptions)
  const references = editable.references ?? []
  const fileChanges = editable.fileChanges ?? []

  const selectedFileForReference =
    selectedFilePath && root ? normalizeProjectReference(root, selectedFilePath) : selectedFilePath

  const effectivePrompt = editable.promptOverride || node.description || copy.taskPlaceholder
  const decisionNode = workflowNodeIsDecisionNode(workflow, node)

  const selectedFailureTarget =
    failureTargets.find(item => item.node.id === returnTargetId) ?? failureTargets[0] ?? null

  const reviewDecision = parseReviewDecision(node.outputs?.reviewDecision)

  const updateDraft = (updates: Partial<WorkflowNode>) => {
    setDraft(current => ({ ...(current ?? node), ...updates }))
  }

  const toggleSkill = (skillName: string, enabled: boolean) => {
    const current = editable.skills ?? []
    updateDraft({
      skills: enabled ? [...new Set([...current, skillName])] : current.filter(skill => skill !== skillName)
    })
  }

  const addReference = (path: string) => {
    if (!path) {
      return
    }

    updateDraft({ references: [...new Set([...references, path])] })
  }

  const toggleFilePreview = (changeKey: string) => {
    setOpenFilePreviews(current => {
      const next = new Set(current)

      if (next.has(changeKey)) {
        next.delete(changeKey)
      } else {
        next.add(changeKey)
      }

      return next
    })
  }

  const beginPromptEditing = () => {
    setPromptDraft(effectivePrompt)
    setPromptEditing(true)
  }

  const cancelPromptEditing = () => {
    setPromptDraft(effectivePrompt)
    setPromptEditing(false)
  }

  const confirmPromptEditing = () => {
    const nextPrompt = promptDraft.trim()
    const nextNode = { ...editable, promptOverride: nextPrompt || null }

    setDraft(nextNode)
    onSaveNode(nextNode)
    setPromptEditing(false)
  }

  return (
    <div className="workflow-task-detail">
      <div className="workflow-drawer-header">
        <div>
          <h2>{node.title}</h2>
          <p>{node.id}</p>
        </div>
        <span className={cn('workflow-status-pill', `tone-${status.tone}`)}>{status.label}</span>
      </div>

      <div className="workflow-task-detail__body">
        <section>
          <div className="workflow-section-header">
            <h3>{copy.editExecutionPrompt}</h3>
          </div>
          {promptEditing ? (
            <div className="workflow-prompt-editor-panel">
              <Textarea
                className="workflow-prompt-editor"
                onChange={event => setPromptDraft(event.target.value)}
                placeholder={copy.taskPlaceholder}
                value={promptDraft}
              />
              <div className="workflow-prompt-editor-actions">
                <Button
                  aria-label={copy.cancelPromptEditing}
                  onClick={cancelPromptEditing}
                  size="xs"
                  type="button"
                  variant="outline"
                >
                  {copy.cancel}
                </Button>
                <Button aria-label={copy.confirmPromptChanges} onClick={confirmPromptEditing} size="xs" type="button">
                  <Codicon name="check" size="0.8125rem" />
                  {copy.confirm}
                </Button>
              </div>
            </div>
          ) : (
            <div className="workflow-prompt-display">
              <div className="workflow-prompt-display__text">{effectivePrompt}</div>
              <Button
                className="workflow-prompt-display__edit"
                onClick={beginPromptEditing}
                size="xs"
                type="button"
                variant="outline"
              >
                <Codicon name="edit" size="0.8125rem" />
                {copy.edit}
              </Button>
            </div>
          )}
        </section>

        <section>
          <h3>{copy.context}</h3>
          <div className="workflow-key-values">
            <span>{copy.type}</span>
            <strong>{copy.nodeType[node.type as keyof typeof copy.nodeType] ?? node.type}</strong>
            <span>{copy.model}</span>
            <strong>{editable.modelOverride ?? editable.model ?? copy.globalModel}</strong>
            <span>{copy.skills}</span>
            <strong>
              {editable.skillMode === 'manual' ? `${editable.skills.length} ${copy.manualSkillsSummary}` : 'auto'}
            </strong>
            <span>{copy.retry}</span>
            <strong>
              {node.retryCount}/{node.maxRetries}
            </strong>
          </div>
        </section>

        {reviewDecision && (
          <section className="workflow-review-decision">
            <h3>{copy.reviewDecision}</h3>
            <div className="workflow-key-values">
              <span>{copy.reviewDecisionStatus}</span>
              <strong>{reviewDecisionLabel(copy, reviewDecision.decision)}</strong>
              {reviewDecision.targetNodeId ? (
                <>
                  <span>{copy.failureTarget}</span>
                  <strong>
                    {workflow?.nodes.find(candidate => candidate.id === reviewDecision.targetNodeId)?.title ??
                      reviewDecision.targetNodeId}
                  </strong>
                </>
              ) : null}
            </div>
            {reviewDecision.reason ? <p>{reviewDecision.reason}</p> : null}
          </section>
        )}

        <section>
          <h3>{copy.executionModel}</h3>
          <Select
            onValueChange={value => updateDraft({ modelOverride: value === '__inherit' ? null : value })}
            value={editable.modelOverride ?? '__inherit'}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__inherit">{copy.globalModel}</SelectItem>
              {modelChoices.map(choice => (
                <SelectItem key={`${choice.provider}-${choice.model}`} value={choice.model}>
                  {choice.provider} / {choice.model}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </section>

        <section>
          <button className="workflow-collapsible-heading" onClick={() => setSkillsOpen(value => !value)} type="button">
            <h3>Skills</h3>
            <span>{editable.skillMode === 'manual' ? `${editable.skills.length} selected` : 'auto'}</span>
            <Codicon name={skillsOpen ? 'chevron-down' : 'chevron-right'} size="0.8125rem" />
          </button>
          {skillsOpen && (
            <div className="workflow-config-list">
              <label className="workflow-toggle-row">
                <span>
                  <strong>{copy.autoCallHermesSkills}</strong>
                  <small>{copy.autoSkillDescription}</small>
                </span>
                <Switch
                  checked={editable.skillMode !== 'manual'}
                  onCheckedChange={checked => updateDraft({ skillMode: checked ? 'auto' : 'manual' })}
                />
              </label>
              {editable.skillMode === 'manual' &&
                availableSkills.map(skill => (
                  <label className="workflow-check-row" key={skill.name}>
                    <input
                      checked={(editable.skills ?? []).includes(skill.name)}
                      onChange={event => toggleSkill(skill.name, event.target.checked)}
                      type="checkbox"
                    />
                    <span>
                      <strong>{skill.name}</strong>
                      <small>
                        {skill.category} · {skill.description}
                      </small>
                    </span>
                  </label>
                ))}
              {editable.skillMode === 'manual' && !availableSkills.length && (
                <div className="workflow-muted">{copy.manualSkillsEmpty}</div>
              )}
            </div>
          )}
        </section>

        <section>
          <button
            className="workflow-collapsible-heading"
            onClick={() => setReferencesOpen(value => !value)}
            type="button"
          >
            <h3>{copy.nodeReferences}</h3>
            <span>{references.length}</span>
            <Codicon name={referencesOpen ? 'chevron-down' : 'chevron-right'} size="0.8125rem" />
          </button>
          {referencesOpen && (
            <div className="workflow-config-list">
              <div className="workflow-inline-actions">
                <Button
                  onClick={() => {
                    void window.hermesDesktop
                      .selectPaths({ multiple: true, title: copy.chooseCurrentNodeReference })
                      .then(paths => paths.forEach(addReference))
                  }}
                  size="xs"
                  type="button"
                  variant="outline"
                >
                  <Codicon name="add" size="0.8125rem" />
                  {copy.addFiles}
                </Button>
                <Button
                  disabled={!selectedFileForReference}
                  onClick={() => selectedFileForReference && addReference(selectedFileForReference)}
                  size="xs"
                  type="button"
                  variant="outline"
                >
                  <Codicon name="files" size="0.8125rem" />
                  {copy.addSelectedFile}
                </Button>
              </div>
              {references.length ? (
                references.map(path => (
                  <div className="workflow-reference-row" key={path}>
                    <span title={path}>{path}</span>
                    <Button
                      onClick={() => onOpenFile(resolveProjectPath(root, path))}
                      size="icon-xs"
                      type="button"
                      variant="ghost"
                    >
                      <Codicon name="go-to-file" size="0.75rem" />
                    </Button>
                    <Button
                      onClick={() => updateDraft({ references: references.filter(item => item !== path) })}
                      size="icon-xs"
                      type="button"
                      variant="ghost"
                    >
                      <Codicon name="close" size="0.75rem" />
                    </Button>
                  </div>
                ))
              ) : (
                <div className="workflow-muted">{copy.noNodeReferences}</div>
              )}
            </div>
          )}
        </section>

        <section>
          <h3>Review Rules</h3>
          <ul className="workflow-checklist">
            {node.reviewRules.checklist.length ? (
              node.reviewRules.checklist.map(item => (
                <li key={item}>
                  <Codicon name="check" size="0.75rem" />
                  {item}
                </li>
              ))
            ) : (
              <li>{copy.noExplicitReviewRules}</li>
            )}
          </ul>
        </section>

        <section>
          <h3>Artifacts</h3>
          <div className="workflow-artifacts">
            {nodeArtifacts.length ? (
              nodeArtifacts.map(artifact => (
                <div className="workflow-artifact-row" key={artifact.id}>
                  <Codicon name="file-code" size="0.8125rem" />
                  <span title={artifact.path}>{artifact.name}</span>
                </div>
              ))
            ) : (
              <div className="workflow-muted">{copy.noArtifacts}</div>
            )}
          </div>
        </section>

        <section>
          <button
            className="workflow-collapsible-heading"
            onClick={() => setChangesOpen(value => !value)}
            type="button"
          >
            <h3>{copy.fileChangeReview}</h3>
            <span>{fileChanges.length}</span>
            <Codicon name={changesOpen ? 'chevron-down' : 'chevron-right'} size="0.8125rem" />
          </button>
          {changesOpen && (
            <div className="workflow-file-changes">
              {fileChanges.length ? (
                fileChanges.map(change => {
                  const changeKey = `${change.status}-${change.path}`
                  const canPreview = fileChangeCanPreview(change)
                  const previewOpen = openFilePreviews.has(changeKey)

                  const meta = [
                    change.status,
                    change.isArtifact ? 'artifact' : null,
                    change.truncated ? 'truncated' : null,
                    change.isBinary ? copy.binaryFile : null
                  ]
                    .filter(Boolean)
                    .join(' · ')

                  return (
                    <div className="workflow-file-change" key={changeKey}>
                      <div className="workflow-file-change__header">
                        <button
                          aria-expanded={canPreview ? previewOpen : undefined}
                          className="workflow-file-change__summary"
                          disabled={!canPreview}
                          onClick={() => canPreview && toggleFilePreview(changeKey)}
                          type="button"
                        >
                          <Codicon
                            name={canPreview ? (previewOpen ? 'chevron-down' : 'chevron-right') : 'circle-slash'}
                            size="0.8125rem"
                          />
                          <span>
                            <strong>{change.path}</strong>
                            <small>{meta}</small>
                          </span>
                        </button>
                        <div className="workflow-file-change__actions">
                          {canPreview && (
                            <Button
                              onClick={() => toggleFilePreview(changeKey)}
                              size="xs"
                              type="button"
                              variant="ghost"
                            >
                              {previewOpen ? copy.hidePreview : copy.preview}
                            </Button>
                          )}
                          <Button
                            onClick={() => onOpenFile(resolveProjectPath(root, change.path))}
                            size="xs"
                            type="button"
                            variant="outline"
                          >
                            <Codicon name="go-to-file" size="0.8125rem" />
                            {copy.open}
                          </Button>
                        </div>
                      </div>
                      {previewOpen && canPreview ? (
                        <pre>{change.diff || copy.noDiff}</pre>
                      ) : !canPreview ? (
                        <div className="workflow-file-change__notice">
                          {change.isBinary ? copy.binaryPreviewOmitted : copy.noTextPreviewAvailable}
                        </div>
                      ) : null}
                    </div>
                  )
                })
              ) : (
                <div className="workflow-muted">{copy.fileChangeReviewEmpty}</div>
              )}
            </div>
          )}
        </section>
      </div>

      <div className="workflow-node-actions">
        {decisionNode && waiting && failureTargets.length > 0 && (
          <div className="workflow-return-controls">
            {failureTargets.length > 1 ? (
              <Select onValueChange={setReturnTargetId} value={selectedFailureTarget?.node.id ?? ''}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder={copy.failureTarget} />
                </SelectTrigger>
                <SelectContent>
                  {failureTargets.map(item => (
                    <SelectItem key={item.node.id} value={item.node.id}>
                      {item.edge.label ? `${item.node.title} · ${item.edge.label}` : item.node.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span title={selectedFailureTarget?.node.id}>
                {copy.failureTarget}: {selectedFailureTarget?.node.title}
              </span>
            )}
          </div>
        )}
        <Button
          disabled={!waiting || !runId}
          onClick={() => runId && onNodeAction('pass', node.id, runId)}
          size="sm"
          type="button"
        >
          <Codicon name="pass" size="0.875rem" />
          {decisionNode ? copy.pass : copy.confirm}
        </Button>
        {decisionNode && (
          <Button
            disabled={!waiting || !runId || !selectedFailureTarget}
            onClick={() =>
              runId &&
              selectedFailureTarget &&
              onNodeAction('fail', node.id, runId, {
                reason: `${copy.fail}: ${selectedFailureTarget.node.title}`,
                targetNodeId: selectedFailureTarget.node.id
              })
            }
            size="sm"
            title={selectedFailureTarget ? undefined : copy.failureBranchNotConnected}
            type="button"
            variant="outline"
          >
            <Codicon name="error" size="0.875rem" />
            {copy.fail}
          </Button>
        )}
        <Button
          disabled={!runId}
          onClick={() => runId && onNodeAction('retry', node.id, runId)}
          size="sm"
          type="button"
          variant="outline"
        >
          <Codicon name="refresh" size="0.875rem" />
          {copy.retry}
        </Button>
        <Button
          disabled={!runId}
          onClick={() => runId && onNodeAction('skip', node.id, runId)}
          size="sm"
          type="button"
          variant="outline"
        >
          <Codicon name="debug-step-over" size="0.875rem" />
          {copy.skip}
        </Button>
      </div>
    </div>
  )
}

function ReferenceDrawer({
  onAddReferences,
  onToggleReference,
  references
}: {
  onAddReferences: (paths: string[]) => void
  onToggleReference: (reference: ReferenceItem, enabled: boolean) => void
  references: ReferenceItem[]
}) {
  const copy = useWorkflowCopy()

  return (
    <div className="workflow-reference-drawer">
      <div className="workflow-drawer-header">
        <div>
          <h2>{copy.references}</h2>
          <p>{copy.referenceContextHint}</p>
        </div>
        <Button
          onClick={() => {
            void window.hermesDesktop
              .selectPaths({ multiple: true, title: copy.chooseReference })
              .then(paths => paths.length && onAddReferences(paths))
          }}
          size="xs"
          type="button"
          variant="outline"
        >
          <Codicon name="add" size="0.8125rem" />
          {copy.add}
        </Button>
      </div>
      <div className="workflow-list">
        {references.length ? (
          references.map(reference => (
            <label className="workflow-toggle-row" key={reference.id}>
              <span>
                <strong>{reference.name}</strong>
                <small>{reference.path}</small>
              </span>
              <Switch checked={reference.enabled} onCheckedChange={enabled => onToggleReference(reference, enabled)} />
            </label>
          ))
        ) : (
          <div className="workflow-muted">{copy.noReferenceProject}</div>
        )}
      </div>
    </div>
  )
}

function SkillDrawer({
  onToggleSkill,
  skills
}: {
  onToggleSkill: (skill: SkillBinding, enabled: boolean) => void
  skills: SkillBinding[]
}) {
  const copy = useWorkflowCopy()

  return (
    <div>
      <div className="workflow-drawer-header">
        <div>
          <h2>{copy.skills}</h2>
          <p>{copy.skillProjectHint}</p>
        </div>
      </div>
      <div className="workflow-list">
        {skills.map(skill => (
          <label className="workflow-toggle-row" key={skill.id}>
            <span>
              <strong>{skill.name}</strong>
              <small>{skill.source}</small>
            </span>
            <Switch checked={skill.enabled} onCheckedChange={enabled => onToggleSkill(skill, enabled)} />
          </label>
        ))}
      </div>
    </div>
  )
}

function SnapshotDrawer({ onSnapshot, snapshots }: { onSnapshot: () => void; snapshots: VersionSnapshot[] }) {
  const copy = useWorkflowCopy()

  return (
    <div>
      <div className="workflow-drawer-header">
        <div>
          <h2>{copy.snapshots}</h2>
          <p>{copy.snapshotsHint}</p>
        </div>
        <Button onClick={onSnapshot} size="xs" type="button" variant="outline">
          <Codicon name="git-commit" size="0.8125rem" />
          {copy.snapshot}
        </Button>
      </div>
      <div className="workflow-snapshot-list">
        {snapshots.length ? (
          snapshots.map(snapshot => (
            <div className="workflow-snapshot-row" key={snapshot.id}>
              <Codicon name="git-commit" size="0.8125rem" />
              <span>
                <strong>{snapshot.label}</strong>
                <small>{formatDate(snapshot.createdAt)}</small>
              </span>
            </div>
          ))
        ) : (
          <div className="workflow-muted">{copy.noSnapshots}</div>
        )}
      </div>
    </div>
  )
}

function StreamOutputPanel({
  events,
  expanded,
  filterSelectedNode,
  onFilterSelectedNode,
  onToggleExpanded,
  selectedNode,
  wsHealthy
}: {
  events: StreamEvent[]
  expanded: boolean
  filterSelectedNode: boolean
  onFilterSelectedNode: (value: boolean) => void
  onToggleExpanded: () => void
  selectedNode: WorkflowNode | null
  wsHealthy: boolean
}) {
  const copy = useWorkflowCopy()
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const transcriptEndRef = useRef<HTMLDivElement | null>(null)

  const [height, setHeight] = useState(() => {
    const stored = Number(window.localStorage.getItem('hermes.workflow.streamHeight') || 260)

    return Number.isFinite(stored) ? Math.min(Math.max(stored, 160), Math.round(window.innerHeight * 0.6)) : 260
  })

  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true)
  const [showLatestButton, setShowLatestButton] = useState(false)

  const transcript = useMemo(() => streamTranscriptItems(events), [events])
  const latestTranscript = transcript.at(-1)
  const latestTranscriptKey = latestTranscript ? `${latestTranscript.id}:${latestTranscript.timestamp}` : ''

  useEffect(() => {
    window.localStorage.setItem('hermes.workflow.streamHeight', String(height))
  }, [height])

  useEffect(() => {
    if (expanded) {
      return
    }

    setIsPinnedToBottom(true)
    setShowLatestButton(false)
  }, [expanded])

  const scrollToLatest = useCallback((behavior: ScrollBehavior = 'smooth') => {
    setIsPinnedToBottom(true)
    setShowLatestButton(false)
    requestAnimationFrame(() => {
      transcriptEndRef.current?.scrollIntoView({ block: 'end', behavior })
    })
  }, [])

  const handleTranscriptScroll = useCallback(() => {
    const transcriptElement = transcriptRef.current

    if (!transcriptElement) {
      return
    }

    const pinned = streamIsNearBottom(transcriptElement)
    setIsPinnedToBottom(pinned)
    setShowLatestButton(!pinned && transcript.length > 0)
  }, [transcript.length])

  useEffect(() => {
    if (!expanded) {
      return
    }

    if (isPinnedToBottom) {
      scrollToLatest('auto')
    } else if (transcript.length) {
      setShowLatestButton(true)
    }
  }, [expanded, isPinnedToBottom, latestTranscriptKey, scrollToLatest, transcript.length])

  const beginResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      const startY = event.clientY
      const startHeight = height
      const maxHeight = Math.round(window.innerHeight * 0.6)

      const onMove = (moveEvent: PointerEvent) => {
        const next = startHeight + startY - moveEvent.clientY
        setHeight(Math.min(Math.max(next, 160), maxHeight))
      }

      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [height]
  )

  return (
    <section
      aria-label="Stream output panel"
      className={cn('workflow-stream-panel', expanded && 'is-expanded')}
      style={expanded ? { height } : undefined}
    >
      {expanded && <div className="workflow-stream-resizer" onPointerDown={beginResize} />}
      <div className="workflow-stream-panel__header">
        <button onClick={onToggleExpanded} type="button">
          <Codicon name={expanded ? 'chevron-down' : 'chevron-up'} size="0.875rem" />
          {copy.streamOutput}
        </button>
        <div className="workflow-stream-panel__tools">
          <span className={cn('workflow-ws-dot', wsHealthy && 'is-live')} />
          <span>{wsHealthy ? 'WS live' : 'polling'}</span>
          <label>
            <Switch checked={filterSelectedNode} disabled={!selectedNode} onCheckedChange={onFilterSelectedNode} />
            {copy.streamContextCurrentNode}
          </label>
        </div>
      </div>
      {expanded && (
        <div className="workflow-stream-transcript" onScroll={handleTranscriptScroll} ref={transcriptRef}>
          {transcript.length ? (
            transcript.map(item =>
              item.kind === 'assistant' ? (
                <div className="workflow-transcript-message" data-slot="aui_assistant-message-root" key={item.id}>
                  <div className="workflow-transcript-header">
                    <Codicon name="sparkle" size="0.875rem" />
                    <strong>{item.label}</strong>
                    <span>{formatTime(item.timestamp)}</span>
                  </div>
                  <div data-slot="aui_assistant-message-content">
                    <CompactMarkdown className="workflow-transcript-markdown" text={item.text || '...'} />
                  </div>
                </div>
              ) : (
                <div className={cn('workflow-stream-compact-event', `status-${item.status}`)} key={item.id}>
                  <Codicon name={EVENT_ICON[item.type]} size="0.8125rem" />
                  <strong>{item.label}</strong>
                  <span>{item.text}</span>
                  <time>{formatTime(item.timestamp)}</time>
                </div>
              )
            )
          ) : (
            <div className="workflow-muted">{copy.runSummaryEmpty}</div>
          )}
          <div aria-hidden className="workflow-stream-transcript__end" ref={transcriptEndRef} />
        </div>
      )}
      {expanded && showLatestButton && (
        <Button
          className="workflow-latest-messages"
          onClick={() => scrollToLatest()}
          size="xs"
          type="button"
          variant="outline"
        >
          <Codicon name="arrow-down" size="0.8125rem" />
          {copy.latestMessages}
        </Button>
      )}
    </section>
  )
}

function WorkflowChatBox({
  disabled,
  onAttach,
  onSlash,
  onSubmit,
  projectId,
  projectRoot,
  selectedNode
}: {
  disabled: boolean
  onAttach: (paths: string[]) => Promise<void>
  onSlash: (command: string) => void
  onSubmit: (text: string, attachments: string[]) => void
  projectId: null | string
  projectRoot?: string
  selectedNode: WorkflowNode | null
}) {
  const copy = useWorkflowCopy()
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<string[]>([])
  const [completions, setCompletions] = useState<WorkflowComposerCompletionItem[]>([])

  useEffect(() => {
    if (!projectId || disabled) {
      setCompletions([])

      return
    }

    const cursor = text.length
    const prefix = text.slice(0, cursor)
    const wantsCompletion = /\/[\w-]*$/.test(prefix) || /@file:[^\s`]*$/.test(prefix)

    if (!wantsCompletion) {
      setCompletions([])

      return
    }

    const handle = window.setTimeout(() => {
      void completeWorkflowComposer(projectId, { cursor, cwd: projectRoot, text })
        .then(result => setCompletions(result.items))
        .catch(() => setCompletions([]))
    }, 160)

    return () => window.clearTimeout(handle)
  }, [disabled, projectId, projectRoot, text])

  const submit = useCallback(() => {
    const trimmed = text.trim()

    if (!trimmed && attachments.length === 0) {
      return
    }

    if (/^\/\S+/.test(trimmed) && attachments.length === 0) {
      onSlash(trimmed)
    } else {
      onSubmit(trimmed, attachments)
    }

    setText('')
    setAttachments([])
    setCompletions([])
  }, [attachments, onSlash, onSubmit, text])

  const insertCompletion = useCallback((item: WorkflowComposerCompletionItem) => {
    setText(current => {
      if (item.type === 'slash') {
        return current.replace(/\/[\w-]*$/, `${item.text} `)
      }

      return current.replace(/@file:[^\s`]*$/, `${item.text} `)
    })
    setCompletions([])
  }, [])

  return (
    <form
      className="workflow-chat-box"
      onSubmit={event => {
        event.preventDefault()
        submit()
      }}
    >
      <div className="workflow-chat-box__context">
        <Codicon name="target" size="0.8125rem" />
        {selectedNode ? `${copy.currentNodePrefix}${selectedNode.title}` : copy.contextGlobal}
      </div>
      {attachments.length > 0 && (
        <div className="workflow-chat-box__attachments">
          {attachments.map(path => (
            <button
              key={path}
              onClick={() => setAttachments(current => current.filter(item => item !== path))}
              title={path}
              type="button"
            >
              <Codicon name="file" size="0.75rem" />
              <span>{fileName(path)}</span>
              <Codicon name="close" size="0.7rem" />
            </button>
          ))}
        </div>
      )}
      <Textarea
        disabled={disabled}
        onChange={event => setText(event.target.value)}
        onKeyDown={event => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.currentTarget.form?.requestSubmit()
          }
        }}
        placeholder={copy.workflowChatPlaceholder}
        value={text}
      />
      {completions.length > 0 && (
        <div className="workflow-completion-popover">
          {completions.slice(0, 8).map(item => (
            <button
              key={`${item.type}-${item.text}`}
              onClick={() => insertCompletion(item)}
              onMouseDown={event => event.preventDefault()}
              type="button"
            >
              <Codicon name={item.type === 'slash' ? 'terminal' : 'file'} size="0.75rem" />
              <span>{item.label}</span>
              {item.detail && <small>{item.detail}</small>}
            </button>
          ))}
        </div>
      )}
      <Button
        disabled={disabled || !projectId}
        onClick={() => {
          void window.hermesDesktop
            .selectPaths({ multiple: true, title: copy.chooseWorkflowAttachment })
            .then(async paths => {
              if (!paths.length) {
                return
              }

              await onAttach(paths)
              setAttachments(current => [...new Set([...current, ...paths])])
            })
        }}
        size="icon-sm"
        title={copy.addAttachments}
        type="button"
        variant="outline"
      >
        <Codicon name="attach" size="0.875rem" />
      </Button>
      <Button disabled={disabled || (!text.trim() && attachments.length === 0)} size="icon-sm" type="submit">
        <Codicon name="send" size="0.875rem" />
      </Button>
    </form>
  )
}

function WorkflowIntakePage({ onComplete }: { onComplete: (bundle: ProjectBundle) => void | Promise<void> }) {
  const copy = useWorkflowCopy()
  const [name, setName] = useState<string>(copy.workflowProjectDefaultName)
  const [goal, setGoal] = useState('')
  const [root, setRoot] = useState('')
  const [references, setReferences] = useState<WorkflowIntakeReference[]>([])
  const [intakeId, setIntakeId] = useState<string | null>(null)
  const [messages, setMessages] = useState<WorkflowIntakeMessage[]>([])
  const [intakeError, setIntakeError] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [phase, setPhase] = useState<WorkflowIntakeResponse['phase']>('idle')
  const [draftMarkdown, setDraftMarkdown] = useState('')
  const [draftWorkflow, setDraftWorkflow] = useState<Workflow | null>(null)
  const [currentBatch, setCurrentBatch] = useState<WorkflowIntakeBatch | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewNodeId, setPreviewNodeId] = useState<string | null>(null)
  const referencePaths = useMemo(() => references.map(reference => reference.path), [references])

  const payload = useMemo<WorkflowIntakePayload>(
    () => ({ goal, name, references: referencePaths, root: root || undefined }),
    [goal, name, referencePaths, root]
  )

  const applyIntakeResponse = useCallback((response: WorkflowIntakeResponse) => {
    setIntakeId(response.intakeId)
    setMessages(response.messages)
    setIntakeError(response.error ?? null)
    setPhase(response.phase ?? (response.canConfirm || response.ready ? 'draft_ready' : 'clarifying'))
    setDraftMarkdown(response.draftMarkdown ?? response.summary ?? '')
    setDraftWorkflow(response.draftWorkflow ?? null)
    setCurrentBatch(response.currentBatch ?? null)
    if (response.draftWorkflow?.nodes.length) {
      setPreviewNodeId(response.draftWorkflow.nodes[0].id)
    }
  }, [])

  const startMutation = useMutation({
    mutationFn: () => startWorkflowIntake(payload),
    onSuccess: data => {
      setReply('')
      applyIntakeResponse(data)
    }
  })

  const messageMutation = useMutation({
    mutationFn: (message: string) => sendWorkflowIntakeMessage(intakeId!, message),
    onSuccess: data => {
      setReply('')
      applyIntakeResponse(data)
    }
  })

  const answersMutation = useMutation({
    mutationFn: (answers: WorkflowIntakeAnswer[]) => submitWorkflowIntakeAnswers(intakeId!, answers),
    onSuccess: data => {
      setReply('')
      applyIntakeResponse(data)
    }
  })

  const confirmMutation = useMutation({
    mutationFn: () => confirmWorkflowIntake(intakeId!, payload),
    onSuccess: data => void onComplete(data)
  })

  const busy = startMutation.isPending || messageMutation.isPending || answersMutation.isPending || confirmMutation.isPending

  const error =
    errorText(startMutation.error || messageMutation.error || answersMutation.error || confirmMutation.error) || intakeError
  const draftReady = Boolean(draftWorkflow && (phase === 'draft_ready' || draftMarkdown))
  const activeBatch = Boolean(currentBatch?.questions.length && !draftReady)
  const draftMessageIndex = useMemo(() => {
    if (!draftReady) {
      return -1
    }

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === 'assistant') {
        return index
      }
    }

    return -1
  }, [draftReady, messages])

  const submitPlanningMessage = () => {
    if (!intakeId) {
      if (!goal.trim()) {
        return
      }

      startMutation.mutate()
      return
    }

    if (!reply.trim()) {
      return
    }

    messageMutation.mutate(reply)
  }

  const addReferences = (kind: WorkflowIntakeReference['kind'], paths: string[]) => {
    if (!paths.length) {
      return
    }

    setReferences(current => {
      const byPath = new Map(current.map(reference => [reference.path, reference]))

      for (const path of paths) {
        byPath.set(path, { kind, path })
      }

      return Array.from(byPath.values())
    })
  }

  const chooseReferences = (kind: WorkflowIntakeReference['kind']) => {
    void window.hermesDesktop
      .selectPaths({
        directories: kind === 'folder',
        multiple: true,
        title: kind === 'folder' ? copy.chooseReferenceFolder : copy.chooseReference
      })
      .then(paths => addReferences(kind, paths))
  }

  const removeReference = (path: string) => {
    setReferences(current => current.filter(item => item.path !== path))
  }

  const composerValue = intakeId ? reply : goal
  const composerPlaceholder = intakeId ? copy.revisionDetailsPlaceholder : copy.taskPlaceholder
  const canSubmitComposer =
    !busy && !activeBatch && (intakeId ? Boolean(reply.trim()) : Boolean(goal.trim() && name.trim()))

  return (
    <main className="workflow-intake-page workflow-intake-page--simple">
      <Backdrop />
      <section aria-label="Workflow intake" className="workflow-intake-simple">
        <div className="workflow-intake-chat workflow-intake-chat--simple">
          <div className={cn('workflow-intake-transcript', !messages.length && !busy && 'is-empty')}>
            {messages.length ? (
              messages.map((message, index) => (
                <div
                  className={cn('workflow-intake-message', message.role === 'user' && 'is-user')}
                  key={`${message.timestamp}-${index}`}
                >
                  <span>{message.role === 'user' ? copy.you : 'Hermes'}</span>
                  <CompactMarkdown className="workflow-intake-message-markdown" text={message.content || '...'} />
                  {index === draftMessageIndex && draftWorkflow && (
                    <Button
                      className="workflow-intake-message__preview"
                      onClick={() => setPreviewOpen(true)}
                      size="xs"
                      type="button"
                      variant="outline"
                    >
                      <Codicon name="preview" size="0.75rem" />
                      {copy.previewWorkflowDraft}
                    </Button>
                  )}
                </div>
              ))
            ) : (
              <div className="workflow-intake-empty">
                <WordmarkIntro body={copy.workflowIntakeSubtitle} wordmark="HERMES WORKFLOW" />
              </div>
            )}
            {currentBatch?.questions.length ? (
              <WorkflowClarificationPanel
                batch={currentBatch}
                busy={busy}
                onSubmit={answers => answersMutation.mutate(answers)}
              />
            ) : null}
            {busy && (
              <div className="workflow-intake-message">
                <span>Hermes</span>
                <div className="workflow-intake-message-markdown">
                  <Codicon name="loading" size="0.8125rem" spinning />
                  {confirmMutation.isPending ? copy.initializingWorkflow : copy.planningWithHermes}
                </div>
              </div>
            )}
          </div>

          {error && <div className="workflow-error workflow-intake-error">{error}</div>}

          <div className="workflow-intake-bottom">
            <div className={cn(COMPOSER_ROOT_FRAME_CLASS, 'workflow-intake-config-frame')}>
              <ComposerSurface>
                <div aria-label={copy.projectConfig} className="workflow-intake-config workflow-intake-config--simple">
                  <label className="workflow-intake-field">
                    {copy.projectName}
                    <Input
                      className="workflow-intake-control"
                      disabled={busy && Boolean(intakeId)}
                      onChange={event => setName(event.target.value)}
                      value={name}
                    />
                  </label>

                  <label className="workflow-intake-field">
                    {copy.projectDirectory}
                    <div className="workflow-path-picker workflow-path-picker--intake">
                      <Input
                        className="workflow-intake-control"
                        disabled={busy && Boolean(intakeId)}
                        onChange={event => setRoot(event.target.value)}
                        placeholder={copy.projectDirectoryPlaceholder}
                        value={root}
                      />
                      <Button
                        className="workflow-intake-submit workflow-intake-open-button"
                        disabled={busy && Boolean(intakeId)}
                        onClick={() => {
                          void window.hermesDesktop
                            .selectPaths({ directories: true, title: copy.chooseWorkflowProjectDirectory })
                            .then(paths => paths[0] && setRoot(paths[0]))
                        }}
                        type="button"
                      >
                        {copy.open}
                      </Button>
                    </div>
                  </label>
                </div>
              </ComposerSurface>
            </div>

            <form
              className={cn(COMPOSER_ROOT_FRAME_CLASS, 'workflow-intake-composer')}
              onSubmit={event => {
                event.preventDefault()
                submitPlanningMessage()
              }}
            >
              <ComposerSurface>
                {references.length > 0 && (
                  <div className="workflow-intake-reference-tags" aria-label={copy.projectReferences}>
                    {references.map(reference => (
                      <span key={reference.path} title={reference.path}>
                        <Codicon name={reference.kind === 'folder' ? 'folder' : 'file'} size="0.75rem" />
                        <span>{fileName(reference.path)}</span>
                        <button
                          aria-label={copy.removeReference}
                          disabled={busy && Boolean(intakeId)}
                          onClick={() => removeReference(reference.path)}
                          type="button"
                        >
                          <Codicon name="close" size="0.6875rem" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {draftReady && (
                  <div className="workflow-intake-decision">
                    <Button disabled={busy || !intakeId} onClick={() => confirmMutation.mutate()} type="button">
                      <Codicon
                        name={confirmMutation.isPending ? 'loading' : 'check'}
                        size="0.875rem"
                        spinning={confirmMutation.isPending}
                      />
                      {copy.initializeWorkflow}
                    </Button>
                    <span>{copy.reviseWorkflowHint}</span>
                  </div>
                )}
                <div className="workflow-intake-composer__row">
                  <div className="workflow-intake-composer__menu">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          className="workflow-intake-reference-trigger"
                          disabled={busy && Boolean(intakeId)}
                          type="button"
                          variant="ghost"
                        >
                          <Codicon name="add" size="0.875rem" />
                          <span>{copy.projectReferences}</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-56" side="top" sideOffset={10}>
                        <DropdownMenuLabel className="text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground/85">
                          {copy.projectReferences}
                        </DropdownMenuLabel>
                        <DropdownMenuItem onSelect={() => chooseReferences('file')}>
                          <Codicon name="file" size="0.875rem" />
                          <span>{copy.addReferenceFiles}</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => chooseReferences('folder')}>
                          <Codicon name="folder" size="0.875rem" />
                          <span>{copy.addReferenceFolder}</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="workflow-intake-composer__input">
                    <ComposerRichInput
                      ariaLabel={copy.taskPlaceholder}
                      disabled={busy}
                      onChange={value => {
                        if (intakeId) {
                          setReply(value)
                        } else {
                          setGoal(value)
                        }
                      }}
                      onSubmit={submitPlanningMessage}
                      placeholder={composerPlaceholder}
                      value={composerValue}
                    />
                  </div>
                  <div className="workflow-intake-composer__controls">
                    <Button className="workflow-intake-submit" disabled={!canSubmitComposer} type="submit">
                      <Codicon
                        name={busy ? 'loading' : intakeId ? 'send' : 'sparkle'}
                        size="0.875rem"
                        spinning={busy}
                      />
                      {intakeId ? copy.sendPlanningMessage : copy.startPlanning}
                    </Button>
                  </div>
                </div>
              </ComposerSurface>
            </form>
          </div>
        </div>
      </section>
      <WorkflowDraftPreviewDialog
        onOpenChange={setPreviewOpen}
        onSelectNode={setPreviewNodeId}
        open={previewOpen}
        selectedNodeId={previewNodeId}
        workflow={draftWorkflow}
      />
    </main>
  )
}

function WorkflowClarificationPanel({
  batch,
  busy,
  onSubmit
}: {
  batch: WorkflowIntakeBatch
  busy: boolean
  onSubmit: (answers: WorkflowIntakeAnswer[]) => void
}) {
  const copy = useWorkflowCopy()
  const questions = batch.questions
  const [questionIndex, setQuestionIndex] = useState(0)
  const [draftAnswers, setDraftAnswers] = useState<Record<string, WorkflowIntakeAnswer>>({})
  const [confirmedAnswers, setConfirmedAnswers] = useState<Record<string, WorkflowIntakeAnswer>>({})
  const [touchedQuestions, setTouchedQuestions] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setQuestionIndex(0)
    setDraftAnswers({})
    setConfirmedAnswers({})
    setTouchedQuestions({})
  }, [batch.id])

  const currentQuestion = questions[questionIndex] ?? questions[0]
  if (!currentQuestion) {
    return null
  }

  const currentDraft = draftAnswers[currentQuestion.id]
  const currentConfirmed = confirmedAnswers[currentQuestion.id]
  const answeredCount = questions.filter(question => confirmedAnswers[question.id]).length
  const allAnswered = questions.every(question => confirmedAnswers[question.id])
  const customValue = currentDraft?.custom ? currentDraft.answer : ''

  const setDraftAnswer = (answer: WorkflowIntakeAnswer | null) => {
    setDraftAnswers(current => {
      const next = { ...current }
      if (answer) {
        next[currentQuestion.id] = answer
      } else {
        delete next[currentQuestion.id]
      }
      return next
    })
    setConfirmedAnswers(current => {
      if (!current[currentQuestion.id]) {
        return current
      }
      const next = { ...current }
      delete next[currentQuestion.id]
      return next
    })
  }

  const confirmCurrentAnswer = () => {
    const answer = draftAnswers[currentQuestion.id]
    if (!answer?.answer.trim()) {
      setTouchedQuestions(current => ({ ...current, [currentQuestion.id]: true }))
      return
    }

    setConfirmedAnswers(current => ({ ...current, [currentQuestion.id]: answer }))
    setTouchedQuestions(current => ({ ...current, [currentQuestion.id]: false }))
    if (questionIndex < questions.length - 1) {
      setQuestionIndex(questionIndex + 1)
    }
  }

  const submitAnswers = () => {
    if (!allAnswered || busy) {
      return
    }

    onSubmit(
      questions
        .map(question => confirmedAnswers[question.id])
        .filter((answer): answer is WorkflowIntakeAnswer => Boolean(answer))
    )
  }

  return (
    <div className="workflow-clarification-card">
      <div className="workflow-clarification-card__header">
        <div>
          <strong>{copy.clarificationQuestions}</strong>
          <span>
            {questionIndex + 1}/{questions.length}
          </span>
        </div>
        <div className="workflow-clarification-card__nav">
          <Button
            disabled={busy || questionIndex === 0}
            onClick={() => setQuestionIndex(Math.max(0, questionIndex - 1))}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Codicon name="chevron-left" size="0.75rem" />
          </Button>
          <Button
            disabled={busy || questionIndex >= questions.length - 1}
            onClick={() => setQuestionIndex(Math.min(questions.length - 1, questionIndex + 1))}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Codicon name="chevron-right" size="0.75rem" />
          </Button>
        </div>
      </div>

      <div className="workflow-clarification-question">
        <span className="workflow-clarification-question__eyebrow">
          {copy.question} {questionIndex + 1}
        </span>
        <h3>{currentQuestion.question}</h3>
        {currentQuestion.detail && <p>{currentQuestion.detail}</p>}
      </div>

      <div className="workflow-clarification-options">
        {currentQuestion.options.map(option => (
          <button
            className={cn(
              'workflow-clarification-option',
              currentDraft?.optionId === option.id && !currentDraft.custom && 'is-selected'
            )}
            disabled={busy}
            key={option.id}
            onClick={() =>
              setDraftAnswer({
                questionId: currentQuestion.id,
                optionId: option.id,
                answer: option.label,
                custom: false
              })
            }
            type="button"
          >
            <span>
              {copy.priorityOption} {option.priority}
            </span>
            <strong>{option.label}</strong>
            {option.description && <small>{option.description}</small>}
          </button>
        ))}
      </div>

      <label className="workflow-clarification-custom">
        {copy.customAnswer}
        <Textarea
          disabled={busy}
          onChange={event => {
            const value = event.target.value
            setDraftAnswer(
              value.trim()
                ? {
                    questionId: currentQuestion.id,
                    optionId: null,
                    answer: value,
                    custom: true
                  }
                : null
            )
          }}
          placeholder={copy.typeCustomAnswer}
          value={customValue}
        />
      </label>

      {touchedQuestions[currentQuestion.id] && !currentDraft?.answer.trim() && (
        <div className="workflow-clarification-error">{copy.answerRequired}</div>
      )}

      <div className="workflow-clarification-footer">
        <span>
          {answeredCount}/{questions.length} {allAnswered ? copy.allQuestionsAnswered : copy.answeredQuestions}
          {currentConfirmed ? ` · ${copy.answerConfirmed}` : ''}
        </span>
        <div className="workflow-clarification-footer__actions">
          <Button disabled={busy || !currentDraft?.answer.trim()} onClick={confirmCurrentAnswer} type="button">
            <Codicon name="check" size="0.8125rem" />
            {copy.confirmAnswer}
          </Button>
          <Button disabled={busy || !allAnswered} onClick={submitAnswers} type="button" variant="outline">
            <Codicon name={busy ? 'loading' : 'send'} size="0.8125rem" spinning={busy} />
            {copy.submitAnswers}
          </Button>
        </div>
      </div>
    </div>
  )
}

function WorkflowDraftPreviewDialog({
  onOpenChange,
  onSelectNode,
  open,
  selectedNodeId,
  workflow
}: {
  onOpenChange: (open: boolean) => void
  onSelectNode: (nodeId: string) => void
  open: boolean
  selectedNodeId: string | null
  workflow: Workflow | null
}) {
  const copy = useWorkflowCopy()
  const { resolvedMode } = useTheme()
  const displayWorkflow = useMemo(() => (workflow ? workflowWithDisplayLayout(workflow) : null), [workflow])
  const initialNodes = useMemo(() => (displayWorkflow ? toFlowNodes(displayWorkflow) : []), [displayWorkflow])
  const [previewNodes, setPreviewNodes, onPreviewNodesChange] = useNodesState<FlowNode>(initialNodes)
  const edges = useMemo(() => (displayWorkflow ? toFlowEdges(displayWorkflow, copy) : []), [copy, displayWorkflow])
  const selectedNode = useMemo(
    () => displayWorkflow?.nodes.find(node => node.id === selectedNodeId) ?? displayWorkflow?.nodes[0] ?? null,
    [displayWorkflow, selectedNodeId]
  )

  useEffect(() => {
    setPreviewNodes(initialNodes)
  }, [initialNodes, setPreviewNodes])

  useEffect(() => {
    setPreviewNodes(nodes =>
      nodes.map(node => ({
        ...node,
        selected: node.id === selectedNodeId
      }))
    )
  }, [selectedNodeId, setPreviewNodes])

  if (!displayWorkflow) {
    return null
  }

  const outgoing = selectedNode
    ? displayWorkflow.edges
        .filter(edge => edge.source === selectedNode.id)
        .map(edge => ({
          edge,
          target: displayWorkflow.nodes.find(node => node.id === edge.target)
        }))
    : []

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="workflow-draft-preview-dialog">
        <DialogHeader className="workflow-draft-preview-dialog__header">
          <DialogTitle>{copy.workflowDraftPreviewTitle}</DialogTitle>
          <DialogDescription>{copy.workflowDraftPreviewDescription}</DialogDescription>
        </DialogHeader>
        <div className="workflow-center workflow-draft-preview">
          <div className="workflow-draft-preview__canvas">
            <ReactFlow
              className="workflow-flow workflow-flow--preview"
              colorMode={resolvedMode}
              connectOnClick={false}
              edges={edges}
              elementsSelectable
              fitView
              maxZoom={1.4}
              minZoom={0.35}
              nodes={previewNodes}
              nodesConnectable={false}
              nodesDraggable
              nodeTypes={nodeTypes}
              onNodeClick={(_event, node) => onSelectNode(node.id)}
              onNodesChange={onPreviewNodesChange}
              panOnDrag
              proOptions={{ hideAttribution: true }}
              fitViewOptions={{ padding: 0.18 }}
            >
              <Background color="var(--workflow-canvas-dot)" gap={24} size={1} />
              <Controls className="workflow-controls" showInteractive={false} />
            </ReactFlow>
          </div>
          <aside className="workflow-draft-preview__detail">
            {selectedNode ? (
              <>
                <div className="workflow-drawer-header">
                  <div>
                    <h2>{selectedNode.title}</h2>
                    <p>{selectedNode.id}</p>
                  </div>
                  <span className="workflow-status-pill tone-info">
                    {copy.nodeType[selectedNode.type as keyof typeof copy.nodeType] ?? selectedNode.type}
                  </span>
                </div>
                <section>
                  <h3>{copy.editExecutionPrompt}</h3>
                  <p>{selectedNode.description || copy.noTextPreviewAvailable}</p>
                </section>
                <section>
                  <h3>{copy.skills}</h3>
                  <p>{selectedNode.skills.length ? selectedNode.skills.join(' / ') : copy.noSkill}</p>
                </section>
                <section>
                  <h3>{copy.reviewRules}</h3>
                  {selectedNode.reviewRules.checklist.length ? (
                    <ul>
                      {selectedNode.reviewRules.checklist.map(item => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>{copy.noExplicitReviewRules}</p>
                  )}
                </section>
                <section>
                  <h3>{copy.workflowDraftEdges}</h3>
                  {outgoing.length ? (
                    <ul>
                      {outgoing.map(({ edge, target }) => (
                        <li key={edge.id}>
                          <strong>{edgeSourceHandle(edge) === 'failure' ? copy.failureOutput : copy.successOutput}</strong>
                          <span>{target?.title ?? edge.target}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>{copy.noDraftOutgoingEdges}</p>
                  )}
                </section>
              </>
            ) : (
              <div className="workflow-drawer-empty">
                <Codicon name="graph" size="1.25rem" />
                <span>{copy.drawerEmptyNode}</span>
              </div>
            )}
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function WorkbenchLoading() {
  const copy = useWorkflowCopy()

  return (
    <div className="workflow-empty">
      <Codicon name="loading" size="1.5rem" spinning />
      <span>{copy.loadingWorkbench}</span>
    </div>
  )
}

function EmptyWorkbench({
  busy = false,
  hasProject = false,
  onAddReference,
  onCreate,
  onGenerate
}: {
  busy?: boolean
  hasProject?: boolean
  onAddReference?: () => void
  onCreate: () => void
  onGenerate?: () => void
}) {
  const copy = useWorkflowCopy()

  if (hasProject) {
    return (
      <div className="workflow-empty">
        <Codicon name={busy ? 'loading' : 'graph'} size="1.5rem" spinning={busy} />
        <span>{busy ? copy.agentGeneratingWorkflow : copy.canvasEmpty}</span>
        <div className="workflow-empty__actions">
          <Button disabled={busy} onClick={onGenerate} type="button">
            <Codicon name={busy ? 'loading' : 'sparkle'} size="0.875rem" spinning={busy} />
            {copy.workflowGenerationEmptyAction}
          </Button>
          <Button disabled={busy} onClick={onAddReference} type="button" variant="outline">
            <Codicon name="references" size="0.875rem" />
            {copy.workflowGenerationReferencesAction}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="workflow-empty">
      <Codicon name="graph" size="1.5rem" />
      <span>{copy.workflowStartHint}</span>
      <Button onClick={onCreate} type="button">
        {copy.newWorkflowProject}
      </Button>
    </div>
  )
}

function workflowPositionIsFinite(node: WorkflowNode): boolean {
  return Number.isFinite(node.position?.x) && Number.isFinite(node.position?.y)
}

function workflowNeedsDisplayLayout(workflow: Workflow): boolean {
  if (!workflow.nodes.length) {
    return false
  }

  if (workflow.nodes.some(node => !workflowPositionIsFinite(node))) {
    return true
  }

  if (workflow.nodes.length === 1) {
    return false
  }

  const positions = workflow.nodes.map(node => node.position)
  const allNearOrigin = positions.every(position => Math.abs(position.x) < 8 && Math.abs(position.y) < 8)

  if (allNearOrigin) {
    return true
  }

  const xs = positions.map(position => position.x)
  const ys = positions.map(position => position.y)
  const xSpan = Math.max(...xs) - Math.min(...xs)
  const ySpan = Math.max(...ys) - Math.min(...ys)
  const tooLongForInitialFit =
    workflow.nodes.length > WORKFLOW_LAYOUT_MAX_COLUMNS + 1 &&
    xSpan > WORKFLOW_LAYOUT_COLUMN_GAP * WORKFLOW_LAYOUT_MAX_COLUMNS &&
    ySpan < WORKFLOW_LAYOUT_BAND_GAP

  if (tooLongForInitialFit) {
    return true
  }

  for (let outer = 0; outer < positions.length; outer += 1) {
    for (let inner = outer + 1; inner < positions.length; inner += 1) {
      const dx = Math.abs(positions[outer].x - positions[inner].x)
      const dy = Math.abs(positions[outer].y - positions[inner].y)

      if (dx < WORKFLOW_NODE_WIDTH * 0.92 && dy < WORKFLOW_NODE_HEIGHT * 0.9) {
        return true
      }
    }
  }

  return false
}

function workflowWithDisplayLayout(workflow: Workflow): Workflow {
  if (!workflowNeedsDisplayLayout(workflow)) {
    return workflow
  }

  const nodeIds = new Set(workflow.nodes.map(node => node.id))
  const originalIndex = new Map(workflow.nodes.map((node, index) => [node.id, index]))
  const incomingSuccessCount = new Map(workflow.nodes.map(node => [node.id, 0]))
  const successEdges = workflow.edges.filter(edge => {
    const valid = nodeIds.has(edge.source) && nodeIds.has(edge.target)

    return valid && edgeSourceHandle(edge) === 'success'
  })

  for (const edge of successEdges) {
    incomingSuccessCount.set(edge.target, (incomingSuccessCount.get(edge.target) ?? 0) + 1)
  }

  const roots = workflow.nodes
    .filter(node => (incomingSuccessCount.get(node.id) ?? 0) === 0)
    .map(node => node.id)
  const depthById = new Map<string, number>()

  const rootIds = roots.length ? roots : workflow.nodes[0] ? [workflow.nodes[0].id] : []

  for (const id of rootIds) {
    depthById.set(id, 0)
  }

  for (let pass = 0; pass < workflow.nodes.length; pass += 1) {
    let changed = false

    for (const edge of successEdges) {
      const sourceDepth = depthById.get(edge.source)

      if (sourceDepth === undefined) {
        continue
      }

      const nextDepth = sourceDepth + 1
      const currentDepth = depthById.get(edge.target)

      if (currentDepth === undefined || nextDepth > currentDepth) {
        depthById.set(edge.target, nextDepth)
        changed = true
      }
    }

    if (!changed) {
      break
    }
  }

  for (const node of workflow.nodes) {
    if (!depthById.has(node.id)) {
      depthById.set(node.id, originalIndex.get(node.id) ?? 0)
    }
  }

  const maxDepth = Math.max(...[...depthById.values()])
  const columnsPerBand = Math.max(1, Math.min(WORKFLOW_LAYOUT_MAX_COLUMNS, maxDepth + 1))
  const groups = new Map<number, WorkflowNode[]>()

  for (const node of workflow.nodes) {
    const depth = depthById.get(node.id) ?? 0
    const group = groups.get(depth) ?? []
    group.push(node)
    groups.set(depth, group)
  }

  const positionById = new Map<string, { x: number; y: number }>()

  for (const [depth, nodes] of groups.entries()) {
    const band = Math.floor(depth / columnsPerBand)
    const column = depth % columnsPerBand
    const sortedNodes = [...nodes].sort((a, b) => {
      const ay = workflowPositionIsFinite(a) ? a.position.y : 0
      const by = workflowPositionIsFinite(b) ? b.position.y : 0

      if (Math.abs(ay - by) > 1) {
        return ay - by
      }

      return (originalIndex.get(a.id) ?? 0) - (originalIndex.get(b.id) ?? 0)
    })
    const yStart = band * WORKFLOW_LAYOUT_BAND_GAP - ((sortedNodes.length - 1) * WORKFLOW_LAYOUT_ROW_GAP) / 2

    sortedNodes.forEach((node, index) => {
      positionById.set(node.id, {
        x: column * WORKFLOW_LAYOUT_COLUMN_GAP,
        y: yStart + index * WORKFLOW_LAYOUT_ROW_GAP
      })
    })
  }

  return {
    ...workflow,
    nodes: workflow.nodes.map(node => ({
      ...node,
      position: positionById.get(node.id) ?? node.position
    }))
  }
}

function toFlowNodes(workflow: Workflow): FlowNode[] {
  return workflow.nodes.map(node => ({
    id: node.id,
    type: 'workflow',
    position: node.position,
    width: WORKFLOW_NODE_WIDTH,
    height: WORKFLOW_NODE_HEIGHT,
    data: { decisionNode: workflowNodeIsDecisionNode(workflow, node), node }
  }))
}

function toFlowEdges(workflow: Workflow, copy: WorkflowCopy): FlowEdge[] {
  const nodeTitles = new Map(workflow.nodes.map(node => [node.id, node.title]))

  return workflow.edges.map(edge => {
    const sourceHandle = edgeSourceHandle(edge)
    const failure = sourceHandle === 'failure'

    return {
      id: edge.id,
      source: edge.source,
      sourceHandle,
      target: edge.target,
      targetHandle: edge.targetHandle ?? 'input',
      label: edge.label || (failure ? copy.failTo(nodeTitles.get(edge.target) ?? edge.target) : undefined),
      type: failure ? 'smoothstep' : 'default',
      animated: failure,
      markerEnd: failure ? undefined : { type: MarkerType.ArrowClosed },
      style: failure
        ? { stroke: 'var(--workflow-edge-feedback)', strokeDasharray: '6 5', strokeWidth: 1.8 }
        : { stroke: 'var(--workflow-edge)', strokeWidth: 1.6 },
      data: { kind: failure ? 'failure' : 'success' }
    }
  })
}

function workflowWithPositions(workflow: Workflow, nodes: FlowNode[]): Workflow {
  const byId = new Map(nodes.map(node => [node.id, node.position]))

  return {
    ...workflow,
    nodes: workflow.nodes.map(node => ({
      ...node,
      position: byId.get(node.id) ?? node.position
    })),
    updatedAt: Date.now() / 1000
  }
}

function mergeEvents(previous: StreamEvent[], incoming: StreamEvent[]): StreamEvent[] {
  const byId = new Map<string, StreamEvent>()

  for (const event of previous) {
    byId.set(event.id, event)
  }

  for (const event of incoming) {
    byId.set(event.id, event)
  }

  return [...byId.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-500)
}

const FOLLOWABLE_RUN_STATUSES = new Set(['running', 'waiting_user_confirm', 'paused'])
const RUNTIME_EVENT_TYPES = new Set<StreamEvent['type']>(['node_status', 'approval'])

function latestWorkflowRuntimeNodeId(activeRun: ProjectBundle['latestRun'], events: StreamEvent[]): string | null {
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

function fileChangeCanPreview(change: WorkflowNode['fileChanges'][number]): boolean {
  return change.previewable !== false && !change.isBinary && Boolean(change.diff)
}

function parseReviewDecision(value: unknown): ReviewDecision | null {
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

function reviewDecisionLabel(copy: WorkflowCopy, decision: ReviewDecision['decision']): string {
  if (decision === 'pass') {
    return copy.reviewDecisionPass
  }

  if (decision === 'return') {
    return copy.reviewDecisionReturn
  }

  return copy.reviewDecisionNeedsHuman
}

function workflowEventNeedsCue(event: StreamEvent): boolean {
  if (event.type === 'approval' || event.type === 'error') {
    return true
  }

  if (event.type === 'process_summary' && event.status === 'warning') {
    return true
  }

  return event.type === 'node_status' && (event.status === 'warning' || event.status === 'error')
}

function playWorkflowCue(): void {
  try {
    const AudioContextCtor =
      window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

    if (!AudioContextCtor) {
      return
    }

    const context = new AudioContextCtor()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const now = context.currentTime

    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(880, now)
    oscillator.frequency.setValueAtTime(660, now + 0.12)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.26)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(now)
    oscillator.stop(now + 0.28)
    oscillator.addEventListener('ended', () => {
      void context.close().catch(() => undefined)
    })
  } catch {
    // Audio cues are best-effort and must never block workflow execution.
  }
}

function streamIsNearBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= STREAM_BOTTOM_THRESHOLD
}

type WorkflowTranscriptItem =
  | {
      id: string
      kind: 'assistant'
      label: string
      text: string
      timestamp: number
    }
  | {
      id: string
      kind: 'event'
      label: string
      status: string
      text: string
      timestamp: number
      type: StreamEvent['type']
    }

function streamTranscriptItems(events: StreamEvent[]): WorkflowTranscriptItem[] {
  const items: WorkflowTranscriptItem[] = []
  const assistantByKey = new Map<string, Extract<WorkflowTranscriptItem, { kind: 'assistant' }>>()

  for (const event of events) {
    if (event.type === 'ai_reply') {
      const details = event.details ?? {}
      const messageId = typeof details.messageId === 'string' ? details.messageId : null
      const key = messageId ?? `legacy-${event.runId ?? 'global'}-${event.nodeId ?? 'global'}-${event.label}`

      const text =
        typeof details.text === 'string'
          ? details.text
          : typeof details.delta === 'string'
            ? details.delta
            : event.summary

      const existing = assistantByKey.get(key)

      if (existing) {
        existing.text = text || existing.text
        existing.timestamp = event.timestamp
        existing.label = event.label || existing.label
      } else {
        const item: Extract<WorkflowTranscriptItem, { kind: 'assistant' }> = {
          id: key,
          kind: 'assistant',
          label: event.label,
          text,
          timestamp: event.timestamp
        }

        assistantByKey.set(key, item)
        items.push(item)
      }

      continue
    }

    items.push({
      id: event.id,
      kind: 'event',
      label: event.label,
      status: event.status,
      text: event.summary,
      timestamp: event.timestamp,
      type: event.type
    })
  }

  return items
}

function referenceFromPath(path: string): ReferenceItem {
  const name =
    path
      .replace(/[/\\]+$/, '')
      .split(/[/\\]/)
      .pop() || path

  return {
    id: `ref_${crypto.randomUUID().slice(0, 12)}`,
    name,
    path,
    enabled: true,
    kind: 'file',
    addedAt: Date.now() / 1000
  }
}

function fileName(path: string): string {
  return (
    path
      .replace(/[/\\]+$/, '')
      .split(/[/\\]/)
      .pop() || path
  )
}

function statusColor(status: WorkflowNodeStatus): string {
  const tone = STATUS_TONE[status] ?? 'neutral'

  const colors: Record<string, string> = {
    danger: 'var(--ui-red)',
    info: 'var(--ui-blue)',
    neutral: 'var(--ui-text-tertiary)',
    ready: 'var(--ui-blue)',
    running: 'var(--ui-purple)',
    success: 'var(--ui-green)',
    warning: 'var(--ui-yellow)'
  }

  return colors[tone] ?? colors.neutral
}

function runStatusLabel(copy: WorkflowCopy, status: string): string {
  return copy.runStatus[status as keyof typeof copy.runStatus] ?? status
}

function formatTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString()
}

function flattenModelChoices(options: ModelOptionsResponse | null): Array<{ model: string; provider: string }> {
  const choices: Array<{ model: string; provider: string }> = []
  const seen = new Set<string>()

  for (const provider of options?.providers ?? []) {
    for (const model of provider.models ?? []) {
      const key = `${provider.slug}:${model}`

      if (seen.has(key)) {
        continue
      }

      seen.add(key)
      choices.push({ model, provider: provider.name || provider.slug })
    }
  }

  return choices
}

function clampRightDrawerWidth(width: number): number {
  return Math.min(RIGHT_DRAWER_MAX_WIDTH, Math.max(RIGHT_DRAWER_MIN_WIDTH, Math.round(width)))
}

function readStoredRightDrawerWidth(): number {
  if (typeof window === 'undefined') {
    return RIGHT_DRAWER_DEFAULT_WIDTH
  }

  try {
    const raw = window.localStorage.getItem(RIGHT_DRAWER_WIDTH_KEY)
    const parsed = raw ? Number(raw) : RIGHT_DRAWER_DEFAULT_WIDTH

    return Number.isFinite(parsed) ? clampRightDrawerWidth(parsed) : RIGHT_DRAWER_DEFAULT_WIDTH
  } catch {
    return RIGHT_DRAWER_DEFAULT_WIDTH
  }
}

function persistRightDrawerWidth(width: number): void {
  try {
    window.localStorage.setItem(RIGHT_DRAWER_WIDTH_KEY, String(clampRightDrawerWidth(width)))
  } catch {
    // Drawer width is a local UI preference; ignore restricted storage.
  }
}

function openPath(path: string): void {
  if (!path) {
    return
  }

  void window.hermesDesktop.openExternal(pathToFileUrl(path))
}

function pathToFileUrl(path: string): string {
  const normalized = path.replace(/\\/g, '/')

  if (normalized.startsWith('/')) {
    return encodeURI(`file://${normalized}`)
  }

  return encodeURI(`file:///${normalized}`)
}

function resolveProjectPath(root: string | undefined, path: string): string {
  if (!path || /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('/') || path.startsWith('\\\\')) {
    return path
  }

  if (!root) {
    return path
  }

  return `${root.replace(/[\\/]+$/, '')}\\${path.replace(/\//g, '\\')}`
}

function normalizeProjectReference(root: string, path: string): string {
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const normalizedPath = path.replace(/\\/g, '/')

  if (normalizedPath.toLowerCase().startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1)
  }

  return path
}

function errorText(error: unknown): string | undefined {
  if (!error) {
    return undefined
  }

  return error instanceof Error ? error.message : String(error)
}
