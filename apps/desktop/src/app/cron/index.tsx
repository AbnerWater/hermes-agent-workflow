import { useCallback, useEffect, useMemo, useState } from 'react'

import { PageLoader } from '@/components/page-loader'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { SearchField } from '@/components/ui/search-field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  createCronJob,
  type CronJob,
  deleteCronJob,
  getCronJobs,
  pauseCronJob,
  resumeCronJob,
  triggerCronJob,
  updateCronJob
} from '@/hermes'
import { useAppCopy } from '@/i18n'
import { AlertTriangle, Clock } from '@/lib/icons'
import { notify, notifyError } from '@/store/notifications'

import { useRefreshHotkey } from '../hooks/use-refresh-hotkey'
import { OverlayView } from '../overlays/overlay-view'

import { CronJobActionsMenu, CronJobActionsTrigger } from './cron-job-actions-menu'

const DEFAULT_DELIVER = 'local'
type CronCopy = ReturnType<typeof useAppCopy>['cron']

const DELIVERY_OPTIONS: ReadonlyArray<{ label: string; value: string }> = [
  { label: 'This desktop', value: 'local' },
  { label: 'Telegram', value: 'telegram' },
  { label: 'Discord', value: 'discord' },
  { label: 'Slack', value: 'slack' },
  { label: 'Email', value: 'email' }
]

const SCHEDULE_OPTIONS: ReadonlyArray<ScheduleOption> = [
  {
    expr: '0 9 * * *',
    hint: 'Every day at 9:00 AM',
    label: 'Daily',
    value: 'daily'
  },
  {
    expr: '0 9 * * 1-5',
    hint: 'Monday through Friday at 9:00 AM',
    label: 'Weekdays',
    value: 'weekdays'
  },
  {
    expr: '0 9 * * 1',
    hint: 'Every Monday at 9:00 AM',
    label: 'Weekly',
    value: 'weekly'
  },
  {
    expr: '0 9 1 * *',
    hint: 'The first day of each month at 9:00 AM',
    label: 'Monthly',
    value: 'monthly'
  },
  {
    expr: '0 * * * *',
    hint: 'At the top of every hour',
    label: 'Hourly',
    value: 'hourly'
  },
  {
    expr: '*/15 * * * *',
    hint: 'Every 15 minutes',
    label: 'Every 15 minutes',
    value: 'every-15-minutes'
  },
  {
    hint: 'Cron syntax or natural language',
    label: 'Custom',
    value: 'custom'
  }
]

const STATE_VARIANT: Record<string, BadgeProps['variant']> = {
  enabled: 'default',
  scheduled: 'default',
  running: 'default',
  paused: 'warn',
  disabled: 'muted',
  error: 'destructive',
  completed: 'muted'
}

const asText = (value: unknown): string => (typeof value === 'string' ? value : '')

const truncate = (value: string, max = 80): string => (value.length > max ? `${value.slice(0, max)}…` : value)

function jobName(job: CronJob): string {
  return asText(job.name).trim()
}

function jobPrompt(job: CronJob): string {
  return asText(job.prompt)
}

function jobTitle(job: CronJob, copy: CronCopy): string {
  const name = jobName(job)

  if (name) {
    return name
  }

  const prompt = jobPrompt(job)

  if (prompt) {
    return truncate(prompt, 60)
  }

  const script = asText(job.script)

  if (script) {
    return truncate(script, 60)
  }

  return job.id || copy.fallbackJobTitle
}

function jobScheduleDisplay(job: CronJob): string {
  return asText(job.schedule_display) || asText(job.schedule?.display) || asText(job.schedule?.expr) || '—'
}

function jobScheduleExpr(job: CronJob): string {
  return asText(job.schedule?.expr) || asText(job.schedule_display) || ''
}

function jobState(job: CronJob): string {
  return asText(job.state) || (job.enabled === false ? 'disabled' : 'scheduled')
}

function jobDeliver(job: CronJob): string {
  return asText(job.deliver) || DEFAULT_DELIVER
}

function cronParts(expr: string): null | string[] {
  const parts = expr.trim().replace(/\s+/g, ' ').split(' ')

  return parts.length === 5 ? parts : null
}

