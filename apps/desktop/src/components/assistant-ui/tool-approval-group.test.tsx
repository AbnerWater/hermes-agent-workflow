import { AssistantRuntimeProvider, type ThreadMessage, useExternalStoreRuntime } from '@assistant-ui/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setAppLanguage } from '@/store/app-language'
import { clearAllPrompts, setApprovalRequest } from '@/store/prompts'
import { $activeSessionId } from '@/store/session'
import { $toolDisclosureStates } from '@/store/tool-view'

import { Thread } from './thread'

// Regression coverage for the "approval buried behind a collapsed tool group"
// bug. When 2+ tools group into a collapsed "Tool actions · N steps" row, the
// pending tool's inline ApprovalBar lives inside the group body — which is
// `hidden` until expanded. A live approval must surface WITHOUT the user
// expanding anything, so ToolGroupSlot force-opens its body while an approval
// targeting one of its pending tools is in flight.

const createdAt = new Date('2026-06-03T00:00:00.000Z')

const resizeObservers = new Set<TestResizeObserver>()

class TestResizeObserver {
  private target: Element | null = null

  constructor(private readonly callback: ResizeObserverCallback) {
    resizeObservers.add(this)
  }

  observe(target: Element) {
    this.target = target
  }

  unobserve() {}

  disconnect() {
    resizeObservers.delete(this)
  }
}

vi.stubGlobal('ResizeObserver', TestResizeObserver)
vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
  window.setTimeout(() => callback(performance.now()), 0)
)
vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id))

Element.prototype.scrollTo = function scrollTo() {}

Element.prototype.animate = function animate() {
  return {
    cancel: () => {},
    finished: Promise.resolve()
  } as unknown as Animation
}

function stubOffsetDimension(
  prop: 'offsetHeight' | 'offsetWidth',
  clientProp: 'clientHeight' | 'clientWidth',
  fallback: number
) {
  const previous = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop)

  Object.defineProperty(HTMLElement.prototype, prop, {
    configurable: true,
    get() {
      return previous?.get?.call(this) || (this as HTMLElement)[clientProp] || fallback
    }
  })
}

stubOffsetDimension('offsetWidth', 'clientWidth', 800)
stubOffsetDimension('offsetHeight', 'clientHeight', 600)

// A running assistant message with two tools: a completed read_file plus a
// pending terminal (no result). Two visible tools → ToolGroupSlot groups them
// behind a collapsed "Tool actions · 2 steps" header.
function groupedPendingMessage(): ThreadMessage {
  return {
    id: 'assistant-group-1',
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: 'read-1',
        toolName: 'read_file',
        args: { path: '/etc/hosts' },
        argsText: JSON.stringify({ path: '/etc/hosts' }),
        result: { content: '127.0.0.1 localhost' }
      },
      {
        type: 'tool-call',
        toolCallId: 'term-1',
        toolName: 'terminal',
        args: { command: 'rm -rf /tmp/x' },
        argsText: JSON.stringify({ command: 'rm -rf /tmp/x' })
      }
    ],
    status: { type: 'running' },
    createdAt,
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {}
    }
  } as ThreadMessage
}

function groupedCompletedClarifyMessage(): ThreadMessage {
  return {
    id: 'assistant-group-clarify',
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: 'read-1',
        toolName: 'read_file',
        args: { path: '/etc/hosts' },
        argsText: JSON.stringify({ path: '/etc/hosts' }),
        result: { content: '127.0.0.1 localhost' }
      },
      {
        type: 'tool-call',
        toolCallId: 'term-1',
        toolName: 'terminal',
        args: { command: 'echo ok' },
        argsText: JSON.stringify({ command: 'echo ok' }),
        result: { exit_code: 0, output: 'ok' }
      },
      {
        type: 'tool-call',
        toolCallId: 'clarify-1',
        toolName: 'clarify',
        args: { question: 'Which workflow path?', choices: ['Fast', 'Balanced', 'Strict'] },
        argsText: JSON.stringify({ question: 'Which workflow path?', choices: ['Fast', 'Balanced', 'Strict'] }),
        result: JSON.stringify({
          choices_offered: ['Fast', 'Balanced', 'Strict'],
          question: 'Which workflow path?',
          user_response: 'Balanced'
        })
      }
    ],
    status: { type: 'complete', reason: 'stop' },
    createdAt,
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {}
    }
  } as ThreadMessage
}

function workflowDraftPayload() {
  return {
    clarificationSummary: 'Two clarification answers collected.',
    draftMarkdown: '# Valid Workflow Draft\n\n- Plan\n- Execute\n- Review',
    references: [],
    root: '',
    workflow: {
      id: 'workflow-draft',
      title: 'Valid Workflow Draft',
      updatedAt: 1700000000,
      nodes: [
        {
          id: 'plan',
          type: 'planning',
          title: 'Plan',
          description: 'Plan the work.',
          skills: [],
          reviewRules: { checklist: [], required: false }
        },
        {
          id: 'review',
          type: 'review',
          title: 'Review',
          description: 'Review the work.',
          skills: [],
          reviewRules: { checklist: ['Pass criteria'], required: true }
        }
      ],
      edges: [{ id: 'edge-plan-review', source: 'plan', sourceHandle: 'success', target: 'review', targetHandle: 'input' }]
    }
  }
}

