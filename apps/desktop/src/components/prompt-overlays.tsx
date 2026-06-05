'use client'

import { useStore } from '@nanostores/react'
import { type FormEvent, useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useAppCopy } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { KeyRound, Loader2, Lock } from '@/lib/icons'
import { $gateway } from '@/store/gateway'
import { notifyError } from '@/store/notifications'
import { $secretRequest, $sudoRequest, clearSecretRequest, clearSudoRequest } from '@/store/prompts'

// Renders the modal mid-turn prompts the gateway raises and waits on: sudo
// password and skill secret capture. (Dangerous-command / execute_code approval
// is rendered INLINE on the pending tool row instead — see
// components/assistant-ui/tool-approval.tsx — so it reads like an inline "Run"
// affordance rather than a blocking modal.) Each Python-side caller blocks the
// agent thread until the matching `*.respond` RPC lands; without a renderer the
// agent stalls until its timeout and the tool is BLOCKED (the bug this fixes —
// desktop handled clarify.request but not these). Any close path (Esc, backdrop
// click) funnels through Radix's single `onOpenChange(false)` and maps to a
// refusal, so silence is never mistaken for consent, matching the TUI. We
// deliberately do NOT add onEscapeKeyDown / onInteractOutside handlers — they'd
// fire a second `*.respond` alongside onOpenChange (double-send) or block the
// backdrop-dismiss path.

function SudoDialog() {
  const appCopy = useAppCopy()
  const copy = appCopy.assistant
  const request = useStore($sudoRequest)
  const gateway = useStore($gateway)
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setPassword('')
    setSubmitting(false)
  }, [request?.requestId])

  const send = useCallback(
    async (value: string) => {
      if (!request) {
        return
      }

      if (!gateway) {
        notifyError(new Error(copy.approvalGatewayDisconnected), copy.couldNotSendSudoPassword)

        return
      }

      setSubmitting(true)

      try {
        await gateway.request<{ status?: string }>('sudo.respond', {
          password: value,
          request_id: request.requestId
        })
        triggerHaptic('submit')
        clearSudoRequest(request.sessionId, request.requestId)
      } catch (error) {
        notifyError(error, copy.couldNotSendSudoPassword)
        setSubmitting(false)
      }
    },
    [copy.approvalGatewayDisconnected, copy.couldNotSendSudoPassword, gateway, request]
  )

  // Cancel → empty password. The backend treats an empty sudo response as a
  // failed sudo (no command runs), so closing the dialog is a safe refusal.
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (!open && !submitting && request) {
        void send('')
      }
    },
    [request, send, submitting]
  )

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      void send(password)
    },
    [password, send]
  )

  if (!request) {
    return null
  }

  return (
    <Dialog onOpenChange={onOpenChange} open>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="size-4 text-primary" />
            {copy.administratorPassword}
          </DialogTitle>
          <DialogDescription>{copy.sudoDescription}</DialogDescription>
        </DialogHeader>

        <form className="grid gap-3" onSubmit={onSubmit}>
          <Input
            autoFocus
            disabled={submitting}
            onChange={event => setPassword(event.target.value)}
            placeholder={copy.sudoPasswordPlaceholder}
            type="password"
            value={password}
          />
          <DialogFooter>
            <Button disabled={submitting} onClick={() => void send('')} type="button" variant="ghost">
              {appCopy.common.cancel}
            </Button>
            <Button disabled={submitting} type="submit">
              {submitting ? <Loader2 className="size-3.5 animate-spin" /> : copy.send}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SecretDialog() {
  const appCopy = useAppCopy()
  const copy = appCopy.assistant
  const request = useStore($secretRequest)
  const gateway = useStore($gateway)
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setValue('')
    setSubmitting(false)
  }, [request?.requestId])

  const send = useCallback(
    async (secret: string) => {
      if (!request) {
        return
      }

      if (!gateway) {
        notifyError(new Error(copy.approvalGatewayDisconnected), copy.couldNotSendSecret)

        return
      }

      setSubmitting(true)

      try {
        await gateway.request<{ status?: string }>('secret.respond', {
          request_id: request.requestId,
          value: secret
        })
        triggerHaptic('submit')
        clearSecretRequest(request.sessionId, request.requestId)
      } catch (error) {
        notifyError(error, copy.couldNotSendSecret)
        setSubmitting(false)
      }
    },
    [copy.approvalGatewayDisconnected, copy.couldNotSendSecret, gateway, request]
  )

  const onOpenChange = useCallback(
    (open: boolean) => {
      if (!open && !submitting && request) {
        void send('')
      }
    },
    [request, send, submitting]
  )

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      void send(value)
    },
    [send, value]
  )

  if (!request) {
    return null
  }

  return (
    <Dialog onOpenChange={onOpenChange} open>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-primary" />
            {request.envVar || copy.secretRequired}
          </DialogTitle>
          <DialogDescription>{request.prompt || copy.secretDescription}</DialogDescription>
        </DialogHeader>

        <form className="grid gap-3" onSubmit={onSubmit}>
          <Input
            autoFocus
            disabled={submitting}
            onChange={event => setValue(event.target.value)}
            placeholder={request.envVar || copy.secretValuePlaceholder}
            type="password"
            value={value}
          />
          <DialogFooter>
            <Button disabled={submitting} onClick={() => void send('')} type="button" variant="ghost">
              {appCopy.common.cancel}
            </Button>
            <Button disabled={submitting || !value} type="submit">
              {submitting ? <Loader2 className="size-3.5 animate-spin" /> : copy.send}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function PromptOverlays() {
  return (
    <>
      <SudoDialog />
      <SecretDialog />
    </>
  )
}
