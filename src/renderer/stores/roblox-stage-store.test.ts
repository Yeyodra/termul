/**
 * The line the viewport shows while a generation runs.
 *
 * A model takes a minute or two, and the page showed only a spinner: nothing said
 * which stage was running, so a slow generation and a stuck one looked the same.
 * The engine already reports a stage and its own detail, so this pins that the
 * detail wins.
 */
import { describe, expect, it } from 'vitest'
import { progressLine, type StageSnapshot } from './roblox-stage-store'

const running = (overrides: Partial<StageSnapshot> = {}): StageSnapshot => ({
  state: 'running',
  phase: 'draw',
  layer: 0,
  total: 0,
  stage: 'Design',
  detail: null,
  sheet: null,
  base: null,
  error: null,
  ...overrides
})

describe('progressLine', () => {
  it('says nothing when nothing is running', () => {
    expect(progressLine(running({ state: 'idle' }))).toBeNull()
    expect(progressLine(running({ state: 'done' }))).toBeNull()
  })

  it('prefers the engine detail over a bare stage name', () => {
    const line = progressLine(running({ stage: 'designing', detail: 'Claude Agent is designing' }))
    expect(line).toBe('Claude Agent is designing')
  })

  it('falls back to the stage name when there is no detail', () => {
    expect(progressLine(running({ stage: 'building' }))).toBe('building.')
  })

  it('says Starting before the engine reports anything', () => {
    expect(progressLine(running({ stage: '' }))).toBe('Starting.')
  })

  it('keeps the layer counter ahead of everything else', () => {
    const line = progressLine(running({ layer: 3, total: 7, detail: 'ignored' }))
    expect(line).toBe('Drawing layer 3 of 7')
  })

  it('keeps the clothing phases as they were', () => {
    expect(progressLine(running({ phase: 'unwrap' }))).toBe('Unfolding to the sheet.')
    expect(progressLine(running({ phase: 'wrap' }))).toBe('Folding back into 3D.')
  })
})