function reasoningWorkflowDraftMessage(): ThreadMessage {
  return {
    id: 'assistant-workflow-draft',
    role: 'assistant',
    content: [
      { type: 'reasoning', text: 'I am preparing a workflow draft.' },
      {
        type: 'tool-call',
        toolCallId: 'workflow-draft-1',
        toolName: 'workflow_draft_propose',
        args: workflowDraftPayload(),
        argsText: JSON.stringify(workflowDraftPayload()),
        result: JSON.stringify(workflowDraftPayload())
      },
      { type: 'text', text: 'The workflow draft is ready.' }
    ],
    status: { type: 'complete', reason: 'stop' },
    createdAt,
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {}
    }
  } as ThreadMessage
}

function pendingWorkflowDraftMessage(): ThreadMessage {
  return {
    id: 'assistant-workflow-draft-pending',
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: 'workflow-draft-pending-1',
        toolName: 'workflow_draft_propose',
        args: {
          draftMarkdown: '# Pending Draft Should Stay Hidden\n\nThis pending draft body should not be shown.',
          workflow: {
            id: 'pending',
            title: 'Pending Draft',
            nodes: [
              {
                id: 'plan',
                type: 'planning',
                title: 'Plan',
                description: 'Plan the work.',
                skills: [],
                reviewRules: { checklist: [], required: false }
              }
            ],
            edges: []
          }
        },
        argsText: JSON.stringify({
          draftMarkdown: '# Pending Draft Should Stay Hidden\n\nThis pending draft body should not be shown.',
          workflow: { id: 'pending', title: 'Pending Draft', nodes: [], edges: [] }
        })
      }
    ],
    status: { type: 'running' },
    createdAt,
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {}
    }
  } as ThreadMessage
}

function invalidWorkflowDraftMessage(): ThreadMessage {
  return {
    id: 'assistant-workflow-draft-invalid',
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: 'workflow-draft-invalid-1',
        toolName: 'workflow_draft_propose',
        args: {
          draftMarkdown: '# Full Invalid Draft\n\nThis full invalid draft should not be shown.',
          workflow: { id: 'invalid', nodes: [], edges: [] }
        },
        argsText: JSON.stringify({
          draftMarkdown: '# Full Invalid Draft\n\nThis full invalid draft should not be shown.',
          workflow: { id: 'invalid', nodes: [], edges: [] }
        }),
        result: JSON.stringify({
          draftPreviewOmitted: true,
          error: 'workflow.nodes must be a non-empty array.',
          overview: 'Draft overview: invalid; nodes=0; edges=0.',
          validationIssues: ['workflow.nodes must be a non-empty array.']
        })
      }
    ],
    status: { type: 'complete', reason: 'stop' },
    createdAt,
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {}
    }
  } as ThreadMessage
}

function repeatedInvalidWorkflowDraftMessage(): ThreadMessage {
  return {
    id: 'assistant-workflow-draft-repeated-invalid',
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: 'workflow-draft-invalid-1',
        toolName: 'workflow_draft_propose',
        args: { draftMarkdown: '# First invalid draft', workflow: { nodes: [] } },
        argsText: JSON.stringify({ draftMarkdown: '# First invalid draft', workflow: { nodes: [] } }),
        result: JSON.stringify({
          draftPreviewOmitted: true,
          error: 'workflow.nodes must be a non-empty array.',
          overview: 'First invalid overview.',
          validationIssues: ['workflow.nodes must be a non-empty array.']
        })
      },
      {
        type: 'tool-call',
        toolCallId: 'workflow-draft-invalid-2',
        toolName: 'workflow_draft_propose',
        args: { draftMarkdown: '# Second invalid draft', workflow: { nodes: [] } },
        argsText: JSON.stringify({ draftMarkdown: '# Second invalid draft', workflow: { nodes: [] } }),
        result: JSON.stringify({
          draftPreviewOmitted: true,
          error: 'workflow.edges[0].target references an unknown node.',
          overview: 'Second invalid overview.',
          validationIssues: ['workflow.edges[0].target references an unknown node.']
        })
      }
    ],
    status: { type: 'complete', reason: 'stop' },
    createdAt,
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {}
    }
  } as ThreadMessage
}

