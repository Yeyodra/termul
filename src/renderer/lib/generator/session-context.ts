/**
 * What a fresh chat is told about Roblox before the user types.
 *
 * RobloxKit plants two things at session start: a rules document (identity) and
 * a context block naming the open place (situation). This module builds both,
 * verbatim from `agentInstructions:3-23` — see
 * `re/full-reverse/14-deep-dives/C-session-bootstrap.md` §3 and §11b.
 *
 * The context block is the reason a fresh chat "just knows" it is in Roblox.
 * Without it the user has to say "load the Studio MCP, make object X".
 */

/** The 16 skill ids, in declaration order (`skills:5`). */
export const SKILL_NAMES = [
  'luau-scripting',
  'luau-debugging',
  'luau-patterns',
  'roblox-ui',
  'roblox-building',
  'roblox-performance',
  'roblox-vfx',
  'roblox-gfx',
  'roblox-icons',
  'roblox-sfx',
  'roblox-cutscenes',
  'roblox-animation',
  'roblox-skybox',
  'roblox-rigging',
  'roblox-textures',
  'roblox-texturing'
] as const

/** The MCP server that carries Studio and workspace tools. */
export const ROBLOX_MCP_SERVER = 'robloxkit'

/** Which Studio instance the chat is attached to. */
export interface SessionStudio {
  studios: Array<{ id: string; name?: string | null }>
  studioId?: string | null
  status?: string | null
}

/** Join the skill ids for the "read these first" line. */
export function skillNames(): string {
  return SKILL_NAMES.join(', ')
}

/**
 * The six facts an agent gets before the first user message (`ai:18-23`):
 * session kind, place identity, connection state, peer windows, which skill to
 * read first, and where the tools live.
 */
export function sessionContext(studio: SessionStudio): string {
  const open = studio.studios.find((entry) => entry.id === studio.studioId)
  const peers =
    studio.studios
      .filter((entry) => entry.id !== studio.studioId)
      .map((entry) => entry.name)
      .filter((name): name is string => !!name)
      .join(', ') || 'none'

  return [
    'Robloxkit session context',
    `- Open place: ${open ? `${open.name ?? 'untitled'} (studio_id ${open.id})` : 'none selected'}`,
    `- Studio connection: ${studio.status ?? 'unknown'}`,
    `- Other Studio windows: ${peers}`,
    `- Skills to read first: roblox-performance; then the one for the task (${skillNames()})`,
    `- Studio and workspace tools are on the \`${ROBLOX_MCP_SERVER}\` MCP server.`
  ].join('\n')
}

/**
 * Fill `{{placeholder}}` in a rules document.
 *
 * Only `\w+` keys are substituted; an unknown key is left untouched, exactly as
 * RobloxKit's `fill()` does. That matters because an unsubstituted `{{skills}}`
 * reaches the model as literal text rather than failing loudly.
 */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) =>
    Object.hasOwn(values, key) ? values[key] : whole
  )
}

/**
 * The identity document sent at session start (`agentInstructions:3-7`).
 *
 * `rules` is the re-authored `acp/rules.md`; this only performs the `{{skills}}`
 * substitution. Passing an empty `rules` yields an empty string rather than a
 * half-built preamble, so a caller can tell "no rules" from "rules with skills".
 */
export function acpRules(rules: string): string {
  if (!rules.trim()) return ''
  return fill(rules, { skills: SKILL_NAMES.map((name) => `- ${name}`).join('\n') })
}

/**
 * The content block that carries the context into the first prompt.
 *
 * Two transports, chosen by adapter capability (`acp:773-812`): adapters that
 * advertise `embeddedContext` get a `resource` block; everyone else gets plain
 * text. Ordering is fixed — context first, then the user's text.
 */
export function contextBlock(
  context: string,
  embeddedContext: boolean
): { type: string; [key: string]: unknown } {
  if (embeddedContext) {
    return {
      type: 'resource',
      resource: {
        uri: 'robloxkit://studio/context',
        mimeType: 'text/markdown',
        text: context
      }
    }
  }
  return { type: 'text', text: context }
}
