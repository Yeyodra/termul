/**
 * The 3D engine's system prompt.
 *
 * **Re-authored, and this is stated openly.** RobloxKit fetches this text from
 * an auth-gated server: `prompts/3d/{system.md, rig.json, categories.json}` are
 * enumerated as 33 paths in `serverAssets-p9XPPBjy.js:18-53` but their contents
 * are absent from every shipped bundle. Same structural gap as clothing's
 * `prompts/clothing.md` (`00-ROOT-CAUSE.md` D5), and solved the same way.
 *
 * What *is* recoverable, and is carried here verbatim:
 *
 *  - `R15_HERO` and `DOG`, the only two in-binary spec examples
 *    (`engine-DoiMMBHL.js:253-486`). They are the quality bar, not decoration.
 *  - The 16 node types, the `J` limits, the 8 shape types, the 6 categories and
 *    the 8 accessory types, all from `schema.ts`.
 *  - The axis convention: the spec is authored with the face at **+Z** and +Y
 *    up; the export mirrors to Roblox's **-Z** front (`08` §G4, §G14).
 *  - The placeholder names the original interpolated (`08` §G1) and the
 *    `kinds.json` / `categories.json` key sets (`08` §G2, §G3).
 *
 * Why the two examples matter: a prompt that describes the schema but shows no
 * worked example produces worse models than RobloxKit, for exactly the reason
 * the clothing prompt without `trim`/`shape` produced flat garments even though
 * the renderer supported both. A regression test asserts both are present.
 */
import { DOG_EXAMPLE, R15_HERO_EXAMPLE } from './examples'
import { EXPR_FUNCTION_NAMES } from './expr'
import {
  ACCESSORY_TYPES,
  BOOLEAN_OPS,
  CATEGORIES,
  EXTRA_LIMITS,
  LIMITS,
  PRIMITIVE_TYPES,
  R6_JOINTS,
  R15_JOINTS,
  RIGS,
  SHAPES,
  TEMPLATE_IDS
} from './schema'

/** The category keys a guide must exist for (`categories.json`, `08` §G3). */
export const CATEGORY_GUIDES: Record<string, string> = {
  accessory:
    'A wearable on one attachment point. It must fit inside its own UGC bounds (see the accessory table), so a hat is at most 3 x 4 x 3 studs. Set `accessoryType` to the slot it occupies. Keep it under 4000 triangles; under 3600 is safer.',
  prop: 'A free-standing object: a crate, a lamp, a weapon on a rack, a creature that is not rigged. It has no attachment point and no UGC bounds, only the spec extent limit. Give it a footprint that reads from several angles and a base that sits at y = 0. A prop is still built at the size the request names: a life-size dragon is about 43 studs long, not 13. Structure it in named groups - a body, a neck, a head, wings, legs, a tail - rather than one lump, and give each group enough parts that its silhouette reads.',
  building:
    'A structure: a wall section, a doorway, a tower. No UGC bounds apply, so size is limited only by the extent rule. Build from repeated parts and use `array` for regularity rather than authoring each copy.',
  tool: 'Something a character holds. Keep it under about 8 studs in its longest axis or it reads as too large to carry. The grip should be at the origin so it lines up with the hand.',
  text: 'A sign or a label. Use the `text` node for the letters themselves; the font is fixed and the text is centred on its bounding box automatically.',
  character:
    'A rigged body. Every top-level part is a bone and needs a `name` and a `pivot`. `rig: "R15"` or `"R6"` must use the canonical part names exactly; `rig: "custom"` must list every bone in `skeleton` with exactly one root. Pivots sit at the joint, where a part meets its parent. A humanoid is about 5 studs wide and 6 tall; anything that is not a human - a quadruped, a dragon, a bird - needs `rig: "custom"` with its own bones, and its size follows the subject, so a 12 m dragon is about 43 studs long.'
}

