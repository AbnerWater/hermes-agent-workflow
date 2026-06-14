import { atom, computed } from 'nanostores'

import type { Workflow } from '@/types/workflow'

import { $activeSessionId, $currentCwd } from './session'

// ---------------------------------------------------------------------------
// Planning types
// ---------------------------------------------------------------------------

export type PlanningPhase = 'idle' | 'explore' | 'understand' | 'clarify' | 'plan' | 'refine'

export interface ClarifyEntry {
  question: string
  choices: string[] | null
  answer: string
  timestamp: number
}

export interface WorkflowPlanningContext {
  references: string[]
  phase: PlanningPhase
  clarifyHistory?: ClarifyEntry[]
}

// ---------------------------------------------------------------------------
// Clarify types (backward-compatible with old store/clarify.ts)
// ---------------------------------------------------------------------------

export interface ClarifyRequest {
  requestId: string
  question: string
  choices: string[] | null
  sessionId: string | null
}

// ---------------------------------------------------------------------------
// Planning atoms
// ---------------------------------------------------------------------------

export const $planningMode = atom(false)
export const $planningPhase = atom<PlanningPhase>('idle')
export const $planningDraft = atom<Workflow | null>(null)
export const $planningDraftMarkdown = atom('')
export const $planningClarifyHistory = atom<ClarifyEntry[]>([])
export const $planningReferences = atom<string[]>([])

// ---------------------------------------------------------------------------
// Clarify atoms (migrated from store/clarify.ts)
// ---------------------------------------------------------------------------

const keyFor = (sessionId: string | null | undefined): string => sessionId ?? ''

export const $clarifyRequests = atom<Record<string, ClarifyRequest>>({})

export const $clarifyRequest = computed(
  [$clarifyRequests, $activeSessionId],
  (requests, activeId) => requests[keyFor(activeId)] ?? null
)

// ---------------------------------------------------------------------------
// Planning actions
// ---------------------------------------------------------------------------

export function enablePlanningMode(): void {
  $planningMode.set(true)
  $planningPhase.set('idle')
}

export function disablePlanningMode(): void {
  resetPlanningState()
}

export function setPlanningReferences(refs: string[]): void {
  $planningReferences.set(refs)
}

const PHASE_ORDER: PlanningPhase[] = ['idle', 'explore', 'understand', 'clarify', 'plan', 'refine']

export function advancePhase(next: PlanningPhase): void {
  const current = $planningPhase.get()
  const currentIndex = PHASE_ORDER.indexOf(current)
  const nextIndex = PHASE_ORDER.indexOf(next)

  if (nextIndex > currentIndex) {
    $planningPhase.set(next)
  }
}

export function setPlanningDraft(workflow: Workflow | null, markdown: string): void {
  $planningDraft.set(workflow)
  $planningDraftMarkdown.set(markdown)
}

export function addClarifyEntry(entry: ClarifyEntry): void {
  $planningClarifyHistory.set([...$planningClarifyHistory.get(), entry])
}

export function resetPlanningState(): void {
  $planningMode.set(false)
  $planningPhase.set('idle')
  $planningDraft.set(null)
  $planningDraftMarkdown.set('')
  $planningClarifyHistory.set([])
  $planningReferences.set([])
}

// ---------------------------------------------------------------------------
// Clarify actions (backward-compatible)
// ---------------------------------------------------------------------------

export function setClarifyRequest(request: ClarifyRequest): void {
  $clarifyRequests.set({ ...$clarifyRequests.get(), [keyFor(request.sessionId)]: request })
}

