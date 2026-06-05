import type * as React from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { useAppCopy } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'

type CronCopy = ReturnType<typeof useAppCopy>['cron']

interface CronJobActions {
  busy?: boolean
  copy: CronCopy
  isPaused: boolean
  title: string
  onDelete: () => void
  onEdit: () => void
  onPauseResume: () => void
  onTrigger: () => void
}

interface CronJobActionsMenuProps
  extends CronJobActions, Pick<React.ComponentProps<typeof DropdownMenuContent>, 'align' | 'sideOffset'> {
  children: React.ReactNode
}

export function CronJobActionsMenu({
  align = 'end',
  busy = false,
  children,
  copy,
  isPaused,
  onDelete,
  onEdit,
  onPauseResume,
  onTrigger,
  sideOffset = 6,
  title
}: CronJobActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} aria-label={copy.actionsFor(title)} className="w-44" sideOffset={sideOffset}>
        <DropdownMenuItem
          disabled={busy}
          onSelect={() => {
            triggerHaptic('selection')
            onPauseResume()
          }}
        >
          <Codicon name={isPaused ? 'play' : 'debug-pause'} size="0.875rem" />
          <span>{isPaused ? copy.resume : copy.pause}</span>
        </DropdownMenuItem>

        <DropdownMenuItem
          disabled={busy}
          onSelect={() => {
            triggerHaptic('selection')
            onTrigger()
          }}
        >
          <Codicon name="zap" size="0.875rem" />
          <span>{copy.triggerNow}</span>
        </DropdownMenuItem>

        <DropdownMenuItem
          onSelect={() => {
            triggerHaptic('selection')
            onEdit()
          }}
        >
          <Codicon name="edit" size="0.875rem" />
          <span>{copy.edit}</span>
        </DropdownMenuItem>

        <DropdownMenuItem
          onSelect={() => {
            triggerHaptic('warning')
            onDelete()
          }}
          variant="destructive"
        >
          <Codicon name="trash" size="0.875rem" />
          <span>{copy.delete}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface CronJobActionsTriggerProps extends Omit<React.ComponentProps<typeof Button>, 'size' | 'variant'> {
  copy: CronCopy
  title: string
}

export function CronJobActionsTrigger({ className, copy, title, ...props }: CronJobActionsTriggerProps) {
  return (
    <Button
      aria-label={copy.actionsFor(title)}
      className={className}
      size="icon-sm"
      title={copy.actionsTitle}
      variant="ghost"
      {...props}
    >
      <Codicon className="text-muted-foreground" name="ellipsis" size="0.875rem" />
    </Button>
  )
}
