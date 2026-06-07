import { AssistantRuntimeProvider, type ThreadMessage, useExternalStoreRuntime } from '@assistant-ui/react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setAppLanguage } from '@/store/app-language'
import { clearComposerAttachments } from '@/store/composer'

import { ChatBar } from './index'
import type { ChatBarState } from './types'

class TestResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    this.callback(
      [
        {
          contentRect: { height: 40, width: 640 } as DOMRectReadOnly,
          target
        } as ResizeObserverEntry
      ],
      this as unknown as ResizeObserver
    )
  }

  unobserve() {}

  disconnect() {}
}

vi.stubGlobal('ResizeObserver', TestResizeObserver)
vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
  window.setTimeout(() => callback(performance.now()), 0)
)
vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id))

const chatBarState: ChatBarState = {
  model: {
    canSwitch: false,
    model: 'test-model',
    provider: 'test'
  },
  tools: { enabled: false, label: 'Tools' },
  voice: { active: false, enabled: false }
}

function ChatBarHarness({ placeholderOverride }: { placeholderOverride?: string } = {}) {
  const runtime = useExternalStoreRuntime<ThreadMessage>({
    isRunning: false,
    messages: [],
    onNew: async () => {}
  })

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatBar
        busy={false}
        disabled={false}
        onCancel={vi.fn()}
        onSubmit={vi.fn(async () => true)}
        placeholderOverride={placeholderOverride}
        state={chatBarState}
      />
    </AssistantRuntimeProvider>
  )
}

describe('ChatBar composer action state', () => {
  beforeEach(() => {
    setAppLanguage('en')
    clearComposerAttachments()
  })

  afterEach(() => {
    cleanup()
    clearComposerAttachments()
  })

  it('switches from voice action to send action when visible text is entered', async () => {
    render(<ChatBarHarness />)

    const editor = screen.getByRole('textbox', { name: 'Message' })

    expect(screen.getByRole('button', { name: 'Start voice conversation' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()

    editor.textContent = 'hello hermes'
    fireEvent.input(editor)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Start voice conversation' })).toBeNull()

    editor.textContent = ''
    fireEvent.input(editor)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Start voice conversation' })).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
  })

  it('uses a provided placeholder override without changing submit state', () => {
    render(<ChatBarHarness placeholderOverride="Tell Hermes what to adjust in this workflow draft..." />)

    const editor = screen.getByRole('textbox', { name: 'Message' })

    expect(editor.getAttribute('data-placeholder')).toBe('Tell Hermes what to adjust in this workflow draft...')
    expect(screen.getByRole('button', { name: 'Start voice conversation' })).toBeTruthy()
  })
})
