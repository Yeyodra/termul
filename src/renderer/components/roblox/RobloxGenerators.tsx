/**
 * The generator list of the Roblox surface, in the Side panel (D2).
 *
 * A row is a route, not a state: picking one navigates to `/roblox/<feature>`,
 * so the page is bookmarkable and a refresh lands on the same generator (D6).
 * The seven generators without an engine stay listed as `soon` — with one engine
 * live, hiding the rest would read as a missing feature rather than a roadmap (D8).
 */

import {
  Grid3X3,
  ImageIcon,
  Layers,
  Music2Icon,
  Palette,
  Sparkles,
  VideoIcon
} from '@/components/icons'
import { featureLabel, ROBLOX_FEATURES, type RobloxFeature } from '@/lib/roblox-features'
import { cn } from '@/lib/utils'

const FEATURE_ICONS: Record<RobloxFeature, React.JSX.Element> = {
  clothing: <Layers size={13} />,
  '3d': <Grid3X3 size={13} />,
  vfx: <Sparkles size={13} />,
  gfx: <ImageIcon size={13} />,
  icon: <Palette size={13} />,
  sfx: <Music2Icon size={13} />,
  animation: <VideoIcon size={13} />
}

interface RobloxGeneratorsProps {
  current: RobloxFeature
  onPick: (feature: RobloxFeature) => void
}

export function RobloxGenerators({ current, onPick }: RobloxGeneratorsProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5 px-2">
      <p className="px-2 py-1 text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
        Generators
      </p>
      {ROBLOX_FEATURES.map((feature) => {
        const active = feature.id === current
        return (
          <button
            key={feature.id}
            type="button"
            aria-current={active ? 'true' : undefined}
            disabled={!feature.ready}
            onClick={() => onPick(feature.id)}
            className={cn(
              'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
              active
                ? 'bg-muted font-medium text-foreground'
                : 'text-secondary-foreground hover:bg-muted/60 hover:text-foreground',
              !feature.ready && 'cursor-not-allowed opacity-40 hover:bg-transparent'
            )}
          >
            <span aria-hidden="true" className="flex w-4 justify-center">
              {FEATURE_ICONS[feature.id]}
            </span>
            <span className="flex-1 truncate">{featureLabel(feature.id)}</span>
            {!feature.ready && (
              <span className="text-3xs tracking-wide text-muted-foreground uppercase">soon</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
