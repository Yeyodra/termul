import { Circle } from '@/components/icons'
import { STATUS_BAR_ITEM_CLASS } from '@/components/status-bar-hit'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useRobloxStudioStatus } from '@/hooks/use-roblox-studio-status'
import { ROBLOX_PROJECT_NAME } from '@/lib/roblox-studio-mcp'
import { cn } from '@/lib/utils'
import type { Project } from '@/types/project'

/**
 * The lamp's three states. `docs/design/status.md` allows `success` for a
 * connected lamp (the SSH host lamp uses it); `connection` is the cyan role and
 * reads as a generic live channel, not as "Roblox is up".
 */
const LAMP_TONE_CLASS = {
  connected: 'text-success fill-current',
  running: 'text-muted-foreground fill-current',
  stopped: 'text-muted-foreground/50 fill-current'
} as const

const STATE_LABEL = {
  connected: 'Roblox Studio connected',
  running: 'Roblox Studio is open — load a place to connect',
  stopped: 'Roblox Studio is not running'
} as const

/** Visible text when no place name is known. */
const STATE_TEXT = {
  // Reachable, but the place has no name yet (Studio home, or still loading).
  connected: 'Studio connected',
  running: 'No place loaded',
  stopped: 'Studio closed'
} as const

type LampState = keyof typeof LAMP_TONE_CLASS

function lampState(running: boolean, connected: boolean): LampState {
  if (connected) return 'connected'
  return running ? 'running' : 'stopped'
}

interface RobloxStudioIndicatorProps {
  project: Project | undefined
}

/**
 * Status-bar lamp for Roblox Studio: whether the editor is reachable, plus the
 * open place's name. Shown only for the Roblox project on a machine that has
 * Studio installed — a machine without Roblox must not show a dead control, and
 * a user editing an ordinary project does not need Roblox status.
 */
export function RobloxStudioIndicator({
  project
}: RobloxStudioIndicatorProps): React.JSX.Element | null {
  const isRobloxProject = project?.name === ROBLOX_PROJECT_NAME
  const status = useRobloxStudioStatus({ enabled: isRobloxProject })

  if (!isRobloxProject || !status?.installed) return null

  const state = lampState(status.running, status.connected)
  const label = STATE_LABEL[state]
  const placeName = status.placeName
  const summary = placeName ? `${label}: ${placeName}` : label

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="status"
          aria-live="polite"
          aria-label={summary}
          className={cn(
            'relative',
            STATUS_BAR_ITEM_CLASS,
            'max-w-48 cursor-default',
            // Same invisible tap-target growth as `StatusItem` (#859).
            "after:absolute after:-inset-y-2.5 after:inset-x-0 after:content-['']"
          )}
        >
          <span className="flex shrink-0 items-center">
            <Circle size={12} aria-hidden="true" className={LAMP_TONE_CLASS[state]} />
          </span>
          <span className="truncate leading-none">{placeName ?? STATE_TEXT[state]}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-md break-all">
        {placeName ? placeName : label}
      </TooltipContent>
    </Tooltip>
  )
}
