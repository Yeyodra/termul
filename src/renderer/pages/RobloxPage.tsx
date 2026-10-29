import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Layers, Palette, Sparkles } from '@/components/icons'
import { ClothingCollection } from '@/components/roblox/ClothingCollection'
import { cn } from '@/lib/utils'
import { useActiveProject } from '@/stores/project-store'

const FEATURES = [
  { id: 'clothing', label: 'Clothing', ready: true },
  { id: '3d', label: '3D Generator', ready: false },
  { id: 'vfx', label: 'VFX', ready: false },
  { id: 'gfx', label: 'GFX', ready: false },
  { id: 'icon', label: 'Icon', ready: false },
  { id: 'sfx', label: 'SFX', ready: false },
  { id: 'animation', label: 'Animation', ready: false }
] as const

type FeatureId = (typeof FEATURES)[number]['id']

export default function RobloxPage(): React.JSX.Element {
  const project = useActiveProject()
  const navigate = useNavigate()
  const params = useParams()
  const fromRoute = (params['*'] ?? '').split('/')[0]
  const [picked, setPicked] = useState<FeatureId | null>(null)
  const feature: FeatureId =
    picked ??
    (FEATURES.some((item) => item.id === fromRoute) ? (fromRoute as FeatureId) : 'clothing')
  const setFeature = (id: FeatureId): void => {
    setPicked(id)
    navigate(`/roblox/${id}`)
  }

  return (
    <div className="flex h-full w-full overflow-hidden">
      <nav
        aria-label="Generators"
        className="flex w-[220px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border/60 p-2"
      >
        <p className="px-2 py-1.5 text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
          Generators
        </p>
        {FEATURES.map((item) => {
          const active = item.id === feature
          return (
            <button
              key={item.id}
              type="button"
              aria-current={active ? 'true' : undefined}
              disabled={!item.ready}
              onClick={() => setFeature(item.id)}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                active
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-secondary-foreground hover:bg-muted/60 hover:text-foreground',
                !item.ready && 'cursor-not-allowed opacity-40 hover:bg-transparent'
              )}
            >
              <span aria-hidden="true" className="w-4 text-center">
                {item.ready ? <Layers size={13} /> : <Sparkles size={13} />}
              </span>
              <span className="flex-1 truncate">{item.label}</span>
              {!item.ready && (
                <span className="text-3xs tracking-wide text-muted-foreground uppercase">soon</span>
              )}
            </button>
          )
        })}
      </nav>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 px-3">
          <span className="text-xs text-muted-foreground">roblox</span>
          <span className="text-xs text-muted-foreground/50">/</span>
          <span className="text-xs font-semibold">{feature}</span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => navigate('/')}
            className="rounded px-2 py-1 text-2xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Back to workspace
          </button>
        </header>

        {feature !== 'clothing' ? (
          <div className="m-auto max-w-sm text-center">
            <Palette size={20} className="mx-auto mb-2 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              This generator has no engine in this build yet. Only clothing is implemented.
            </p>
          </div>
        ) : project?.path ? (
          <ClothingCollection projectPath={project.path} />
        ) : (
          <div className="m-auto max-w-sm text-center">
            <p className="text-xs text-muted-foreground">
              Open a project first: a garment is written into the project folder.
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
