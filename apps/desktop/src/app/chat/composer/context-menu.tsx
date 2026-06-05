import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useAppCopy } from '@/i18n'
import { Clipboard, FileText, FolderOpen, type IconComponent, ImageIcon, Link, MessageSquareText } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { GHOST_ICON_BTN } from './controls'
import type { ChatBarState } from './types'

export function ContextMenu({
  state,
  onInsertText,
  onOpenUrlDialog,
  onPasteClipboardImage,
  onPickFiles,
  onPickFolders,
  onPickImages
}: ContextMenuProps) {
  const copy = useAppCopy()
  // Prompt snippets used to be a Radix submenu. That submenu didn't open
  // reliably when the parent menu was positioned at the bottom of the
  // window (composer "+" anchor), so we promoted it to a real Dialog —
  // easier to grow with search / descriptions, and no positioning math.
  const [snippetsOpen, setSnippetsOpen] = useState(false)

  const snippets: readonly PromptSnippet[] = [
    {
      description: copy.chat.codeReviewDescription,
      label: copy.chat.codeReviewLabel,
      text: copy.chat.codeReviewPrompt
    },
    {
      description: copy.chat.implementationPlanDescription,
      label: copy.chat.implementationPlanLabel,
      text: copy.chat.implementationPlanPrompt
    },
    {
      description: copy.chat.explainDescription,
      label: copy.chat.explainLabel,
      text: copy.chat.explainPrompt
    }
  ]

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={state.tools.label}
            className={cn(
              GHOST_ICON_BTN,
              'data-[state=open]:bg-(--chrome-action-hover) data-[state=open]:text-foreground'
            )}
            disabled={!state.tools.enabled}
            size="icon"
            title={state.tools.label}
            type="button"
            variant="ghost"
          >
            <Codicon name="add" size="1rem" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60" side="top" sideOffset={10}>
          <DropdownMenuLabel className="text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground/85">
            {copy.chat.attach}
          </DropdownMenuLabel>
          <ContextMenuItem disabled={!onPickFiles} icon={FileText} onSelect={onPickFiles}>
            {copy.chat.files}
          </ContextMenuItem>
          <ContextMenuItem disabled={!onPickFolders} icon={FolderOpen} onSelect={onPickFolders}>
            {copy.chat.folder}
          </ContextMenuItem>
          <ContextMenuItem disabled={!onPickImages} icon={ImageIcon} onSelect={onPickImages}>
            {copy.chat.images}
          </ContextMenuItem>
          <ContextMenuItem disabled={!onPasteClipboardImage} icon={Clipboard} onSelect={onPasteClipboardImage}>
            {copy.chat.pasteImage}
          </ContextMenuItem>
          <ContextMenuItem icon={Link} onSelect={onOpenUrlDialog}>
            {copy.chat.url}
          </ContextMenuItem>

          <DropdownMenuSeparator />

          <ContextMenuItem icon={MessageSquareText} onSelect={() => setSnippetsOpen(true)}>
            {`${copy.chat.promptSnippets}...`}
          </ContextMenuItem>

          <DropdownMenuSeparator />

          <div className="px-2 py-1 text-[0.7rem] text-muted-foreground/80">
            {copy.chat.typeAtReferenceTip}{' '}
            <kbd className="rounded bg-muted/70 px-1 py-px font-mono text-[0.65rem]">@</kbd>{' '}
            {copy.chat.typeAtReferenceSuffix}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <PromptSnippetsDialog
        onInsertText={onInsertText}
        onOpenChange={setSnippetsOpen}
        open={snippetsOpen}
        snippets={snippets}
      />
    </>
  )
}

function PromptSnippetsDialog({ onInsertText, onOpenChange, open, snippets }: PromptSnippetsDialogProps) {
  const copy = useAppCopy()

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-md gap-3">
        <DialogHeader>
          <DialogTitle>{copy.chat.promptSnippets}</DialogTitle>
          <DialogDescription>{copy.chat.promptSnippetsDescription}</DialogDescription>
        </DialogHeader>
        <ul className="grid gap-1">
          {snippets.map(snippet => (
            <li key={snippet.label}>
              <button
                className="group/snippet flex w-full items-start gap-2.5 rounded-md border border-transparent px-2.5 py-2 text-left transition-colors hover:border-(--ui-stroke-tertiary) hover:bg-(--ui-control-hover-background) focus-visible:border-(--ui-stroke-tertiary) focus-visible:bg-(--ui-control-hover-background) focus-visible:outline-none"
                onClick={() => {
                  onInsertText(snippet.text)
                  onOpenChange(false)
                }}
                type="button"
              >
                <MessageSquareText className="mt-0.5 size-3.5 shrink-0 text-(--ui-text-tertiary) group-hover/snippet:text-foreground" />
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-sm font-medium text-foreground">{snippet.label}</span>
                  <span className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
                    {snippet.description}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

export function ContextMenuItem({ children, disabled, icon: Icon, onSelect }: ContextMenuItemProps) {
  return (
    <DropdownMenuItem disabled={disabled} onSelect={onSelect}>
      <Icon />
      <span>{children}</span>
    </DropdownMenuItem>
  )
}

interface ContextMenuItemProps {
  children: string
  disabled?: boolean
  icon: IconComponent
  onSelect?: () => void
}

interface ContextMenuProps {
  onInsertText: (text: string) => void
  onOpenUrlDialog: () => void
  onPasteClipboardImage?: () => void
  onPickFiles?: () => void
  onPickFolders?: () => void
  onPickImages?: () => void
  state: ChatBarState
}

interface PromptSnippet {
  description: string
  label: string
  text: string
}

interface PromptSnippetsDialogProps {
  onInsertText: (text: string) => void
  onOpenChange: (open: boolean) => void
  open: boolean
  snippets: readonly PromptSnippet[]
}
