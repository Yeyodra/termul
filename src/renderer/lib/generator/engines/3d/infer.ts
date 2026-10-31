/**
 * What a prompt is asking for, when the category picker disagrees with it.
 *
 * The picker is advisory in RobloxKit and the model decides for itself
 * (`gen3d-BAdfthxw.js:534-548`). The reason is visible in the output: typing
 * "a dog" with the picker on Prop builds a dog as an unrigged prop - no
 * skeleton, no leg proportions, no walk - which is the difference between a
 * creature and a stack of boxes. The same prompt read as `character` with a
 * custom rig gives the engine a reason to build a body.
 *
 * Three lists, in the order that matters:
 *
 *  1. VETO first. "a dragon statue" is an object *of* a creature, not a creature,
 *     so it stays a prop. Checking the creature list first would rig a statue.
 *  2. CREATURE, for a rigged non-human: a dog, a ghost, a slime.
 *  3. HUMANOID, for R15/R6.
 *
 * A prompt that matches none of them returns `null` and the picker stands.
 */

/** An object that depicts a creature without being one. Checked before anything. */
const VETO = /\b(statue|figurine|toy|plush|sculpture|bust|icon|logo|sign)\b/i

/** A living thing that is not a humanoid. */
const CREATURE =
  /\b(dog|puppy|cat|kitten|horse|pony|cow|pig|sheep|goat|wolf|fox|bear|lion|tiger|deer|dinosaur|dino|t-rex|dragon|lizard|spider|insect|ant|bird|chicken|duck|eagle|crab|fish|shark|snake|worm|frog|monster|creature|animal|pet|mount|beast|quadruped|ghost|ghostly|spirit|phantom|wraith|banshee|spectre|specter|apparition|wisp|legless|slime|blob)\b/i

/** A person-shaped character. */
const HUMANOID =
  /\b(humanoid|person|man|woman|lady|gentleman|boy|girl|kid|child|human|knight|soldier|ninja|warrior|wizard|witch|robot|android|avatar|character|guy|hero|villain|skeleton|zombie|vampire|pirate|princess|prince|king|queen|guard|villager|npc)\b/i

export interface InferredCategory {
  category: 'character'
  rig: 'R15' | 'R6' | 'custom'
}

/**
 * The category a prompt implies, or `null` to keep the picker's choice.
 *
 * Only ever answers `character`: everything else is already a prop, building,
 * tool or text, and guessing one of those from a noun would be worse than
 * leaving the picker alone.
 */
export function inferCategory(prompt: string): InferredCategory | null {
  const text = String(prompt ?? '')
  if (VETO.test(text)) return null
  if (CREATURE.test(text)) return { category: 'character', rig: 'custom' }
  if (HUMANOID.test(text)) {
    return { category: 'character', rig: /\bR6\b|classic|blocky 6/i.test(text) ? 'R6' : 'R15' }
  }
  return null
}

/** The sentence the page shows when it overrode the picker, or `null`. */
export function autoRigNote(picked: string, inferred: InferredCategory | null): string | null {
  if (!inferred || picked === inferred.category) return null
  const kind =
    inferred.rig === 'custom' ? 'rigged character (creature)' : `rigged ${inferred.rig} character`
  return `Queued as a ${kind}. Turn the category back to ${picked} to keep the kind you picked.`
}