export function clearClarifyRequest(requestId?: string, sessionId?: string | null): void {
  const requests = $clarifyRequests.get()

  if (sessionId !== undefined) {
    const key = keyFor(sessionId)
    const current = requests[key]

    if (!current || (requestId && current.requestId !== requestId)) {
      return
    }

    const next = { ...requests }
    delete next[key]
    $clarifyRequests.set(next)

    return
  }

  const next: Record<string, ClarifyRequest> = {}
  let changed = false

  for (const [key, value] of Object.entries(requests)) {
    if (requestId && value.requestId !== requestId) {
      next[key] = value
    } else {
      changed = true
    }
  }

  if (changed) {
    $clarifyRequests.set(next)
  }
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

const WORKFLOW_NODE_RULES = [
  'Workflow node rules: normal task nodes use one input and one success output; review/test nodes use one input plus success and failure outputs.',
  'Ordinary task nodes must not use failure outputs. Each output handle can connect to at most one input; an input can receive multiple sources.',
  'Node ids, workflow id, workflow title, edge ids, edge handles, positions, and updatedAt may be omitted because Hermes will derive or normalize them.',
  'Every node must include type, title, and description.'
].join(' ')

const DRAFT_TOOL_RULES = [
  'The full workflow draft must be submitted through workflow_draft_propose so the UI can validate, preview, and initialize it.',
  'Do not paste the full workflow draft in ordinary assistant text.',
  'If workflow_draft_propose returns a validation error, write at most one short sentence to the user, fix the structured workflow object, and call workflow_draft_propose again.',
  'When the workflow plan is ready, call workflow_draft_propose with draftMarkdown, clarificationSummary, and a workflow object whose nodes array is complete and non-empty.'
].join(' ')

const CLARIFY_RULES = [
  'Each clarify call must contain one focused question about a key decision that impacts workflow execution,',
  'and exactly three recommended choices ordered by priority.',
  'The UI provides an Other/custom answer option automatically.',
  'Only ask about critical decisions that significantly affect the workflow structure or execution.'
].join(' ')

function formatClarifyHistory(history: ClarifyEntry[]): string {
  if (history.length === 0) {
    return ''
  }

  const lines = history.map((entry, i) => {
    const choicesText = entry.choices?.length ? ` [options: ${entry.choices.join(', ')}]` : ''

    return `Q${i + 1}: ${entry.question}${choicesText}\nA${i + 1}: ${entry.answer}`
  })

  return `Prior clarification Q&A:\n${lines.join('\n')}`
}

export function buildPlanningSystemContext(
  phase: PlanningPhase,
  refs: string[],
  clarifyHistory: ClarifyEntry[]
): string {
  const cwd = $currentCwd.get()
  const sections: string[] = [
    'HERMES_WORKFLOW_PLANNING_CONTEXT: true',
    'You are helping the user create a Hermes Workflow from this normal chat session.',
    'Treat this turn as workflow planning context, but keep the conversation in the ordinary chat session.'
  ]

  if (phase === 'idle' || phase === 'explore' || phase === 'understand') {
    sections.push(
      'Current phase: exploration and understanding.',
      'Analyze the user\'s task goal, attached context, and chat history carefully.',
      'Assess task complexity and determine if enough information exists for complete workflow planning.',
      'If the information is sufficient for a complete workflow plan, call workflow_draft_propose directly.',
      `If critical boundary constraints or execution details are missing, use the clarify tool. ${CLARIFY_RULES}`
    )
  } else if (phase === 'clarify') {
    sections.push(
      'Current phase: clarification.',
      `Continue gathering missing critical information. ${CLARIFY_RULES}`,
      'When all necessary information is collected, call workflow_draft_propose to generate the workflow draft.'
    )

    const history = formatClarifyHistory(clarifyHistory)

    if (history) {
      sections.push(history)
    }
  } else if (phase === 'plan') {
    sections.push(
      'Current phase: planning.',
      'Generate a complete workflow draft based on all gathered information and requirements.',
      DRAFT_TOOL_RULES
    )

    const history = formatClarifyHistory(clarifyHistory)

    if (history) {
      sections.push(`Clarification summary:\n${history}`)
    }
  } else if (phase === 'refine') {
    sections.push(
      'Current phase: refinement.',
      'The user has provided feedback on the current workflow draft. Revise the draft accordingly.',
      'If the user\'s feedback introduces ambiguity or missing details, use the clarify tool for additional questions.',
      'After incorporating changes, call workflow_draft_propose with the updated workflow.',
      DRAFT_TOOL_RULES
    )

    const draft = $planningDraft.get()

    if (draft) {
      sections.push(`Current workflow draft (JSON): ${JSON.stringify(draft)}`)
    }

    const history = formatClarifyHistory(clarifyHistory)

    if (history) {
      sections.push(history)
    }
  }

  sections.push(WORKFLOW_NODE_RULES)
  sections.push(cwd ? `Current working directory: ${cwd}` : 'Current working directory: not set.')
  sections.push(refs.length ? `Workflow references:\n${refs.map(ref => `- ${ref}`).join('\n')}` : 'Workflow references: none supplied.')

  return sections.join('\n')
}