function GroupHarness({ message }: { message: ThreadMessage }) {
  const runtime = useExternalStoreRuntime<ThreadMessage>({
    messages: [message],
    isRunning: message.status?.type === 'running',
    onNew: async () => {}
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <AssistantRuntimeProvider runtime={runtime}>
          <Thread />
        </AssistantRuntimeProvider>
      </QueryClientProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  setAppLanguage('en')
  clearAllPrompts()
  $activeSessionId.set('sess-1')
  $toolDisclosureStates.set({})
})

afterEach(() => {
  cleanup()
  clearAllPrompts()
  $activeSessionId.set(null)
  setAppLanguage('zh')
})

describe('ToolGroupSlot approval surfacing', () => {
  it('hides the grouped pending tool body when there is no approval', async () => {
    const { container } = render(<GroupHarness message={groupedPendingMessage()} />)

    // Group header renders collapsed; the inline approval strip lives in the
    // hidden body, so with no live approval it must not render at all (the
    // ApprovalBar returns null when $approvalRequest is empty).
    await waitFor(() => {
      expect(screen.getByText(/Tool actions/)).toBeTruthy()
    })
    expect(container.querySelector('[data-slot="tool-approval-inline"]')).toBeNull()
  })

  it('force-opens the group body so the approval surfaces without expanding', async () => {
    setApprovalRequest({ command: 'rm -rf /tmp/x', description: 'dangerous command', sessionId: 'sess-1' })

    const { container } = render(<GroupHarness message={groupedPendingMessage()} />)

    // Even though the group defaults collapsed, the live approval forces the
    // body open so the inline controls are visible (and reachable, not in a
    // hidden subtree) immediately.
    await waitFor(() => {
      const bar = container.querySelector('[data-slot="tool-approval-inline"]')
      expect(bar).not.toBeNull()
      // The forced-open group body must not be hidden — assert no ancestor
      // carries the `hidden` attribute that would keep the bar off-screen.
      expect(bar?.closest('[hidden]')).toBeNull()
    })
  })

  it('keeps completed clarify Q/A visible when it shares a grouped tool range', async () => {
    const { container } = render(<GroupHarness message={groupedCompletedClarifyMessage()} />)

    await waitFor(() => {
      expect(screen.getByText(/Which workflow path/)).toBeTruthy()
      expect(screen.getAllByText(/Balanced/).length).toBeGreaterThan(0)
    })

    const clarify = container.querySelector('[data-slot="clarify-inline-complete"]')
    expect(clarify).not.toBeNull()
    expect(clarify?.closest('[hidden]')).toBeNull()
  })

  it('hoists workflow draft cards outside the thinking disclosure', async () => {
    const { container } = render(<GroupHarness message={reasoningWorkflowDraftMessage()} />)

    await waitFor(() => {
      expect(screen.getAllByText(/Valid Workflow Draft/).length).toBeGreaterThan(0)
    })

    const draft = container.querySelector('[data-slot="workflow-draft-card"]')
    const thinking = container.querySelector('[data-slot="aui_thinking-disclosure"]')
    expect(draft).not.toBeNull()
    expect(thinking).not.toBeNull()
    expect(Boolean(thinking?.contains(draft as Node))).toBe(false)
    expect(draft?.closest('[hidden]')).toBeNull()
    expect(screen.getByRole('button', { name: /Preview/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Initialize workflow/i })).toBeTruthy()
  })

  it('shows pending workflow draft generation without rendering args preview or disabled actions', async () => {
    const { container } = render(<GroupHarness message={pendingWorkflowDraftMessage()} />)

    await waitFor(() => {
      expect(container.querySelector('[data-slot="workflow-draft-pending"]')).not.toBeNull()
    })

    expect(screen.queryByText(/Pending Draft Should Stay Hidden/)).toBeNull()
    expect(screen.queryByText(/This pending draft body should not be shown/)).toBeNull()
    expect(container.querySelector('[data-slot="workflow-draft-card"]')).toBeNull()
    expect(screen.queryByRole('button', { name: /Preview/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Initialize workflow/i })).toBeNull()
  })

  it('shows invalid workflow draft errors without rendering the full draft preview', async () => {
    const { container } = render(<GroupHarness message={invalidWorkflowDraftMessage()} />)

    await waitFor(() => {
      expect(screen.getAllByText(/workflow.nodes must be a non-empty array/i).length).toBeGreaterThan(0)
    })

    expect(container.querySelector('[data-slot="workflow-draft-error"]')).not.toBeNull()
    expect(screen.queryByText(/This full invalid draft should not be shown/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Preview/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Initialize workflow/i })).toBeNull()
  })

  it('deduplicates repeated invalid workflow drafts in the same assistant message', async () => {
    const { container } = render(<GroupHarness message={repeatedInvalidWorkflowDraftMessage()} />)

    await waitFor(() => {
      expect(screen.getAllByText(/workflow.edges\[0\]\.target references an unknown node/i).length).toBeGreaterThan(0)
    })

    expect(container.querySelectorAll('[data-slot="workflow-draft-error"]')).toHaveLength(1)
    expect(screen.queryByText(/First invalid overview/i)).toBeNull()
    expect(screen.getByText(/Second invalid overview/i)).toBeTruthy()
  })
})
