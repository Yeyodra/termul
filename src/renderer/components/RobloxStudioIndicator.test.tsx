import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { Project } from '@/types/project'

const { mockUseStatus } = vi.hoisted(() => ({ mockUseStatus: vi.fn() }))

vi.mock('@/hooks/use-roblox-studio-status', () => ({
  useRobloxStudioStatus: mockUseStatus
}))

import { RobloxStudioIndicator } from './RobloxStudioIndicator'

const ROBLOX_PROJECT: Project = {
  id: 'roblox',
  name: 'Roblox',
  path: '/home/user/Documents/RobloxKit',
  color: 'blue'
}

const OTHER_PROJECT: Project = {
  id: 'other',
  name: 'Termul',
  path: '/home/user/termul',
  color: 'blue'
}

const CONNECTED = {
  installed: true,
  running: true,
  connected: true,
  placeName: 'Untitled Experience (placeId: 93291914711483)'
}
const CONNECTED_NO_NAME = { installed: true, running: true, connected: true, placeName: null }
const RUNNING_ONLY = { installed: true, running: true, connected: false, placeName: null }
const STOPPED = { installed: true, running: false, connected: false, placeName: null }
const NOT_INSTALLED = { installed: false, running: false, connected: false, placeName: null }

function renderIndicator(project: Project | undefined) {
  return render(
    <TooltipProvider>
      <RobloxStudioIndicator project={project} />
    </TooltipProvider>
  )
}

/** The lamp circle is the only svg; its class carries the tone. */
function lampClassName(container: HTMLElement): string {
  const svg = container.querySelector('svg')
  expect(svg).not.toBeNull()
  return svg?.getAttribute('class') ?? ''
}

describe('RobloxStudioIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when Studio is not installed', () => {
    mockUseStatus.mockReturnValue(NOT_INSTALLED)

    const { container } = renderIndicator(ROBLOX_PROJECT)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing until the first status arrives', () => {
    mockUseStatus.mockReturnValue(null)

    const { container } = renderIndicator(ROBLOX_PROJECT)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for a project that is not the Roblox project', () => {
    mockUseStatus.mockReturnValue(CONNECTED)

    const { container } = renderIndicator(OTHER_PROJECT)

    expect(container).toBeEmptyDOMElement()
    expect(mockUseStatus).toHaveBeenCalledWith({ enabled: false })
  })

  it('enables polling only for the Roblox project', () => {
    mockUseStatus.mockReturnValue(CONNECTED)

    renderIndicator(ROBLOX_PROJECT)

    expect(mockUseStatus).toHaveBeenCalledWith({ enabled: true })
  })

  it('shows the place name and a green lamp when connected', () => {
    mockUseStatus.mockReturnValue(CONNECTED)

    const { container } = renderIndicator(ROBLOX_PROJECT)

    expect(screen.getByText(CONNECTED.placeName)).toBeInTheDocument()
    const tone = lampClassName(container)
    expect(tone).toContain('text-success')
    // `connection` is the cyan channel role, not a connected Roblox editor.
    expect(tone).not.toContain('text-connection')
  })

  it('shows a muted lamp and "no place loaded" when Studio is open but unreachable', () => {
    mockUseStatus.mockReturnValue(RUNNING_ONLY)

    const { container } = renderIndicator(ROBLOX_PROJECT)

    expect(screen.getByText('No place loaded')).toBeInTheDocument()
    const tone = lampClassName(container)
    expect(tone).toContain('text-muted-foreground')
    expect(tone).not.toContain('text-success')
  })

  it('stays green with "Studio connected" when reachable but the place has no name', () => {
    // Studio reports `"name": null` before a place loads; that is still a
    // connection, so the lamp must not fall back to the muted "no place" look.
    mockUseStatus.mockReturnValue(CONNECTED_NO_NAME)

    const { container } = renderIndicator(ROBLOX_PROJECT)

    expect(screen.getByText('Studio connected')).toBeInTheDocument()
    expect(lampClassName(container)).toContain('text-success')
  })

  it('shows a dimmed lamp when Studio is closed', () => {
    mockUseStatus.mockReturnValue(STOPPED)

    const { container } = renderIndicator(ROBLOX_PROJECT)

    expect(screen.getByText('Studio closed')).toBeInTheDocument()
    expect(lampClassName(container)).toContain('text-muted-foreground/50')
  })

  it('names the state for assistive tech instead of relying on colour', () => {
    mockUseStatus.mockReturnValue(CONNECTED)

    renderIndicator(ROBLOX_PROJECT)

    expect(
      screen.getByLabelText(`Roblox Studio connected: ${CONNECTED.placeName}`)
    ).toBeInTheDocument()
  })

  it('announces the closed state when Studio is not running', () => {
    mockUseStatus.mockReturnValue(STOPPED)

    renderIndicator(ROBLOX_PROJECT)

    expect(screen.getByLabelText('Roblox Studio is not running')).toBeInTheDocument()
  })
})