function dayName(copy: CronCopy, value: string): string {
  return copy.dayName(value)
}

function formatCronTime(minute: string, hour: string): string {
  const numericHour = Number(hour)
  const numericMinute = Number(minute)

  if (!Number.isInteger(numericHour) || !Number.isInteger(numericMinute)) {
    return `${hour}:${minute}`
  }

  return new Date(2000, 0, 1, numericHour, numericMinute).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  })
}

function isIntegerToken(value: string): boolean {
  return /^\d+$/.test(value)
}

function scheduleOptionForExpr(expr: string): ScheduleOption {
  const normalized = expr.trim().replace(/\s+/g, ' ')
  const exactMatch = SCHEDULE_OPTIONS.find(option => option.expr === normalized)

  if (exactMatch) {
    return exactMatch
  }

  const parts = cronParts(normalized)

  if (!parts) {
    return SCHEDULE_OPTIONS[SCHEDULE_OPTIONS.length - 1]
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*' && isIntegerToken(minute) && isIntegerToken(hour)) {
    return SCHEDULE_OPTIONS.find(option => option.value === 'daily') ?? SCHEDULE_OPTIONS[0]
  }

  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '1-5' && isIntegerToken(minute) && isIntegerToken(hour)) {
    return SCHEDULE_OPTIONS.find(option => option.value === 'weekdays') ?? SCHEDULE_OPTIONS[0]
  }

  if (
    dayOfMonth === '*' &&
    month === '*' &&
    isIntegerToken(dayOfWeek) &&
    isIntegerToken(minute) &&
    isIntegerToken(hour)
  ) {
    return SCHEDULE_OPTIONS.find(option => option.value === 'weekly') ?? SCHEDULE_OPTIONS[0]
  }

  if (
    month === '*' &&
    dayOfWeek === '*' &&
    isIntegerToken(dayOfMonth) &&
    isIntegerToken(minute) &&
    isIntegerToken(hour)
  ) {
    return SCHEDULE_OPTIONS.find(option => option.value === 'monthly') ?? SCHEDULE_OPTIONS[0]
  }

  if (hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*' && isIntegerToken(minute)) {
    return SCHEDULE_OPTIONS.find(option => option.value === 'hourly') ?? SCHEDULE_OPTIONS[0]
  }

  if (normalized === '*/15 * * * *') {
    return SCHEDULE_OPTIONS.find(option => option.value === 'every-15-minutes') ?? SCHEDULE_OPTIONS[0]
  }

  return SCHEDULE_OPTIONS[SCHEDULE_OPTIONS.length - 1]
}

function scheduleHint(copy: CronCopy, value: string): string {
  switch (value) {
    case 'daily':
      return copy.schedules.daily.hint

    case 'weekdays':
      return copy.schedules.weekdays.hint

    case 'weekly':
      return copy.schedules.weekly.hint

    case 'monthly':
      return copy.schedules.monthly.hint

    case 'hourly':
      return copy.schedules.hourly.hint

    case 'every-15-minutes':
      return copy.schedules.every15Minutes.hint

    default:
      return copy.schedules.custom.hint
  }
}

function scheduleLabel(copy: CronCopy, value: string): string {
  switch (value) {
    case 'daily':
      return copy.schedules.daily.label

    case 'weekdays':
      return copy.schedules.weekdays.label

    case 'weekly':
      return copy.schedules.weekly.label

    case 'monthly':
      return copy.schedules.monthly.label

    case 'hourly':
      return copy.schedules.hourly.label

    case 'every-15-minutes':
      return copy.schedules.every15Minutes.label

    default:
      return copy.schedules.custom.label
  }
}

function deliveryLabel(copy: CronCopy, value: string): string {
  switch (value) {
    case 'local':
      return copy.delivery.local

    case 'telegram':
      return copy.delivery.telegram

    case 'discord':
      return copy.delivery.discord

    case 'slack':
      return copy.delivery.slack

    case 'email':
      return copy.delivery.email

    default:
      return value
  }
}

