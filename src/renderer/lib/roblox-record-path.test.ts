import { describe, expect, it } from 'vitest'
import { recordPath } from './roblox-record-path'

describe('recordPath', () => {
  it('turns a stored folder into a Windows path', () => {
    expect(recordPath({ dir: '/p/.termul/generated/shirt/baju-formal' })).toBe(
      '\\p\\.termul\\generated\\shirt\\baju-formal'
    )
  })

  it('drops the verbatim prefix the records store adds', () => {
    expect(
      recordPath({ dir: '//?/C:/Users/Novella/Documents/robloxkit/.termul/generated/shirt/x' })
    ).toBe('C:\\Users\\Novella\\Documents\\robloxkit\\.termul\\generated\\shirt\\x')
  })
})