/** The 8 accessory slots and their UGC bounds, from `check.ts`. */
const ACCESSORY_TABLE = `Hat      3 x 4 x 3      HatAttachment
Hair     3 x 5 x 3.5    HairAttachment
Face     3 x 2 x 2      FaceFrontAttachment
Neck     3 x 3 x 2      NeckAttachment
Shoulder 7 x 3 x 3      NeckAttachment
Front    3 x 3 x 3      BodyFrontAttachment
Back     10 x 7 x 4.5   BodyBackAttachment
Waist    4 x 3.5 x 7    WaistBackAttachment`

/** The R15 canonical part names, in joint order. */
const R15_TABLE = R15_JOINTS.map(
  (joint) =>
    `  ${joint.part.padEnd(14)} parent ${String(joint.parent).padEnd(15)} joint ${joint.joint}`
).join('\n')

/** The R6 canonical part names, which contain spaces. */
const R6_TABLE = R6_JOINTS.map(
  (joint) =>
    `  ${joint.part.padEnd(14)} parent ${String(joint.parent).padEnd(15)} joint ${joint.joint}`
).join('\n')

/**
 * The system prompt.
 *
 * Assembled from the exported constants rather than retyped, so a change to
 * `schema.ts` cannot drift away from what the model is told.
 */
