import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RobloxPage from './RobloxPage'

const { mocks } = vi.hoisted(() => ({ mocks: { project: undefined as unknown } }))

vi.mock('@/stores/project-store', () => ({
  useActiveProject: () => mocks.project
}))

function renderPage(): void {
  render(
    <MemoryRouter>
      <RobloxPage />
    </MemoryRouter>
  )
}

describe('RobloxPage', () => {
  beforeEach(() => {
    mocks.project = { id: 'p1', name: 'termul', path: 'C:/repo' }
  })

  it('lists every generator and marks the unimplemented ones as soon', () => {
    renderPage()
    expect(screen.getByRole('button', { name: /Clothing/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /3D Generator/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Animation/ })).toBeDisabled()
    expect(screen.getAllByText('soon')).toHaveLength(6)
  })

  it('says a project is needed before a garment can be written', () => {
    mocks.project = undefined
    renderPage()
    expect(screen.getByText(/Open a project first/)).toBeInTheDocument()
  })

  it('shows an empty clothing stage once a project is open', () => {
    renderPage()
    expect(screen.getByText('No garment yet.')).toBeInTheDocument()
  })

  it('keeps the clothing stage while the clothing feature stays selected', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Clothing/ }))
    expect(screen.getByText('No garment yet.')).toBeInTheDocument()
  })
})
