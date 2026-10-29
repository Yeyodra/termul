import { beforeEach, describe, expect, it } from 'vitest'
import { useLiveArtifactStore } from './live-artifact-store'

const PNG_A = 'data:image/png;base64,AAAA'
const PNG_B = 'data:image/png;base64,BBBB'

describe('useLiveArtifactStore', () => {
  beforeEach(() => {
    useLiveArtifactStore.getState().clear()
  })

  it('keeps the picture a finished task produced', () => {
    useLiveArtifactStore.getState().show('s-1', 't-1', PNG_A)
    expect(useLiveArtifactStore.getState().pictures['s-1']).toEqual({ 't-1': PNG_A })
  })

  it('keeps sessions apart', () => {
    useLiveArtifactStore.getState().show('s-1', 't-1', PNG_A)
    useLiveArtifactStore.getState().show('s-2', 't-2', PNG_B)
    expect(useLiveArtifactStore.getState().pictures['s-1']).toEqual({ 't-1': PNG_A })
    expect(useLiveArtifactStore.getState().pictures['s-2']).toEqual({ 't-2': PNG_B })
  })

  it('keeps every task of a session, in arrival order', () => {
    const store = useLiveArtifactStore.getState()
    store.show('s-1', 't-1', PNG_A)
    store.show('s-1', 't-2', PNG_B)
    expect(Object.keys(useLiveArtifactStore.getState().pictures['s-1'] ?? {})).toEqual([
      't-1',
      't-2'
    ])
  })

  it('does not churn state when the same picture is shown again', () => {
    useLiveArtifactStore.getState().show('s-1', 't-1', PNG_A)
    const before = useLiveArtifactStore.getState().pictures
    useLiveArtifactStore.getState().show('s-1', 't-1', PNG_A)
    expect(useLiveArtifactStore.getState().pictures).toBe(before)
  })

  it('replaces the picture when a task is regenerated', () => {
    useLiveArtifactStore.getState().show('s-1', 't-1', PNG_A)
    useLiveArtifactStore.getState().show('s-1', 't-1', PNG_B)
    expect(useLiveArtifactStore.getState().pictures['s-1']).toEqual({ 't-1': PNG_B })
  })

  it('clears everything', () => {
    useLiveArtifactStore.getState().show('s-1', 't-1', PNG_A)
    useLiveArtifactStore.getState().clear()
    expect(useLiveArtifactStore.getState().pictures).toEqual({})
  })
})