function scheduleSummary(copy: CronCopy, option: ScheduleOption, expr: string): string {
  const parts = cronParts(expr)

  if (!parts) {
    return scheduleHint(copy, option.value)
  }

  const [minute, hour, dayOfMonth, , dayOfWeek] = parts

  if (option.value === 'daily') {
    return copy.everyDayAt(formatCronTime(minute, hour))
  }

  if (option.value === 'weekdays') {
    return copy.weekdaysAt(formatCronTime(minute, hour))
  }

  if (option.value === 'weekly') {
    return copy.everyDayNameAt(dayName(copy, dayOfWeek), formatCronTime(minute, hour))
  }

  if (option.value === 'monthly') {
    return copy.monthlyOnDayAt(dayOfMonth, formatCronTime(minute, hour))
  }

  if (option.value === 'hourly') {
    return minute === '0' ? copy.topOfEveryHour : copy.everyHourAt(minute.padStart(2, '0'))
  }

  return scheduleHint(copy, option.value)
}

function formatTime(iso?: null | string): string {
  if (!iso) {
    return '—'
  }

  const date = new Date(iso)

  if (Number.isNaN(date.valueOf())) {
    return iso
  }

  return date.toLocaleString()
}

function matchesQuery(job: CronJob, q: string, copy: CronCopy): boolean {
  if (!q) {
    return true
  }

  const needle = q.toLowerCase()

  return [jobTitle(job, copy), jobPrompt(job), jobScheduleDisplay(job), jobScheduleExpr(job), jobDeliver(job)].some(
    value => value.toLowerCase().includes(needle)
  )
}

interface CronViewProps {
  onClose: () => void
}

