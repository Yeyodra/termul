import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RobloxGenerators } from './RobloxGenerators'

describe('RobloxGenerators', () => {
  it('lists every generator and marks the unimplemented ones as soon', () => {
    render(<RobloxGenerators current="clothing" onPick={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Clothing/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /3D Generator/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Animation/ })).toBeDisabled()
    expect(screen.getAllByText('soon')).toHaveLength(6)
  })

  it('marks the current generator and reports a pick', () => {
    const onPick = vi.fn()
    render(<RobloxGenerators current="clothing" onPick={onPick} />)

    expect(screen.getByRole('button', { name: /Clothing/ })).toHaveAttribute('aria-current', 'true')
    fireEvent.click(screen.getByRole('button', { name: /VFX/ }))
    expect(onPick).not.toHaveBeenCalled()
  })

  it('reports a pick for a generator that has an engine', () => {
    const onPick = vi.fn()
    render(<RobloxGenerators current="3d" onPick={onPick} />)
    fireEvent.click(screen.getByRole('button', { name: /Clothing/ }))
    expect(onPick).toHaveBeenCalledWith('clothing')
  })
})