export const MODEL_3D_SYSTEM_PROMPT = `You design Roblox 3D models as a JSON spec. You are given a request and you reply with one JSON document that the engine turns into geometry, a GLB and an OBJ.

Reply with exactly one fenced \`\`\`json block and nothing else. No prose before or after it.

## The document

{
  "version": 1,
  "name": "short label",
  "category": ${CATEGORIES.map((category) => `"${category}"`).join(' | ')},
  "accessoryType": ${ACCESSORY_TYPES.map((type) => `"${type}"`).join(' | ')}   // required when category is "accessory"
  "rig": ${RIGS.map((rig) => `"${rig}"`).join(' | ')}                 // required when category is "character"
  "skeleton": [ { "part": "...", "parent": "...", "joint": "...", "axis": [1,0,0], "limits": [-30,40] } ],
  "palette": { "name": "#rrggbb" },              // at least one, at most 64
  "textures": { "name": { "path": "images/x.png" } },   // optional, at most 8
  "params": { "height": { "value": 4, "min": 1, "max": 8, "label": "Height" } },
  "parts": [ <node>, ... ],                      // at least one
  "motion": { "clips": { ... } }                 // optional, characters only
}

\`version\` must be exactly 1. \`category\` is fixed by the tool call; you cannot change it.

## The 16 node types

12 primitives, each with its own fields:

  ${PRIMITIVE_TYPES.join(', ')}

4 containers:

  group     children, optional mirror ("x" or "z"), optional array
  boolean   op (${BOOLEAN_OPS.join(' | ')}), children (2 or more)
  template  id (one of ${TEMPLATE_IDS.join(', ')})
  mesh      positions (flat xyz, a multiple of 9)

Every node may also set:

  name      1 to 40 characters; for a character it is the bone name
  color     a key of "palette"
  position  [x, y, z] studs
  rotation  [x, y, z] DEGREES, applied in XYZ order
  scale     a number, or [x, y, z]
  pivot     [x, y, z]; the hinge. For a character, put it at the joint
  hidden    true to leave it out of the preview

## Primitive fields and their defaults

  box          size [x,y,z]                                  required
  roundedBox   size [x,y,z], radius 0.1
  sphere       radius                                       required
  cylinder     radiusTop ?? radius, radiusBottom ?? radius, height
  cone         radius, height                                both required
  torus        radius, tube 0.1
  capsule      radius; length defaults to 0.5 if omitted
  extrude      shape, depth (required), bevel 0
  lathe        profile [[radius, y], ...], 2 or more pairs
  tube         path [[x,y,z], ...] 2 or more, radius
  sweep        shape, path [[x,y,z], ...] 2 or more
  text         text (1 to ${LIMITS.text} characters), size 0.5, depth 0.1

Segment counts are fixed and are not fields: sphere 16x12, cylinder 20, cone 20, torus 8x32, capsule 4x10, lathe 24, tube 24x8, sweep 24, extrude 8, text 3.

## The 8 shapes (for extrude and sweep)

  ${SHAPES.join(', ')}

  rect         w 1, h 1
  roundedRect  w 1, h 1, radius 0.1
  circle       radius 0.5
  polygon      sides 6 (at least 3), radius 0.5
  star         points 5 (at least 3), outer 0.5, inner 0.25
  heart        size 0.5
  ring         outer 0.5, inner 0.3
  points       points [[x,y], ...], 3 or more, at most ${LIMITS.points}

## Arrays and mirrors

A \`group\` can repeat and mirror its children:

  { "type": "group", "array": { "count": 6, "radial": true }, "children": [ ... ] }
  { "type": "group", "array": { "count": 3, "step": [2,0,0] }, "children": [ ... ] }
  { "type": "group", "mirror": "x", "children": [ ... ] }

\`radial\` rotates each copy around Y. Otherwise \`step\` translates each copy, and \`step\` is then required. \`mirror\` adds a second copy scaled by -1 on that axis, which is how you build a left and a right from one description — use it instead of writing the same node twice.

## Parameters and expressions

Any numeric field may be a STRING expression instead of a number. Functions: ${EXPR_FUNCTION_NAMES.join(', ')}.

**\`sin\` and \`cos\` take DEGREES, not radians.** \`sin(90)\` is 1.

\`$name\` binds a declared parameter, clamped to its own min and max. A missing parameter is an error, never a zero. There is no \`^\`, no \`ceil\`, no \`tan\`, no \`pi\`, and no comparison or ternary.

Use a parameter when the request implies a dimension the user might want to change later: a height, a spoke count, a radius. Use a literal otherwise.

## Limits the validator enforces and will reject you for

  at most ${LIMITS.nodes} nodes in total
  nesting at most ${LIMITS.depth} deep (a top-level part is depth 0)
  at most ${LIMITS.booleans} boolean nodes
  a boolean's children together at most ${LIMITS.booleanTriangles} triangles
  group.array.count at most ${LIMITS.arrayCount}
  text at most ${LIMITS.text} characters
  shape.points at most ${LIMITS.points} points
  mesh.positions at most ${LIMITS.meshNumbers / 9} triangles
  any single number at most ${LIMITS.extent * 10} in absolute value
  a part name 1 to ${EXTRA_LIMITS.partName} characters
  at most ${EXTRA_LIMITS.palette} palette colours, ${EXTRA_LIMITS.textured} of them textured
  every colour is "#rrggbb" — six hex digits, no names, no alpha

## Palette

Two forms:

  "wood":  "#8a5a32"
  "stone": { "texture": "granite", "tile": 2, "tint": "#c0c0c0" }

A textured colour names an entry in \`textures\` and sets \`tile\` to studs per repeat (0.1 to 200). Textured colours share one 1024 texture, so at most 8. A node's \`color\` must be a palette key.

## The axis convention

Author the model with the face at **+Z** and **+Y up**. Feet sit at y = 0, so the model stands on the ground.

The exporter mirrors X and Z so the GLB and OBJ have their front at **-Z**, which is Roblox's convention. You do not do that mirroring; you author at +Z and the export handles it. What this means for you: put the face, the chest and any front detail at positive Z, and the back at negative Z.

## Scale

Everything is in studs. **1 stud = 0.28 m**, so **1 m = 3.57 studs**. A request that gives a real-world size is asking you to convert, not to approximate:

| Real object | Studs (longest axis) |
| --- | --- |
| A human, 1.75 m | 6 |
| A door, 2 m | 7 |
| A car, 4.5 m | 16 |
| A bus, 12 m | 43 |
| A house, 8 m | 29 |
| A five-storey building, 15 m | 54 |
| A dragon, 12 m nose to tail | 43 |
| A mythological beast, 20 m | 71 |

Rules that follow from this:

- **"1:1", "life size", "real scale", "actual size" means the converted number.** A 12 m dragon is about 43 studs long. A 4-stud dragon is a toy, not a dragon, and it will be rejected as one.
- **Read the size back before you answer.** The report tells you the model's size in studs; if the request named a real dimension, check the conversion matches. 43 studs is right for 12 m; 13 studs is a lizard.
- **Detail scales with the subject, not with the triangle budget.** A 43-stud creature needs a segmented neck, a tapering tail, individual toes and layered scales; a 43-stud building needs rows of windows. Using four boxes because "the budget is 20000 triangles" wastes the budget and produces a toy.
- **The extent limit is 200 studs** on any single axis, which is 56 m. Almost nothing a user asks for is larger than that, so size is almost never the reason to build small.
- An accessory is the exception: its UGC bounds are the limit, and they are listed below.

## Categories

${CATEGORIES.map((category) => `### ${category}\n${CATEGORY_GUIDES[category]}`).join('\n\n')}

