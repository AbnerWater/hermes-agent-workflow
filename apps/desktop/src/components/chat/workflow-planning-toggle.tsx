'use client'

import { useStore } from '@nanostores/react'

import { Switch } from '@/components/ui/switch'
import { workflowCopyFor } from '@/app/workflows/i18n'
import { $workflowLanguage } from '@/store/workflow-language'
import {
  $planningMode,
  enablePlanningMode,
  disablePlanningMode
} from '@/store/workflow-planning'

export function WorkflowPlanningToggle({ busy }: { busy: boolean }) {
  const planningMode = useStore($planningMode)
  const copy = workflowCopyFor(useStore($workflowLanguage))

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <label className="flex shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-full bg-background/35 px-2 py-1 text-foreground/85">
        <Switch
          checked={planningMode}
          disabled={busy}
          onCheckedChange={checked => (checked ? enablePlanningMode() : disablePlanningMode())}
          size="xs"
        />
        <span className="font-medium">{copy.workflowMode}</span>
      </label>
    </div>
  )
}
