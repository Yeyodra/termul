import { useNavigate, useParams } from 'react-router-dom'
import { Palette } from '@/components/icons'
import { ClothingViewport } from '@/components/roblox/ClothingViewport'
import { ModelViewport } from '@/components/roblox/ModelViewport'
import { featureFromPath, featureLabel, featureReady } from '@/lib/roblox-features'
import { useActiveProject } from '@/stores/project-store'
import { useShellLayoutStore } from '@/stores/shell-layout-store'

/**
 * One generator page, at `/roblox/<feature>` (D6).
 *
 * The generator list and the collection live in the Side panel's Roblox tab (D2),
 * so this page owns only the viewport. The feature comes from the URL, which is
 * why a refresh lands on the same generator instead of resetting to clothing.
 *
 * Which viewport to mount follows `featureReady`, not a comparison against a
 * feature name: that way an engine landing is one flag flip, and a page cannot
 * keep claiming an engine is missing after it ships.
 */
export default function RobloxPage(): React.JSX.Element {
  const project = useActiveProject()
  const navigate = useNavigate()
  const params = useParams()
  const feature = featureFromPath(`/roblox/${params['*'] ?? ''}`)

  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <span className="text-xs text-muted-foreground">roblox</span>
        <span className="text-xs text-muted-foreground/50">/</span>
        <span className="text-xs font-semibold">{feature}</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => {
            if (project) useShellLayoutStore.getState().setLastColumnTab(project.id, 'roblox')
            navigate('/')
          }}
          className="rounded px-2 py-1 text-2xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          Back to workspace
        </button>
      </header>

      {!featureReady(feature) ? (
        <div className="m-auto max-w-sm text-center">
          <Palette size={20} className="mx-auto mb-2 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            {featureLabel(feature)} has no engine in this build yet.
          </p>
        </div>
      ) : !project?.path ? (
        <div className="m-auto max-w-sm text-center">
          <p className="text-xs text-muted-foreground">
            Open a project first: a generated artifact is written into the project folder.
          </p>
        </div>
      ) : feature === '3d' ? (
        <ModelViewport projectPath={project.path} />
      ) : (
        <ClothingViewport projectPath={project.path} />
      )}
    </div>
  )
}
