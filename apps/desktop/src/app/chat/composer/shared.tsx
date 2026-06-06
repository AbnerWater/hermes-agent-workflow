import {
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef
} from 'react'

import { cn } from '@/lib/utils'

import { COMPOSER_DROP_ACTIVE_CLASS, COMPOSER_DROP_FADE_CLASS } from './drop-affordance'
import { composerPlainText, placeCaretEnd, renderComposerContents, RICH_INPUT_SLOT } from './rich-editor'

export const COMPOSER_STACK_BREAKPOINT_PX = 320

// A single editor line is ~28px (--composer-input-min-height 1.625rem + 0.5rem
// vertical padding). Anything taller means the text wrapped to a second line,
// which is when the composer should expand to the stacked layout.
export const COMPOSER_SINGLE_LINE_MAX_PX = 36

export const COMPOSER_FADE_BACKGROUND =
  'linear-gradient(to bottom, transparent, color-mix(in srgb, var(--dt-background) 10%, transparent))'

export const COMPOSER_ROOT_FRAME_CLASS =
  'group/composer w-[min(var(--composer-width),calc(100%-2rem))] max-w-full rounded-2xl pt-2 pb-[var(--composer-shell-pad-block-end)]'

export const COMPOSER_ABSOLUTE_ROOT_CLASS = cn(
  COMPOSER_ROOT_FRAME_CLASS,
  'absolute bottom-0 left-1/2 z-30 -translate-x-1/2'
)

export interface ComposerSurfaceProps {
  children: ReactNode
  className?: string
  dragActive?: boolean
  scrolledUp?: boolean
  surfaceRef?: Ref<HTMLDivElement>
}

export function ComposerSurface({
  children,
  className,
  dragActive = false,
  scrolledUp = false,
  surfaceRef
}: ComposerSurfaceProps) {
  return (
    <>
      <div
        className="pointer-events-none absolute inset-0 rounded-[inherit]"
        style={{ background: COMPOSER_FADE_BACKGROUND }}
      />
      <div className="relative w-full rounded-[inherit]">
        <div
          className={cn(
            'relative z-4 isolate rounded-[inherit] border border-[color-mix(in_srgb,var(--dt-composer-ring)_calc(18%*var(--composer-ring-strength)),var(--dt-input))] shadow-composer transition-[border-color,box-shadow] duration-200 ease-out',
            COMPOSER_DROP_FADE_CLASS,
            'group-focus-within/composer:border-[color-mix(in_srgb,var(--dt-composer-ring)_calc(45%*var(--composer-ring-strength)),transparent)] group-focus-within/composer:shadow-composer-focus',
            'group-has-data-[state=open]/composer:border-t-transparent',
            'group-has-data-[state=open]/composer:shadow-[0_0.0625rem_0_0.0625rem_color-mix(in_srgb,var(--dt-composer-ring)_calc(35%*var(--composer-ring-strength)),transparent),0_0.5rem_1.5rem_color-mix(in_srgb,var(--shadow-ink)_6%,transparent)]',
            dragActive && COMPOSER_DROP_ACTIVE_CLASS,
            className
          )}
          data-slot="composer-surface"
          ref={surfaceRef}
        >
          <div
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-0 -z-10 rounded-[inherit]',
              'bg-[color-mix(in_srgb,var(--dt-card)_72%,transparent)]',
              'backdrop-blur-[0.75rem] backdrop-saturate-[1.12]',
              '[-webkit-backdrop-filter:blur(0.75rem)_saturate(1.12)]',
              'transition-[background-color] duration-150 ease-out',
              'group-data-[thread-scrolled-up]/composer:bg-[color-mix(in_srgb,var(--dt-card)_48%,transparent)]',
              'group-focus-within/composer:bg-[color-mix(in_srgb,var(--dt-card)_85%,transparent)]'
            )}
          />
          <div
            className={cn(
              'relative z-1 flex min-h-0 w-full flex-col gap-(--composer-row-gap) overflow-hidden rounded-[inherit] px-(--composer-surface-pad-x) py-(--composer-surface-pad-y) transition-opacity duration-200 ease-out',
              scrolledUp
                ? 'opacity-30 group-hover/composer:opacity-100 group-focus-within/composer:opacity-100'
                : 'opacity-100'
            )}
            data-slot="composer-fade"
          >
            {children}
          </div>
        </div>
      </div>
    </>
  )
}

export interface ComposerRichInputHandle {
  focus: () => void
}

interface ComposerRichInputProps {
  ariaLabel: string
  className?: string
  disabled?: boolean
  onChange: (value: string) => void
  onSubmit?: () => void
  placeholder: string
  value: string
}

export const ComposerRichInput = forwardRef<ComposerRichInputHandle, ComposerRichInputProps>(
  ({ ariaLabel, className, disabled = false, onChange, onSubmit, placeholder, value }, forwardedRef) => {
    const editorRef = useRef<HTMLDivElement | null>(null)
    const composingRef = useRef(false)

    useImperativeHandle(
      forwardedRef,
      () => ({
        focus: () => {
          const editor = editorRef.current

          if (!editor) {
            return
          }

          editor.focus({ preventScroll: true })
          placeCaretEnd(editor)
        }
      }),
      []
    )

    useEffect(() => {
      const editor = editorRef.current

      if (!editor || document.activeElement === editor || composerPlainText(editor) === value) {
        return
      }

      renderComposerContents(editor, value)
    }, [value])

    const commitChange = () => {
      const editor = editorRef.current

      if (!editor) {
        return
      }

      onChange(composerPlainText(editor))
    }

    const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
      const pastedText = event.clipboardData.getData('text').trim()

      if (!pastedText) {
        event.preventDefault()

        return
      }

      event.preventDefault()
      document.execCommand('insertText', false, pastedText)
      commitChange()
    }

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !composingRef.current) {
        event.preventDefault()
        onSubmit?.()
      }
    }

    return (
      <div
        aria-label={ariaLabel}
        autoCapitalize="off"
        autoCorrect="off"
        className={cn(
          'min-h-(--composer-input-min-height) max-h-(--composer-input-max-height) overflow-y-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere] bg-transparent pb-1 pr-1 pt-1 leading-normal text-foreground outline-none disabled:cursor-not-allowed',
          'empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground/60',
          '**:data-ref-text:cursor-default',
          'w-full min-w-0',
          className
        )}
        contentEditable={!disabled}
        data-placeholder={placeholder}
        data-slot={RICH_INPUT_SLOT}
        onCompositionEnd={() => {
          composingRef.current = false
        }}
        onCompositionStart={() => {
          composingRef.current = true
        }}
        onInput={commitChange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        ref={editorRef}
        role="textbox"
        spellCheck="true"
        suppressContentEditableWarning
      />
    )
  }
)

ComposerRichInput.displayName = 'ComposerRichInput'
