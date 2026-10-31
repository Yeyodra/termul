/**
 * What the prompt says the model is, when the picker says otherwise.
 *
 * The failure this prevents is concrete: "a dog" with the picker on Prop built a
 * dog as an unrigged prop, so the engine had no reason to give it a body, a
 * skeleton or leg proportions. The model looked like boxes because it was asked
 * to be a box.
 */
import { describe, expect, it } from 'vitest'
import { autoRigNote, inferCategory } from './infer'

describe('inferCategory', () => {
  it('reads a quadruped as a rigged creature', () => {
    expect(inferCategory('a brown puppy')).toEqual({ category: 'character', rig: 'custom' })
    expect(inferCategory('a sleeping cat')).toEqual({ category: 'character', rig: 'custom' })
  })

  it('reads a person as an R15 humanoid', () => {
    expect(inferCategory('a knight in armour')).toEqual({ category: 'character', rig: 'R15' })
    expect(inferCategory('a robot')).toEqual({ category: 'character', rig: 'R15' })
  })

  it('honours an explicit R6 or classic request', () => {
    expect(inferCategory('a blocky 6 classic person')).toEqual({ category: 'character', rig: 'R6' })
  })

  it('reads a ghost as a creature, because it has no legs to quadruped', () => {
    expect(inferCategory('a floating ghost')).toEqual({ category: 'character', rig: 'custom' })
    expect(inferCategory('a slime blob')).toEqual({ category: 'character', rig: 'custom' })
  })

  it('keeps a statue of a creature a prop, which is the order that matters', () => {
    // Checking the creature list first would rig a statue. The veto has to win.
    expect(inferCategory('a dragon statue')).toBeNull()
    expect(inferCategory('a plush dog')).toBeNull()
    expect(inferCategory('a toy cat')).toBeNull()
    expect(inferCategory('a company logo')).toBeNull()
  })

  it('leaves an ordinary prop alone', () => {
    expect(inferCategory('a wooden crate')).toBeNull()
    expect(inferCategory('a treasure chest')).toBeNull()
    expect(inferCategory('a brick house')).toBeNull()
    expect(inferCategory('a pickaxe')).toBeNull()
  })

  it('never invents a non-character category', () => {
    // A building or a tool is already the picker's job; guessing would be worse.
    for (const prompt of ['a tall tower', 'a hammer', 'a STOP sign']) {
      const inferred = inferCategory(prompt)
      if (inferred) expect(inferred.category).toBe('character')
    }
  })

  it('is safe on an empty prompt', () => {
    expect(inferCategory('')).toBeNull()
    expect(inferCategory(undefined as unknown as string)).toBeNull()
  })
})

describe('autoRigNote', () => {
  it('says so when it overrode the picker', () => {
    const note = autoRigNote('prop', { category: 'character', rig: 'custom' })
    expect(note).toContain('rigged character (creature)')
    expect(note).toContain('prop')
  })

  it('says nothing when the picker already agreed', () => {
    expect(autoRigNote('character', { category: 'character', rig: 'custom' })).toBeNull()
  })

  it('says nothing when nothing was inferred', () => {
    expect(autoRigNote('prop', null)).toBeNull()
  })
})
