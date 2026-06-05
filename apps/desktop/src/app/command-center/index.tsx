import { useStore } from '@nanostores/react'
import { IconBookmark, IconBookmarkFilled, IconDownload, IconTrash } from '@tabler/icons-react'
import { type MouseEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { PageLoader } from '@/components/page-loader'
import { Button } from '@/components/ui/button'
import { SearchField } from '@/components/ui/search-field'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Tip } from '@/components/ui/tooltip'
import { getActionStatus, getLogs, getStatus, getUsageAnalytics, restartGateway, updateHermes } from '@/hermes'
import type { ActionStatusResponse, AnalyticsResponse, StatusResponse } from '@/hermes'
import { useAppCopy } from '@/i18n'
import { sessionTitle } from '@/lib/chat-runtime'
import { Activity, AlertCircle, BarChart3, type IconComponent, Pin } from '@/lib/icons'
import { exportSession } from '@/lib/session-export'
import { cn } from '@/lib/utils'
import { upsertDesktopActionTask } from '@/store/activity'
import { $pinnedSessionIds, pinSession, unpinSession } from '@/store/layout'
import { $sessions, sessionPinId } from '@/store/session'

import { useRefreshHotkey } from '../hooks/use-refresh-hotkey'
import { useRouteEnumParam } from '../hooks/use-route-enum-param'
import { OverlayMain, OverlayNavItem, OverlaySidebar, OverlaySplitLayout } from '../overlays/overlay-split-layout'
import { OverlayView } from '../overlays/overlay-view'

export type CommandCenterSection = 'sessions' | 'system' | 'usage'

const SECTIONS = ['sessions', 'system', 'usage'] as const satisfies readonly CommandCenterSection[]

const USAGE_PERIODS = [7, 30, 90] as const
type UsagePeriod = (typeof USAGE_PERIODS)[number]

interface CommandCenterViewProps {
  initialSection?: CommandCenterSection
  onClose: () => void
  onDeleteSession: (sessionId: string) => Promise<void>
  onOpenSession: (sessionId: string) => void
}

const SECTION_ICONS: Record<CommandCenterSection, IconComponent> = {
  sessions: Pin,
  system: Activity,
  usage: BarChart3
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

function formatTimestamp(value?: number | null): string {
  if (!value) {
    return ''
  }

  const date = new Date(value * 1000)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs)

    return () => window.clearTimeout(id)
  }, [delayMs, value])

  return debounced
}

function RowIconButton({
  children,
  className,
  onClick,
  title
}: {
  children: ReactNode
  className?: string
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  title: string
}) {
  return (
    <Tip label={title}>
      <Button
        aria-label={title}
        className={cn('text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground', className)}
        onClick={onClick}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        {children}
      </Button>
    </Tip>
  )
}

function EmptyPanel({ action, description, title }: { action?: ReactNode; description: string; title: string }) {
  return (
    <div className="grid min-h-48 place-items-center px-6 text-center">
      <div>
        <div className="text-[length:var(--conversation-text-font-size)] font-medium text-foreground">{title}</div>
        <div className="mt-1 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
          {description}
        </div>
        {action && <div className="mt-3 flex justify-center">{action}</div>}
      </div>
    </div>
  )
}

