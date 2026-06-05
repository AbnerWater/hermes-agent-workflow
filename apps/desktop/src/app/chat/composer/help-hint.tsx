import type { ReactNode } from 'react'

import { useAppCopy } from '@/i18n'

import { COMPLETION_DRAWER_CLASS } from './completion-drawer'

const COMMON_COMMANDS = [
  ['/help', 'help'],
  ['/clear', 'clear'],
  ['/resume', 'resume'],
  ['/details', 'details'],
  ['/copy', 'copy'],
  ['/quit', 'quit']
] as const

const HOTKEYS = [
  ['@', 'at'],
  ['/', 'slash'],
  ['?', 'question'],
  ['Enter', 'enter'],
  ['Cmd/Ctrl+K', 'queue'],
  ['Cmd/Ctrl+L', 'redraw'],
  ['Esc', 'escape'],
  ['↑ / ↓', 'arrows']
] as const

export function HelpHint() {
  const copy = useAppCopy().chat

  return (
    <div className={COMPLETION_DRAWER_CLASS} data-slot="composer-completion-drawer" data-state="open" role="dialog">
      <Section title={copy.helpCommonCommands}>
        {COMMON_COMMANDS.map(([key, descKey]) => (
          <Row description={copy.helpCommandDescriptions[descKey]} key={key} keyLabel={key} mono />
        ))}
      </Section>

      <Section title={copy.helpHotkeys}>
        {HOTKEYS.map(([key, descKey]) => (
          <Row description={copy.helpHotkeyDescriptions[descKey]} key={key} keyLabel={key} />
        ))}
      </Section>

      <p className="px-2.5 py-1 text-xs text-muted-foreground/80">{copy.helpFooter}</p>
    </div>
  )
}

function Section({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="grid gap-0.5 pt-0.5">
      <p className="px-2.5 pb-0.5 pt-1 text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground/75">
        {title}
      </p>
      {children}
    </div>
  )
}

function Row({ description, keyLabel, mono = false }: { description: string; keyLabel: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2 rounded-md px-2.5 py-1 text-xs">
      <span
        className={
          mono ? 'shrink-0 truncate font-mono font-medium text-foreground/85' : 'shrink-0 truncate text-foreground/85'
        }
      >
        {keyLabel}
      </span>
      <span className="min-w-0 truncate text-muted-foreground/80">{description}</span>
    </div>
  )
}