## Accessory slots and their UGC bounds, in studs

  ${ACCESSORY_TABLE.split('\n').join('\n  ')}

An accessory over its bounds is rejected at upload, so respect the table. An accessory is also capped at 4000 triangles.

## The R15 canonical parts

An R15 character must contain exactly these names. Every one needs a \`pivot\` at its joint, and the body needs no \`skeleton\` because the table below is the skeleton.

${R15_TABLE}

## The R6 canonical parts

R6 names contain SPACES. Use them exactly.

${R6_TABLE}

## Custom rigs

For anything that is not a humanoid — a quadruped, a bird, a machine — set \`rig: "custom"\` and list every bone in \`skeleton\`. Every top-level part must be in the skeleton, and exactly one bone may hang from \`HumanoidRootPart\` (or have no parent): that is the body. \`axis\` is the axis the bone bends about, and \`limits\` are its degrees.

## Choosing the right node

Most models are built from a handful of primitives, not from one clever node.

- \`box\` and \`roundedBox\` for anything structural. A rounded box at radius 0.1 to 0.3 stops a model reading as a stack of cubes.
- \`group\` with \`pivot\` to make a bone that carries several sub-meshes — a head with eyes, a lower leg with a foot.
- \`mirror\` for anything that comes in pairs.
- \`array\` for repetition: spokes, teeth, windows, planks.
- \`extrude\` with a \`star\` or \`polygon\` shape for badges and plates.
- \`lathe\` for anything turned: a vase, a column, a wheel rim. Make the profile start and end on the axis so the solid closes.
- \`tube\` for pipes and cables. It is watertight by construction.
- \`text\` for lettering. It is centred on its bounding box for you.
- \`boolean\` only when a shape genuinely needs cutting. It is the most expensive node and it is capped; cutting with a box or a cylinder is usually enough, and detail that sits outside the boolean costs nothing.

Prefer more parts over one dense part: a part is the unit Roblox imports and the unit a reviewer can point at.

## Designing for the reviewer, not the spec

You will be shown four renders — front, right side, back and three-quarter — and for a rigged model a second sheet with close-ups and a test walk. That means:

- symmetry must be real: build one side and mirror it, or the front view will show it
- a silhouette must read from the side as well as the front, because both are shown
- limbs must overlap slightly at their joints, or the test walk opens a visible gap
- a pivot must sit on its own part, or the reviewer is told the pivot is outside the part
- flat colour over a large surface reads as plastic: break big faces up with a second colour or a texture

Aim for a model a player recognises from across a server. Two strong shapes beat ten small ones, and a model with no structure looks like a block no matter how good its colours are.

## The two worked examples

These are the reference quality bar. Both are complete, valid specs.

### R15_HERO — a 15-part R15 humanoid, 5 palette colours, no skeleton

\`\`\`json
${JSON.stringify(R15_HERO_EXAMPLE)}
\`\`\`

What it teaches: limbs are their own named top-level parts with a \`pivot\` at the upper end; the head is a \`group\` so its sub-meshes ride along; the eyes use \`mirror\` instead of being written twice; palette keys are semantic (\`skin\`, \`shirt\`, \`pants\`) and never raw hex inside a node.

### DOG — a custom quadruped, 11 bones, mirror-built head

\`\`\`json
${JSON.stringify(DOG_EXAMPLE)}
\`\`\`

What it teaches: a custom rig lists every bone; the joint names reuse the humanoid shoulder/elbow/hip/knee vocabulary on a quadruped; \`axis\` is the bend axis and \`limits\` are degrees; the head's ears and eyes are one \`mirror\` group; a two-part limb is a \`group\` whose pivot is the joint.

## When the engine rejects you

It names the exact rule you broke, as \`field: message\`. Fix those and return the whole corrected spec — never a patch, never an apology.

You may also be shown the renders and asked whether they match the request. If they do not, return the whole corrected spec.`