export function CommandCenterView({ initialSection, onClose, onDeleteSession, onOpenSession }: CommandCenterViewProps) {
  const copy = useAppCopy()
  const sessions = useStore($sessions)
  const pinnedSessionIds = useStore($pinnedSessionIds)

  const [section, setSection] = useRouteEnumParam('section', SECTIONS, initialSection ?? 'sessions')

  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [systemLoading, setSystemLoading] = useState(false)
  const [systemError, setSystemError] = useState('')
  const [systemAction, setSystemAction] = useState<ActionStatusResponse | null>(null)
  const [usagePeriod, setUsagePeriod] = useState<UsagePeriod>(30)
  const [usage, setUsage] = useState<AnalyticsResponse | null>(null)
  const [usageLoading, setUsageLoading] = useState(false)
  const [usageError, setUsageError] = useState('')
  const usageRequestRef = useRef(0)

  const debouncedQuery = useDebouncedValue(query.trim(), 180)

  const filteredSessions = useMemo(() => {
    const sorted = [...sessions].sort((a, b) => {
      const left = a.last_active || a.started_at || 0
      const right = b.last_active || b.started_at || 0

      return right - left
    })

    const needle = debouncedQuery.toLowerCase()

    if (!needle) {
      return sorted
    }

    return sorted.filter(session => {
      const haystack = `${sessionTitle(session)} ${session.id} ${session._lineage_root_id ?? ''}`.toLowerCase()

      return haystack.includes(needle)
    })
  }, [debouncedQuery, sessions])

  const refreshSystem = useCallback(async () => {
    setSystemLoading(true)
    setSystemError('')

    try {
      const [nextStatus, nextLogs] = await Promise.all([
        getStatus(),
        getLogs({
          file: 'agent',
          lines: 120
        })
      ])

      setStatus(nextStatus)
      setLogs(nextLogs.lines)
    } catch (error) {
      setSystemError(errorText(error))
    } finally {
      setSystemLoading(false)
    }
  }, [])

  const refreshUsage = useCallback(async (days: UsagePeriod) => {
    const requestId = usageRequestRef.current + 1
    usageRequestRef.current = requestId
    setUsageLoading(true)
    setUsageError('')

    try {
      const response = await getUsageAnalytics(days)

      if (usageRequestRef.current === requestId) {
        setUsage(response)
      }
    } catch (error) {
      if (usageRequestRef.current === requestId) {
        setUsageError(errorText(error))
      }
    } finally {
      if (usageRequestRef.current === requestId) {
        setUsageLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    if (section === 'system' && !status && !systemLoading) {
      void refreshSystem()
    }
  }, [refreshSystem, section, status, systemLoading])

  useEffect(() => {
    if (section === 'usage') {
      void refreshUsage(usagePeriod)
    }
  }, [refreshUsage, section, usagePeriod])

  useRefreshHotkey(() => {
    if (section === 'system') {
      void refreshSystem()
    } else if (section === 'usage') {
      void refreshUsage(usagePeriod)
    }
  })

  const sessionListHasResults = filteredSessions.length > 0

  const runSystemAction = useCallback(
    async (kind: 'restart' | 'update') => {
      setSystemError('')

      try {
        const started = kind === 'restart' ? await restartGateway() : await updateHermes()
        let nextStatus: ActionStatusResponse | null = null

        for (let attempt = 0; attempt < 18; attempt += 1) {
          await new Promise(resolve => window.setTimeout(resolve, 1200))
          const polled = await getActionStatus(started.name, 180)
          nextStatus = polled
          setSystemAction(polled)
          upsertDesktopActionTask(polled)

          if (!polled.running) {
            break
          }
        }

        if (!nextStatus) {
          const pendingStatus = {
            exit_code: null,
            lines: [copy.commandCenter.actionStartedWaiting],
            name: started.name,
            pid: started.pid,
            running: true
          }

          setSystemAction(pendingStatus)
          upsertDesktopActionTask(pendingStatus)
        }
      } catch (error) {
        setSystemError(errorText(error))
      } finally {
        void refreshSystem()
      }
    },
    [copy.commandCenter.actionStartedWaiting, refreshSystem]
  )

  return (
    <OverlayView closeLabel={copy.commandCenter.close} onClose={onClose}>
      <OverlaySplitLayout>
        <OverlaySidebar>
          {SECTIONS.map(value => (
            <OverlayNavItem
              active={section === value}
              icon={SECTION_ICONS[value]}
              key={value}
              label={
                value === 'sessions'
                  ? copy.common.sessions
                  : value === 'system'
                    ? copy.common.system
                    : copy.common.usage
              }
              onClick={() => setSection(value)}
            />
          ))}
        </OverlaySidebar>

        <OverlayMain>
          <header className="mb-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-[length:var(--conversation-text-font-size)] font-semibold text-foreground">
                {section === 'sessions'
                  ? copy.common.sessions
                  : section === 'system'
                    ? copy.common.system
                    : copy.common.usage}
              </h2>
              <p className="mt-0.5 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
                {copy.commandCenter.sectionDescriptions[section]}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {section === 'sessions' && sessions.length > 0 && (
                <SearchField
                  containerClassName="max-w-[40vw]"
                  onChange={next => setQuery(next)}
                  placeholder={copy.commandCenter.searchSessions}
                  value={query}
                />
              )}
              {section === 'usage' && (
                <SegmentedControl
                  onChange={id => setUsagePeriod(Number(id) as UsagePeriod)}
                  options={USAGE_PERIODS.map(value => ({ id: String(value), label: `${value}d` }))}
                  value={String(usagePeriod)}
                />
              )}
            </div>
          </header>

          {section === 'sessions' ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {!sessionListHasResults ? (
                <EmptyPanel
                  description={
                    debouncedQuery ? copy.commandCenter.noSessionsMatch : copy.commandCenter.noSessionsYetDescription
                  }
                  title={debouncedQuery ? copy.common.noMatches : copy.commandCenter.noSessionsYet}
                />
              ) : (
                <ul>
                  {filteredSessions.map(session => {
                    const pinId = sessionPinId(session)
                    const pinned = pinnedSessionIds.includes(pinId)

                    return (
                      <li className="group flex items-center gap-2 py-2" key={session.id}>
                        <button
                          className="min-w-0 flex-1 text-left"
                          onClick={() => onOpenSession(session.id)}
                          type="button"
                        >
                          <div className="truncate text-[length:var(--conversation-text-font-size)] font-medium text-foreground">
                            {sessionTitle(session)}
                          </div>
                          <div className="truncate text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
                            {formatTimestamp(session.last_active || session.started_at)}
                          </div>
                        </button>
                        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                          <RowIconButton
                            onClick={() => (pinned ? unpinSession(pinId) : pinSession(pinId))}
                            title={pinned ? copy.commandCenter.unpinSession : copy.commandCenter.pinSession}
                          >
                            {pinned ? (
                              <IconBookmarkFilled className="size-3.5" />
                            ) : (
                              <IconBookmark className="size-3.5" />
                            )}
                          </RowIconButton>
                          <RowIconButton
                            onClick={() => void exportSession(session.id, { session, title: sessionTitle(session) })}
                            title={copy.commandCenter.exportSession}
                          >
                            <IconDownload className="size-3.5" />
                          </RowIconButton>
                          <RowIconButton
                            className="hover:text-destructive"
                            onClick={() => void onDeleteSession(session.id)}
                            title={copy.commandCenter.deleteSession}
                          >
                            <IconTrash className="size-3.5" />
                          </RowIconButton>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          ) : section === 'usage' ? (
            <UsagePanel
              error={usageError}
              loading={usageLoading}
              onRefresh={() => void refreshUsage(usagePeriod)}
              period={usagePeriod}
              usage={usage}
            />
          ) : (
            <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-4">
              <div className="border-b border-(--ui-stroke-tertiary) pb-4">
                {status ? (
                  <div className="grid gap-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              'size-2 rounded-full',
                              status.gateway_running ? 'bg-emerald-500' : 'bg-amber-500'
                            )}
                          />
                          <span className="text-[length:var(--conversation-text-font-size)] font-medium text-foreground">
                            {status.gateway_running
                              ? copy.commandCenter.messagingGatewayRunning
                              : copy.commandCenter.messagingGatewayStopped}
                          </span>
                        </div>
                        <div className="mt-1 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
                          Hermes {status.version} · {copy.commandCenter.activeSessions} {status.active_sessions}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                        <Button onClick={() => void runSystemAction('restart')} size="xs" variant="text">
                          {copy.commandCenter.restartMessaging}
                        </Button>
                        <Button onClick={() => void runSystemAction('update')} size="xs" variant="textStrong">
                          {copy.commandCenter.updateHermes}
                        </Button>
                      </div>
                    </div>
                    {systemAction && (
                      <div className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
                        {systemAction.name} ·{' '}
                        {systemAction.running
                          ? copy.commandCenter.running
                          : systemAction.exit_code === 0
                            ? copy.commandCenter.done
                            : copy.commandCenter.failed}
                      </div>
                    )}
                  </div>
                ) : (
                  <PageLoader className="min-h-32" label={copy.commandCenter.loadingStatus} />
                )}
              </div>

              <div className="flex min-h-0 flex-col">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[0.625rem] font-medium uppercase tracking-[0.08em] text-(--ui-text-tertiary)">
                    {copy.commandCenter.recentLogs}
                  </span>
                  {systemError && (
                    <span className="inline-flex items-center gap-1 text-[length:var(--conversation-caption-font-size)] text-destructive">
                      <AlertCircle className="size-3.5" />
                      {systemError}
                    </span>
                  )}
                </div>
                <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap wrap-break-word rounded-lg border border-(--ui-stroke-tertiary) bg-(--ui-bg-quinary) p-3 font-mono text-[0.65rem] leading-relaxed text-(--ui-text-tertiary)">
                  {logs.length ? logs.join('\n') : copy.commandCenter.noLogsLoaded}
                </pre>
              </div>
            </div>
          )}
        </OverlayMain>
      </OverlaySplitLayout>
    </OverlayView>
  )
}

function formatTokens(value: null | number | undefined): string {
  const num = Number(value || 0)

  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`
  }

  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`
  }

  return num.toLocaleString()
}

function formatCost(value: null | number | undefined): string {
  const num = Number(value || 0)

  if (num === 0) {
    return '$0.00'
  }

  if (num < 0.01) {
    return '<$0.01'
  }

  return `$${num.toFixed(2)}`
}

function formatInteger(value: null | number | undefined): string {
  return Number(value ?? 0).toLocaleString()
}

interface UsagePanelProps {
  error: string
  loading: boolean
  onRefresh: () => void
  period: UsagePeriod
  usage: AnalyticsResponse | null
}

function UsagePanel({ error, loading, onRefresh, period, usage }: UsagePanelProps) {
  const copy = useAppCopy()
  const daily = useMemo(() => usage?.daily ?? [], [usage])
  const totals = usage?.totals
  const byModel = usage?.by_model ?? []
  const topSkills = usage?.skills?.top_skills ?? []

  const maxTokens = useMemo(() => {
    if (!daily.length) {
      return 1
    }

    return daily.reduce((acc, entry) => Math.max(acc, (entry.input_tokens || 0) + (entry.output_tokens || 0)), 1)
  }, [daily])

  if (!totals) {
    return (
      <div className="min-h-0 flex-1">
        {loading ? (
          <PageLoader className="min-h-48" label={copy.commandCenter.loadingUsage} />
        ) : (
          <EmptyPanel
            action={
              <Button onClick={onRefresh} size="xs" variant="outline">
                {copy.commandCenter.retry}
              </Button>
            }
            description={copy.commandCenter.noUsageDescription(period)}
            title={copy.commandCenter.noUsageYet}
          />
        )}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pb-2">
      {error && (
        <span className="inline-flex items-center gap-1 text-[length:var(--conversation-caption-font-size)] text-destructive">
          <AlertCircle className="size-3.5" />
          {error}
        </span>
      )}

      <div className="grid grid-cols-2 gap-x-4 gap-y-4 border-b border-(--ui-stroke-tertiary) pb-5 sm:grid-cols-4">
        <UsageStat label={copy.common.sessions} value={formatInteger(totals.total_sessions)} />
        <UsageStat label={copy.commandCenter.apiCalls} value={formatInteger(totals.total_api_calls)} />
        <UsageStat
          label={copy.commandCenter.tokensInOut}
          value={`${formatTokens(totals.total_input)} / ${formatTokens(totals.total_output)}`}
        />
        <UsageStat
          hint={
            totals.total_actual_cost > 0
              ? `${copy.commandCenter.actualCost} ${formatCost(totals.total_actual_cost)}`
              : undefined
          }
          label={copy.commandCenter.estimatedCost}
          value={formatCost(totals.total_estimated_cost)}
        />
      </div>

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-[0.625rem] font-medium uppercase tracking-[0.08em] text-(--ui-text-tertiary)">
            {copy.commandCenter.dailyTokens}
          </span>
          <span className="flex items-center gap-3 text-[0.65rem] text-(--ui-text-tertiary)">
            <span className="inline-flex items-center gap-1">
              <span className="size-2 rounded-[1px] bg-[color:var(--dt-primary)]/60" /> {copy.commandCenter.input}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="size-2 rounded-[1px] bg-emerald-500/70" /> {copy.commandCenter.output}
            </span>
          </span>
        </div>
        {daily.length === 0 ? (
          <div className="grid h-24 place-items-center text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
            {copy.commandCenter.noDailyActivity}
          </div>
        ) : (
          <>
            <div className="flex h-24 items-end gap-px">
              {daily.map(entry => {
                const inputH = Math.round(((entry.input_tokens || 0) / maxTokens) * 96)
                const outputH = Math.round(((entry.output_tokens || 0) / maxTokens) * 96)

                return (
                  <Tip
                    key={entry.day}
                    label={`${entry.day} · in ${formatTokens(entry.input_tokens)} · out ${formatTokens(entry.output_tokens)}`}
                  >
                    <div className="group relative flex h-24 min-w-0 flex-1 flex-col justify-end">
                      <div
                        className="w-full rounded-t-[1px] bg-[color:var(--dt-primary)]/50"
                        style={{ height: Math.max(inputH, entry.input_tokens > 0 ? 1 : 0) }}
                      />
                      <div
                        className="w-full bg-emerald-500/60"
                        style={{ height: Math.max(outputH, entry.output_tokens > 0 ? 1 : 0) }}
                      />
                    </div>
                  </Tip>
                )
              })}
            </div>
            <div className="mt-1 flex justify-between text-[0.6rem] text-(--ui-text-tertiary)">
              <span>{daily[0]?.day}</span>
              <span>{daily[daily.length - 1]?.day}</span>
            </div>
          </>
        )}
      </section>

      <div className="grid min-h-0 gap-x-8 gap-y-5 border-t border-(--ui-stroke-tertiary) pt-5 sm:grid-cols-2">
        <UsageList
          emptyLabel={copy.commandCenter.noModelUsage}
          rows={byModel.slice(0, 6).map(entry => ({
            key: entry.model,
            label: entry.model,
            value: `${formatTokens((entry.input_tokens || 0) + (entry.output_tokens || 0))} · ${formatCost(entry.estimated_cost)}`
          }))}
          title={copy.commandCenter.topModels}
        />
        <UsageList
          emptyLabel={copy.commandCenter.noSkillActivity}
          rows={topSkills.slice(0, 6).map(entry => ({
            key: entry.skill,
            label: entry.skill,
            value: copy.commandCenter.usageActions(entry.total_count)
          }))}
          title={copy.commandCenter.topSkills}
        />
      </div>
    </div>
  )
}

function UsageList({
  emptyLabel,
  rows,
  title
}: {
  emptyLabel: string
  rows: Array<{ key: string; label: string; value: string }>
  title: string
}) {
  return (
    <section className="min-w-0">
      <div className="mb-1.5 text-[0.625rem] font-medium uppercase tracking-[0.08em] text-(--ui-text-tertiary)">
        {title}
      </div>
      {rows.length === 0 ? (
        <div className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
          {emptyLabel}
        </div>
      ) : (
        <ul>
          {rows.map(row => (
            <li className="flex items-center justify-between gap-2 py-1.5" key={row.key}>
              <span className="min-w-0 truncate font-mono text-[0.7rem] text-foreground">{row.label}</span>
              <span className="shrink-0 text-[0.65rem] text-(--ui-text-tertiary)">{row.value}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function UsageStat({ hint, label, value }: { hint?: string; label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[0.625rem] font-medium uppercase tracking-[0.12em] text-(--ui-text-tertiary)">{label}</div>
      <div className="mt-1 truncate text-base font-semibold tracking-tight text-foreground">{value}</div>
      {hint && <div className="mt-0.5 truncate text-[0.62rem] text-(--ui-text-tertiary)">{hint}</div>}
    </div>
  )
}
