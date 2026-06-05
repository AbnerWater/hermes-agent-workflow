import { useEffect, useState } from 'react'

import { ActionStatus } from '@/components/ui/action-status'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { createProfile, updateProfileSoul } from '@/hermes'
import { useAppCopy } from '@/i18n'
import { AlertTriangle } from '@/lib/icons'
import { cn } from '@/lib/utils'

const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

export const PROFILE_NAME_HINT =
  'Lowercase letters, digits, hyphens, and underscores. Must start with a letter or digit.'

export function isValidProfileName(name: string): boolean {
  return PROFILE_NAME_RE.test(name.trim())
}

// Self-contained create flow (name + clone toggle + optional SOUL.md). Owns the
// createProfile/updateProfileSoul calls so every caller just refreshes/selects
// via onCreated. SOUL left blank keeps the cloned/blank persona untouched.
export function CreateProfileDialog({
  onClose,
  onCreated,
  open
}: {
  onClose: () => void
  onCreated?: (name: string) => Promise<void> | void
  open: boolean
}) {
  const appCopy = useAppCopy()
  const copy = appCopy.profiles
  const [name, setName] = useState('')
  const [cloneFromDefault, setCloneFromDefault] = useState(true)
  const [soul, setSoul] = useState('')
  const [status, setStatus] = useState<'done' | 'idle' | 'saving'>('idle')
  const [error, setError] = useState<null | string>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    setName('')
    setCloneFromDefault(true)
    setSoul('')
    setError(null)
    setStatus('idle')
  }, [open])

  const trimmed = name.trim()
  const invalid = trimmed !== '' && !isValidProfileName(trimmed)
  const busy = status === 'saving' || status === 'done'

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()

    if (!trimmed || invalid) {
      setError(invalid ? copy.invalidName(copy.nameHint) : copy.nameRequired)

      return
    }

    setStatus('saving')
    setError(null)

    try {
      await createProfile({ name: trimmed, clone_from_default: cloneFromDefault })

      if (soul.trim()) {
        await updateProfileSoul(trimmed, soul)
      }

      await onCreated?.(trimmed)
      setStatus('done')
      window.setTimeout(onClose, 800)
    } catch (err) {
      setStatus('idle')
      setError(err instanceof Error ? err.message : copy.failedCreate)
    }
  }

  return (
    <Dialog onOpenChange={value => !value && !busy && onClose()} open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.createTitle}</DialogTitle>
          <DialogDescription>{copy.createDescription}</DialogDescription>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-1.5">
            <label className="text-xs font-medium" htmlFor="new-profile-name">
              {copy.name}
            </label>
            <Input
              aria-invalid={invalid}
              autoFocus
              id="new-profile-name"
              onChange={event => setName(event.target.value)}
              placeholder="my-profile"
              value={name}
            />
            <p className={cn('text-[0.66rem] leading-4', invalid ? 'text-destructive' : 'text-muted-foreground')}>
              {copy.nameHint}
            </p>
          </div>

          <label className="flex cursor-pointer select-none items-start gap-2.5 px-0.5 py-1">
            <Checkbox
              checked={cloneFromDefault}
              className="mt-0.5 shrink-0"
              onCheckedChange={checked => setCloneFromDefault(checked === true)}
            />
            <span className="grid gap-0.5 leading-snug">
              <span className="text-sm font-medium">{copy.cloneFromDefault}</span>
              <span className="text-xs text-muted-foreground">{copy.cloneDescription}</span>
            </span>
          </label>

          <div className="grid gap-1.5">
            <label className="text-xs font-medium" htmlFor="new-profile-soul">
              SOUL.md <span className="font-normal text-muted-foreground">- {copy.optional}</span>
            </label>
            <Textarea
              className="min-h-28 font-mono text-xs leading-5"
              id="new-profile-soul"
              onChange={event => setSoul(event.target.value)}
              placeholder={copy.soulPlaceholder(cloneFromDefault ? 'cloned' : 'empty')}
              value={soul}
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <DialogFooter>
            <Button disabled={busy} onClick={onClose} type="button" variant="ghost">
              {appCopy.common.cancel}
            </Button>
            <Button disabled={busy || !trimmed || invalid} type="submit">
              <ActionStatus busy={copy.creating} done={copy.created} idle={copy.createProfile} state={status} />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