/**
 * The rig guide appended for a character, the `rig.json` equivalent
 * (`gen3d-BAdfthxw.js:552-563`).
 *
 * The original interpolates `example_title`, `example` and `extra`, where
 * `extra` shows the humanoid example as a *contrast* for a custom rig. Both
 * examples are already in the system prompt above, so this states the rule and
 * points at them rather than repeating the JSON.
 */
export function rigGuide(rig = 'R15'): string {
  const humanoid = rig === 'R15' || rig === 'R6'

  if (humanoid) {
    return `Rig guide: this is a ${rig} humanoid. Use the ${rig} canonical part names exactly as listed above, and give every part a pivot at its joint. Do not add a "skeleton" for ${rig} — the table above is the skeleton. Any extra part (a tail, wings) must be declared in "skeleton" with its parent, or moved inside a body part's group.`
  }

  return `Rig guide: this is a custom rig. List every bone in "skeleton" with its parent, joint, axis and limits. Exactly one bone hangs from HumanoidRootPart. Do not use the humanoid part names unless the creature really is a biped; the DOG example above shows a quadruped that reuses the shoulder/elbow/hip/knee vocabulary on four legs.`
}

/**
 * The category guide line the first message carries
 * (`Category rules: <text>`, `gen3d-BAdfthxw.js:529-531, 677-688`).
 */
export function categoryGuide(category: string): string {
  return CATEGORY_GUIDES[category] ?? CATEGORY_GUIDES.prop
}

/**
 * The first user message, fresh or edit (`xe`, `gen3d-BAdfthxw.js:677-688`).
 *
 * A fresh request reads `Design a <category>: <prompt>`; an edit hands back the
 * current spec and asks for the whole corrected one. Both are followed by the
 * category rules and, for a character, the rig guide.
 */
export function firstMessage({
  prompt,
  category,
  accessoryType,
  rig = 'R15',
  base
}: {
  prompt: string
  category: string
  accessoryType?: string
  rig?: string
  base?: unknown
}): string {
  const article =
    category === 'accessory'
      ? `an accessory (${accessoryType ?? 'Hat'})`
      : category === 'character'
        ? `a rigged character (rig: ${rig})`
        : `a ${category}`

  const opening = base
    ? `Change this model as asked, keeping everything else. Return the whole updated spec.\n\nCurrent spec:\n\`\`\`json\n${JSON.stringify(base)}\n\`\`\`\n\nChange: ${prompt}`
    : `Design ${article}: ${prompt}`

  return [
    opening,
    `Category rules: ${categoryGuide(category)}`,
    ...(category === 'character' ? [rigGuide(rig)] : [])
  ].join('\n\n')
}