export function CronView({ onClose }: CronViewProps) {
  const appCopy = useAppCopy()
  const copy = appCopy.cron
  const [jobs, setJobs] = useState<CronJob[] | null>(null)
  const [query, setQuery] = useState('')
  const [busyJobId, setBusyJobId] = useState<null | string>(null)

  const [editor, setEditor] = useState<EditorState>({ mode: 'closed' })
  const [pendingDelete, setPendingDelete] = useState<CronJob | null>(null)

  const refresh = useCallback(async () => {
    try {
      const result = await getCronJobs()
      setJobs(result)
    } catch (err) {
      notifyError(err, copy.failedLoadJobs)
    }
  }, [copy.failedLoadJobs])

  useRefreshHotkey(refresh)

  useEffect(() => {
    void refresh()
  }, [refresh])

  const visibleJobs = useMemo(() => {
    if (!jobs) {
      return []
    }

    return jobs
      .filter(job => matchesQuery(job, query.trim(), copy))
      .sort((a, b) => jobTitle(a, copy).localeCompare(jobTitle(b, copy)))
  }, [copy, jobs, query])

  const enabledCount = jobs?.filter(job => job.enabled).length ?? 0
  const totalCount = jobs?.length ?? 0

  async function handlePauseResume(job: CronJob) {
    setBusyJobId(job.id)

    try {
      const isPaused = jobState(job) === 'paused'
      const updated = isPaused ? await resumeCronJob(job.id) : await pauseCronJob(job.id)
      setJobs(current => (current ? current.map(row => (row.id === job.id ? updated : row)) : current))
      notify({
        kind: 'success',
        title: isPaused ? copy.resumed : copy.paused,
        message: truncate(jobTitle(job, copy), 60)
      })
    } catch (err) {
      notifyError(err, copy.failedUpdateJob)
    } finally {
      setBusyJobId(null)
    }
  }

  async function handleTrigger(job: CronJob) {
    setBusyJobId(job.id)

    try {
      const updated = await triggerCronJob(job.id)
      setJobs(current => (current ? current.map(row => (row.id === job.id ? updated : row)) : current))
      notify({ kind: 'success', title: copy.triggered, message: truncate(jobTitle(job, copy), 60) })
    } catch (err) {
      notifyError(err, copy.failedTriggerJob)
    } finally {
      setBusyJobId(null)
    }
  }

  async function handleEditorSave(values: EditorValues) {
    if (editor.mode === 'create') {
      const created = await createCronJob({
        prompt: values.prompt,
        schedule: values.schedule,
        name: values.name || undefined,
        deliver: values.deliver || DEFAULT_DELIVER
      })

      setJobs(current => (current ? [...current, created] : [created]))
      notify({ kind: 'success', title: copy.created, message: truncate(jobTitle(created, copy), 60) })
    } else if (editor.mode === 'edit') {
      const updated = await updateCronJob(editor.job.id, {
        prompt: values.prompt,
        schedule: values.schedule,
        name: values.name,
        deliver: values.deliver
      })

      setJobs(current => (current ? current.map(row => (row.id === updated.id ? updated : row)) : current))
      notify({ kind: 'success', title: copy.updated, message: truncate(jobTitle(updated, copy), 60) })
    }

    setEditor({ mode: 'closed' })
  }

  return (
    <OverlayView closeLabel={copy.closeCron} onClose={onClose}>
      <div className="flex min-h-0 flex-1 flex-col pt-[calc(var(--titlebar-height)+0.5rem)]">
        {totalCount > 0 && (
          <div className="mx-auto flex w-full max-w-4xl items-center gap-2 px-4 pb-2">
            <SearchField
              containerClassName="max-w-[60vw]"
              onChange={setQuery}
              placeholder={copy.searchPlaceholder}
              value={query}
            />
          </div>
        )}
        {!jobs ? (
          <PageLoader label={copy.loadingJobs} />
        ) : visibleJobs.length === 0 ? (
          // Empty state owns the primary "create" CTA — we used to also have
          // one in the filters bar but it was redundant. Only show the button
          // when there are zero jobs total; the search-empty case ("No
          // matches") just asks the user to broaden their query.
          <EmptyState
            actionLabel={totalCount === 0 ? copy.createFirst : undefined}
            description={totalCount === 0 ? copy.emptyDescription : copy.noMatchesDescription}
            onAction={totalCount === 0 ? () => setEditor({ mode: 'create' }) : undefined}
            title={totalCount === 0 ? copy.emptyTitle : copy.noMatches}
          />
        ) : (
          <div className="mx-auto w-full max-w-4xl min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {/* Inline header replaces the old top-bar "New cron" button. We
                still need a single, always-visible affordance to add a job
                when the list is non-empty (rows themselves only expose
                edit/pause/trigger/delete). */}
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">
                {copy.activeCount(enabledCount, totalCount)}
              </span>
              <Button onClick={() => setEditor({ mode: 'create' })} size="sm">
                <Codicon name="add" />
                {copy.newCron}
              </Button>
            </div>
            <div>
              {visibleJobs.map(job => (
                <CronJobRow
                  busy={busyJobId === job.id}
                  copy={copy}
                  job={job}
                  key={job.id}
                  onDelete={() => setPendingDelete(job)}
                  onEdit={() => setEditor({ mode: 'edit', job })}
                  onPauseResume={() => void handlePauseResume(job)}
                  onTrigger={() => void handleTrigger(job)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
      <CronEditorDialog
        appCopy={appCopy}
        copy={copy}
        editor={editor}
        onClose={() => setEditor({ mode: 'closed' })}
        onSave={handleEditorSave}
      />

      <ConfirmDialog
        busyLabel={copy.deleteBusy}
        confirmLabel={copy.deleteConfirm}
        description={pendingDelete ? copy.deleteDescription(truncate(jobTitle(pendingDelete, copy), 60)) : null}
        destructive
        doneLabel={copy.deletedDone}
        onClose={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (!pendingDelete) {
            return
          }

          await deleteCronJob(pendingDelete.id)
          setJobs(current => (current ? current.filter(row => row.id !== pendingDelete.id) : current))
          notify({ kind: 'success', message: truncate(jobTitle(pendingDelete, copy), 60), title: copy.deleted })
        }}
        open={pendingDelete !== null}
        title={copy.deleteTitle}
      />
    </OverlayView>
  )
}

function CronJobRow({
  busy,
  copy,
  job,
  onDelete,
  onEdit,
  onPauseResume,
  onTrigger
}: {
  busy: boolean
  copy: CronCopy
  job: CronJob
  onDelete: () => void
  onEdit: () => void
  onPauseResume: () => void
  onTrigger: () => void
}) {
  const state = jobState(job)
  const isPaused = state === 'paused'
  const hasName = Boolean(jobName(job))
  const prompt = jobPrompt(job)
  const deliver = jobDeliver(job)

  return (
    <div className="grid gap-3 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
      <button
        className="min-w-0 rounded-md text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        onClick={onEdit}
        type="button"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{jobTitle(job, copy)}</span>
          <Badge className="capitalize" variant={STATE_VARIANT[state] ?? 'muted'}>
            {state}
          </Badge>
          {deliver && deliver !== DEFAULT_DELIVER && (
            <Badge className="capitalize" variant="muted">
              {deliver}
            </Badge>
          )}
        </div>
        {hasName && prompt && <p className="mt-1 truncate text-xs text-muted-foreground">{truncate(prompt, 120)}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.68rem] text-muted-foreground">
          <span className="inline-flex items-center gap-1 font-mono">
            <Clock className="size-3" />
            {jobScheduleDisplay(job)}
          </span>
          <span>{copy.lastRun(formatTime(job.last_run_at))}</span>
          <span>{copy.nextRun(formatTime(job.next_run_at))}</span>
        </div>
        {job.last_error && (
          <p className="mt-1 inline-flex items-start gap-1 text-[0.68rem] text-destructive">
            <AlertTriangle className="mt-px size-3 shrink-0" />
            <span className="line-clamp-2">{job.last_error}</span>
          </p>
        )}
      </button>

      <div className="flex shrink-0 items-center">
        <CronJobActionsMenu
          busy={busy}
          copy={copy}
          isPaused={isPaused}
          onDelete={onDelete}
          onEdit={onEdit}
          onPauseResume={onPauseResume}
          onTrigger={onTrigger}
          title={jobTitle(job, copy)}
        >
          <CronJobActionsTrigger
            className="text-muted-foreground hover:text-foreground"
            copy={copy}
            onClick={event => event.stopPropagation()}
            title={jobTitle(job, copy)}
          />
        </CronJobActionsMenu>
      </div>
    </div>
  )
}

function EmptyState({
  actionLabel,
  description,
  onAction,
  title
}: {
  actionLabel?: string
  description: string
  onAction?: () => void
  title: string
}) {
  return (
    <div className="grid h-full place-items-center px-6 py-12 text-center">
      <div className="max-w-sm space-y-2">
        <div className="text-sm font-medium">{title}</div>
        <p className="text-xs text-muted-foreground">{description}</p>
        {actionLabel && onAction && (
          <Button className="mt-2" onClick={onAction} size="sm">
            <Codicon name="add" />
            {actionLabel}
          </Button>
        )}
      </div>
    </div>
  )
}

function CronEditorDialog({
  appCopy,
  copy,
  editor,
  onClose,
  onSave
}: {
  appCopy: ReturnType<typeof useAppCopy>
  copy: CronCopy
  editor: EditorState
  onClose: () => void
  onSave: (values: EditorValues) => Promise<void>
}) {
  const open = editor.mode !== 'closed'
  const isEdit = editor.mode === 'edit'
  const initial = isEdit ? editor.job : null

  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [schedule, setSchedule] = useState('')
  const [schedulePreset, setSchedulePreset] = useState('daily')
  const [deliver, setDeliver] = useState(DEFAULT_DELIVER)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<null | string>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    setName(initial ? jobName(initial) : '')
    setPrompt(initial ? jobPrompt(initial) : '')
    setSchedule(initial ? jobScheduleExpr(initial) : (SCHEDULE_OPTIONS[0].expr ?? ''))
    setSchedulePreset(initial ? scheduleOptionForExpr(jobScheduleExpr(initial)).value : 'daily')
    setDeliver(initial ? jobDeliver(initial) : DEFAULT_DELIVER)
    setError(null)
    setSaving(false)
  }, [initial, open])

  const selectedScheduleOption =
    SCHEDULE_OPTIONS.find(candidate => candidate.value === schedulePreset) ?? SCHEDULE_OPTIONS[0]

  function handleSchedulePresetChange(nextPreset: string) {
    setSchedulePreset(nextPreset)
    setError(null)

    const option = SCHEDULE_OPTIONS.find(candidate => candidate.value === nextPreset)

    if (option?.expr) {
      setSchedule(option.expr)
    } else if (scheduleOptionForExpr(schedule).value !== 'custom') {
      setSchedule('')
    }
  }

  const resolvedScheduleHint = scheduleSummary(copy, selectedScheduleOption, schedule)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const trimmedPrompt = prompt.trim()
    const trimmedSchedule = schedule.trim()

    if (!trimmedPrompt || !trimmedSchedule) {
      setError(copy.promptAndScheduleRequired)

      return
    }

    setSaving(true)
    setError(null)

    try {
      await onSave({
        deliver,
        name: name.trim(),
        prompt: trimmedPrompt,
        schedule: trimmedSchedule
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.failedSaveJob)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog onOpenChange={value => !value && !saving && onClose()} open={open}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? copy.editTitle : copy.createTitle}</DialogTitle>
          <DialogDescription>{isEdit ? copy.editDescription : copy.createDescription}</DialogDescription>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <Field htmlFor="cron-name" label={copy.name} optional optionalLabel={copy.optional}>
            <Input
              autoFocus
              id="cron-name"
              onChange={event => setName(event.target.value)}
              placeholder={copy.namePlaceholder}
              value={name}
            />
          </Field>

          <Field htmlFor="cron-prompt" label={copy.prompt}>
            <Textarea
              className="min-h-24 font-mono"
              id="cron-prompt"
              onChange={event => setPrompt(event.target.value)}
              placeholder={copy.promptPlaceholder}
              value={prompt}
            />
          </Field>

          <div className="grid items-start gap-4 sm:grid-cols-2">
            <Field htmlFor="cron-frequency" label={copy.frequency}>
              <Select onValueChange={handleSchedulePresetChange} value={schedulePreset}>
                <SelectTrigger id="cron-frequency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCHEDULE_OPTIONS.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {scheduleLabel(copy, option.value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field htmlFor="cron-deliver" label={copy.deliverTo}>
              <Select onValueChange={setDeliver} value={deliver}>
                <SelectTrigger id="cron-deliver">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DELIVERY_OPTIONS.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {deliveryLabel(copy, option.value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {schedulePreset === 'custom' ? (
            <Field htmlFor="cron-schedule" label={copy.customSchedule}>
              <Input
                className="font-mono"
                id="cron-schedule"
                onChange={event => setSchedule(event.target.value)}
                placeholder={copy.customSchedulePlaceholder}
                value={schedule}
              />
              <FieldHint>{copy.customScheduleHint}</FieldHint>
            </Field>
          ) : (
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-medium text-foreground">{resolvedScheduleHint}</span>
                <span className="font-mono text-muted-foreground">{schedule}</span>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <DialogFooter>
            <Button disabled={saving} onClick={onClose} type="button" variant="outline">
              {appCopy.common.cancel}
            </Button>
            <Button disabled={saving} type="submit">
              {saving ? copy.saving : isEdit ? copy.saveChanges : copy.createCron}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  children,
  htmlFor,
  label,
  optional,
  optionalLabel
}: {
  children: React.ReactNode
  htmlFor: string
  label: string
  optional?: boolean
  optionalLabel?: string
}) {
  return (
    <div className="grid gap-1.5">
      <label className="flex items-baseline gap-2 text-xs font-medium text-foreground" htmlFor={htmlFor}>
        {label}
        {optional && optionalLabel && (
          <span className="text-[0.65rem] font-normal text-muted-foreground">{optionalLabel}</span>
        )}
      </label>
      {children}
    </div>
  )
}

function FieldHint({ children }: { children: React.ReactNode }) {
  return <p className="text-[0.66rem] leading-4 text-muted-foreground">{children}</p>
}

type EditorState = { mode: 'closed' } | { mode: 'create' } | { job: CronJob; mode: 'edit' }

interface EditorValues {
  deliver: string
  name: string
  prompt: string
  schedule: string
}

interface ScheduleOption {
  expr?: string
  hint: string
  label: string
  value: string
}
