/**
 * Send a built model to the open Studio place.
 *
 * Ported from `generator-BkAchkKU.js:541-974` — `sendToStudio`, `partsForStudio`,
 * `assembleLuau`, `assembleRigLuau`, `rigForStudio` and `insertLuau` — documented
 * in full in `re/full-reverse/15-3d-full-system/01-export-and-studio-path.md`.
 *
 * **This is the one place 3D is easier than clothing.** Roblox forbids apps
 * publishing classic clothing, so clothing ends at "here is a PNG, go to the
 * dashboard". A model is uploaded as a Model asset through Open Cloud, polled
 * for an `asset_id`, and inserted with `InsertService:LoadAsset`. Termul already
 * has the Studio bridge (`src-tauri/src/roblox/session.rs`), so the insert half
 * is reachable today.
 *
 * **The X/Z mirror is applied here a second time.** `flatten` in `export.ts`
 * negates X and Z for the vertex stream; `partsForStudio` below negates them
 * again for part centres and pivots. Doing one and not the other yields a model
 * that looks right in the viewport and is inside-out in Studio (`15/01` §2).
 *
 * The five invariants (`15/01` §1.1) are each enforced where the original
 * enforces them, and each has a test.
 */
import { type Model, modelTriangles } from './build'
import { ACCESSORY_BOUNDS, type PartGroup, partGroups } from './check'
import { sanitizeName, toGlb } from './export'

/**
 * The error `sendToStudio` throws when a place is not open.
 *
 * The message is verbatim because the agent reads it and acts on it: it is the
 * one failure whose fix is a user action, not a spec change.
 */
export class StudioUnavailable extends Error {
  constructor(message = 'Open a place in Roblox Studio first.') {
    super(message)
    this.name = 'StudioUnavailable'
  }
}

/** The error thrown when a model fails its checks and must not be inserted. */
export class StudioRejected extends Error {
  problems: string[]

  constructor(problems: string[]) {
    super(`It fails its checks: ${problems.join(' ')}`)
    this.name = 'StudioRejected'
    this.problems = problems
  }
}

/** One part as the Luau script needs it: a name, a centre and a pivot. */
export interface StudioPart {
  name: string
  center: [number, number, number]
  pivot: [number, number, number]
}

/** One bone as the rig script needs it. */
export interface StudioJoint {
  part: string
  parent: string
  joint: string
  pivot: [number, number, number]
}

/** One keyframe of a walk or a clip. */
export interface StudioKeyframe {
  time: number
  poses: Record<string, [number, number, number]>
}

/** One clip the model carries. */
export interface StudioClip {
  name: string
  loop: boolean
  keyframes: StudioKeyframe[]
}

/** Everything the rigged script needs (`rigForStudio`, `:849-878`). */
export interface StudioRig {
  rig: string
  joints: StudioJoint[]
  parts: StudioPart[]
  root: { center: [number, number, number]; size: [number, number, number]; hipHeight: number }
  anchored: boolean
  controller: 'Humanoid' | 'AnimationController'
  walk: StudioKeyframe[]
  clips: StudioClip[]
}

/** The Roblox front mirror: negate X and Z, keep Y (`:890`). */
function mirrorFront(value: readonly number[]): [number, number, number] {
  // `-0` is arithmetically right but leaks into comparisons and Luau source, so
  // it is normalised here the way the OBJ writer normalises it.
  return [negZero(value[0]), value[1], negZero(value[2])]
}

/** Negate a coordinate, mapping `-0` to `0`. */
function negZero(value: number): number {
  return value === 0 ? 0 : -value
}

/**
 * Part centres and pivots, mirrored into Roblox space (`Q`, `:889-907`).
 *
 * A merged model has one part whose pivot is forced to the origin: a merged
 * mesh has no meaningful per-part pivot, and `assembleLuau` uses the pivot to
 * set `PivotOffset`.
 */
export function partsForStudio(model: Model, { merge = false } = {}): StudioPart[] {
  return partGroups(model, { merge }).map((group) => {
    const centre: [number, number, number] = [
      (group.bounds.min[0] + group.bounds.max[0]) / 2,
      (group.bounds.min[1] + group.bounds.max[1]) / 2,
      (group.bounds.min[2] + group.bounds.max[2]) / 2
    ]
    return {
      name: merge ? model.name : group.name,
      center: mirrorFront(centre),
      pivot: merge ? [0, 0, 0] : mirrorFront(group.pivot)
    }
  })
}

/**
 * The largest part by bounding-box volume (`:570-577`).
 *
 * Computed rather than assumed: the GLB part order is not guaranteed stable
 * across a rebuild, so "the first part" would pick a different root after a
 * regeneration.
 */
export function rootPartOf(groups: PartGroup[]): PartGroup | null {
  let best: PartGroup | null = null
  let bestVolume = -1
  for (const group of groups) {
    const volume = group.bounds.size[0] * group.bounds.size[1] * group.bounds.size[2]
    if (volume > bestVolume) {
      best = group
      bestVolume = volume
    }
  }
  return best
}

/**
 * The canonical R15/R6 joint table for a rig, or the spec's own bones.
 *
 * `jointsOf` (`rig-CDpj6dii.js:117-154`): a canonical rig contributes its table
 * with any declared axis and limits merged in; a `custom` rig uses the declared
 * skeleton, filling in a default parent and joint name.
 */
export function jointsFor(model: Model, groups: PartGroup[]): StudioJoint[] {
  const pivots = Object.fromEntries(groups.map((group) => [group.name, group.pivot]))
  const declared = (model.rigSpec?.skeleton ?? []) as {
    part: string
    parent?: string
    joint?: string
  }[]

  return declared
    .filter((bone) => bone?.part)
    .map((bone) => ({
      part: bone.part,
      parent: bone.parent ?? 'HumanoidRootPart',
      joint: bone.joint ?? bone.part,
      // The pivot is mirrored here: it came from spec space.
      pivot: mirrorFront(pivots[bone.part] ?? [0, 0, 0])
    }))
}

/**
 * The hip block the rig script builds (`d`, `rig-CDpj6dii.js:227-249`).
 *
 * The centre comes from the torso parts when they exist, so the humanoid's
 * root sits inside the body rather than at the model origin. `hipHeight` is the
 * gap between that centre and the lowest point, which is what a Humanoid needs
 * to stand correctly.
 */
export function rigRoot(
  groups: PartGroup[],
  joints: StudioJoint[]
): { center: [number, number, number]; size: [number, number, number]; hipHeight: number } {
  const byName = Object.fromEntries(groups.map((group) => [group.name, group]))
  const torso = ['LowerTorso', 'UpperTorso', 'Torso']
    .map((name) => byName[name])
    .filter(Boolean) as PartGroup[]

  const lowest = Math.min(...groups.map((group) => group.bounds.min[1]))

  let centre: [number, number, number]
  let width = 2
  if (torso.length) {
    const min = [0, 1, 2].map((axis) => Math.min(...torso.map((group) => group.bounds.min[axis])))
    const max = [0, 1, 2].map((axis) => Math.max(...torso.map((group) => group.bounds.max[axis])))
    centre = [0, 1, 2].map((axis) => (min[axis] + max[axis]) / 2) as [number, number, number]
    width = Math.max(0.5, max[0] - min[0])
  } else {
    const root = joints.find((joint) => joint.parent === 'HumanoidRootPart')
    centre = root ? [...root.pivot] : [0, 1, 0]
  }

  const size: [number, number, number] = [width, width, width / 2]
  const hipHeight = Math.max(0, centre[1] - size[1] / 2 - lowest)
  return { center: mirrorFront(centre), size, hipHeight }
}

/** A bone's joint, for the pose generator. */
interface PoseJoint {
  part: string
}

/**
 * The test walk (`q`, `:644-658`).
 *
 * 9 keyframes at 8 intervals. The period is 1.1 s for a humanoid and 0.9 s for
 * a custom rig, because a quadruped walks faster. Poses are mirrored on X and Z
 * because they came from spec space.
 */
export function testWalk(
  rig: string,
  joints: PoseJoint[],
  { period = rig === 'custom' ? 0.9 : 1.1, frames = 8 } = {}
): StudioKeyframe[] {
  return Array.from({ length: frames + 1 }, (_, index) => {
    const time = (period * index) / frames
    return {
      time: Number(time.toFixed(4)),
      poses: poseAt(joints, time, period)
    }
  })
}

/**
 * One walk pose at `time` (`h`, `rigPose-DgicNbzf.js:107-147`).
 *
 * The rules are name-driven: a part matching `leg|thigh|shin|paw|foot|calf`
 * swings, a tail sways, a head nods, a wing flaps, an ear twitches. Left and
 * right legs swing in antiphase, and a front leg is offset from a back leg, so
 * the walk reads as a walk rather than a hop.
 */
export function poseAt(
  joints: PoseJoint[],
  time: number,
  period: number,
  amplitude = 25
): Record<string, [number, number, number]> {
  const phase = ((time % period) / period) * Math.PI * 2
  const wave = Math.sin(phase)
  const poses: Record<string, [number, number, number]> = {}

  for (const joint of joints) {
    const name = joint.part
    const isLeg = /leg|thigh|shin|paw|foot|calf/i.test(name)
    const isLeft = /left|L$/i.test(name)
    const isFront = /front|fore/i.test(name) || (/arm/i.test(name) && !/back|hind|rear/i.test(name))
    const isLower = /lower|shin|calf|paw|foot|knee|elbow/i.test(name)

    if (isLeg) {
      const direction = (isLeft ? 1 : -1) * (isFront ? 1 : -1)
      const swing = -amplitude * wave * direction
      poses[name] = isLower
        ? [Math.max(0, amplitude * 1.4 * -wave * direction), 0, 0]
        : [swing, 0, 0]
    } else if (/tail/i.test(name)) {
      poses[name] = [0, 25 * Math.sin(phase * 2), 0]
    } else if (/head|neck/i.test(name)) {
      poses[name] = [6 * Math.sin(phase * 2), 0, 0]
    } else if (/wing/i.test(name)) {
      poses[name] = [0, 0, (isLeft ? 1 : -1) * 40 * Math.sin(phase * 2)]
    } else if (/ear/i.test(name)) {
      poses[name] = [0, 0, (isLeft ? 1 : -1) * 6 * Math.sin(phase * 3)]
    } else if (/body|spine|chest|pelvis|torso/i.test(name)) {
      poses[name] = [0, 0, Math.sin(phase * 2) * 2]
    }
  }

  return poses
}

/**
 * Everything the rigged script needs, or `null` when the model has no bones
 * (`rigForStudio`, `:849-878`).
 *
 * `model.rigSpec` is the **only** gate. There is no "rigged but no rigSpec"
 * state, which is why this cannot disagree with `shouldMerge`.
 */
export function rigForStudio(
  model: Model,
  { anchored = true }: { anchored?: boolean } = {}
): StudioRig | null {
  if (!model.rigSpec) return null

  const groups = partGroups(model)
  const joints = jointsFor(model, groups)
  const parts = partsForStudio(model)
  const controller = model.rigSpec.rig === 'custom' ? 'AnimationController' : 'Humanoid'

  return {
    rig: model.rigSpec.rig,
    joints,
    parts,
    root: rigRoot(groups, joints),
    anchored,
    controller,
    walk: testWalk(model.rigSpec.rig, joints),
    clips: modelClips(model)
  }
}

/**
 * The model's own clips, if the spec declares any (`Z`, `:879-887`).
 *
 * Keyframe times are the union of every track's times, deduplicated and sorted,
 * and each pose is mirrored. `loop` is hard-coded true: the emitted script has
 * no way to express a one-shot clip.
 */
export function modelClips(model: Model): StudioClip[] {
  const clips = (model.motion as { clips?: Record<string, unknown> } | undefined)?.clips
  if (!clips) return []

  const out: StudioClip[] = []
  for (const [name, clip] of Object.entries(clips)) {
    const trackSet = clip as { duration?: number; tracks?: Record<string, { times?: number[] }> }
    const times = [
      ...new Set(Object.values(trackSet.tracks ?? {}).flatMap((track) => track.times ?? []))
    ].sort((a, b) => a - b)

    out.push({
      name,
      loop: true,
      keyframes: times.map((time) => ({
        time: Number(time.toFixed(4)),
        poses: sampleClipPoses(trackSet, time)
      }))
    })
  }
  return out
}

/**
 * Sample every track of a clip at `time`, linearly interpolated.
 *
 * Sampling exactly at `duration` would read past the last key, so the original
 * clamps to `duration - 1e-6`; the same clamp is here.
 */
function sampleClipPoses(
  clip: { duration?: number; tracks?: Record<string, { times?: number[]; rot?: number[][] }> },
  time: number
): Record<string, [number, number, number]> {
  const duration = clip.duration ?? 1
  const at = time >= duration ? duration - 0.000001 : time
  const poses: Record<string, [number, number, number]> = {}

  for (const [part, track] of Object.entries(clip.tracks ?? {})) {
    const times = track.times ?? []
    const rotations = track.rot ?? []
    if (!times.length || !rotations.length) continue

    let index = 0
    while (index < times.length - 1 && times[index + 1] <= at) index++
    const next = Math.min(index + 1, times.length - 1)
    const span = times[next] - times[index]
    const alpha = span > 0 ? (at - times[index]) / span : 0

    const from = rotations[index] ?? [0, 0, 0]
    const to = rotations[next] ?? from
    const blended: [number, number, number] = [
      from[0] + (to[0] - from[0]) * alpha,
      from[1] + (to[1] - from[1]) * alpha,
      from[2] + (to[2] - from[2]) * alpha
    ]
    poses[part] = mirrorFront(blended)
  }

  return poses
}

/** A Luau vector literal. */
function v3(value: readonly number[]): string {
  return `Vector3.new(${fmt(value[0])}, ${fmt(value[1])}, ${fmt(value[2])})`
}

/** A number as Luau source: integers plain, fractions to 4 dp, `-0` as `0`. */
function fmt(value: number): string {
  if (Math.abs(value) < 1e-9) return '0'
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}

/** A quoted Luau string. */
function q(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** A `{name = ..., center = ..., pivot = ...}` table per part. */
function partsTable(parts: StudioPart[]): string {
  const rows = parts.map(
    (part) => `\t{ name = ${q(part.name)}, center = ${v3(part.center)}, pivot = ${v3(part.pivot)} }`
  )
  return `{\n${rows.join(',\n')}\n}`
}

/** The accessory types the Luau emitter accepts, in `oe` order (`:537`). */
export const STUDIO_ACCESSORY_TYPES = [
  'Hat',
  'Hair',
  'Face',
  'Neck',
  'Shoulder',
  'Front',
  'Back',
  'Waist'
] as const

/**
 * The non-rigged insert script (`assembleLuau`, `:541-643`).
 *
 * Three behaviours are load-bearing:
 *
 *  - `found[name] = found[name] or part` is first-wins, because Roblox renames
 *    duplicate part names on import (`Part`, `Part`, becomes `Part`, `Part1`).
 *  - A single merged part arrives under a name Roblox chose, so it is recovered
 *    by type rather than by name.
 *  - The offset is taken from the first matched part, so the assembly keeps its
 *    internal geometry wherever the upload happened to land.
 */
export function assembleLuau({
  assetId,
  name,
  category,
  kind,
  attachment,
  parts,
  merge = false
}: {
  assetId: number
  name: string
  category?: string
  kind?: string
  attachment?: string
  parts: StudioPart[]
  merge?: boolean
}): string {
  // An unknown accessory type is rejected here rather than silently becoming a
  // Hat, which is the one thing `15/01` §6 says not to copy from the original.
  const accessory =
    category === 'accessory' && kind && STUDIO_ACCESSORY_TYPES.includes(kind as never)
      ? kind
      : category === 'accessory'
        ? 'Hat'
        : null
  const attachmentName = attachment ?? (accessory ? ACCESSORY_BOUNDS[accessory]?.attachment : null)

  return `local InsertService = game:GetService("InsertService")
local ok, loaded = pcall(function() return InsertService:LoadAsset(${Math.trunc(assetId)}) end)
if not ok then return "LOAD_FAILED: " .. tostring(loaded) end

local PARTS = ${partsTable(parts)}

local found = {}
for _, d in ipairs(loaded:GetDescendants()) do
\tif d:IsA("BasePart") then found[d.Name] = found[d.Name] or d end
end
if #PARTS == 1 and not found[PARTS[1].name] then
\tlocal only = loaded:FindFirstChildWhichIsA("BasePart", true)
\tif only then found[PARTS[1].name] = only end
end

local offset
for _, p in ipairs(PARTS) do
\tlocal part = found[p.name]
\tif part then offset = part.Position - p.center break end
end
if not offset then return "NO_PARTS: the upload has no mesh parts" end

local origin = CFrame.new(offset)
local root = nil
local best = -1
for _, p in ipairs(PARTS) do
\tlocal part = found[p.name]
\tif part then
\t\tlocal size = part.Size
\t\tlocal volume = size.X * size.Y * size.Z
\t\tif volume > best then best = volume root = part end
\tend
end

local category = ${q(category ?? 'prop')}
local container
if category == "accessory" then
\tcontainer = Instance.new("Accessory")
\tcontainer.AccessoryType = Enum.AccessoryType.${accessory ?? 'Hat'}
elseif category == "tool" then
\tcontainer = Instance.new("Tool")
else
\tcontainer = Instance.new("Model")
end
container.Name = ${q(name)}

local held = category == "accessory" or category == "tool"
local placed, motors, welds = 0, 0, 0

for _, p in ipairs(PARTS) do
\tlocal part = found[p.name]
\tif part then
\t\tlocal pivotWorld = CFrame.new(p.pivot + offset)
\t\tpart.Name = p.name
\t\tpart.PivotOffset = part.CFrame:ToObjectSpace(pivotWorld)
\t\tpart.CanCollide = not held
\t\tpart.Anchored = (part == root) and not held
\t\tif held and part ~= root then part.Massless = true end
\t\tpart.Parent = container
\t\tplaced = placed + 1
\t\tif root and part ~= root then
\t\t\tif category == "building" then
\t\t\t\tlocal w = Instance.new("WeldConstraint")
\t\t\t\tw.Part0, w.Part1 = root, part
\t\t\t\tw.Parent = part
\t\t\t\twelds = welds + 1
\t\t\telse
\t\t\t\tlocal m = Instance.new("Motor6D")
\t\t\t\tm.Name = p.name
\t\t\t\tm.Part0, m.Part1 = root, part
\t\t\t\tm.C0 = root.CFrame:ToObjectSpace(pivotWorld)
\t\t\t\tm.C1 = part.CFrame:ToObjectSpace(pivotWorld)
\t\t\t\tm.Parent = root
\t\t\t\tmotors = motors + 1
\t\t\tend
\t\tend
\tend
end

if not root then return "NO_PARTS: the upload has no mesh parts" end

if category == "accessory" then
\troot.Name = "Handle"
\tlocal att = Instance.new("Attachment")
\tatt.Name = ${q(attachmentName ?? 'HatAttachment')}
\tatt.Position = root.CFrame:PointToObjectSpace(origin.Position)
\tatt.Parent = root
\tcontainer.Parent = workspace
elseif category == "tool" then
\troot.Name = "Handle"
\tcontainer.Grip = CFrame.new(root.CFrame:PointToObjectSpace(origin.Position))
\tcontainer.Parent = game:GetService("StarterPack")
else
\tcontainer.PrimaryPart = root
\tcontainer.WorldPivot = origin
\tcontainer.Parent = workspace
\tlocal cf, size = container:GetBoundingBox()
\tcontainer:PivotTo(container:GetPivot() + Vector3.new(-cf.X, size.Y/2 - cf.Y, -cf.Z))
end

return string.format("Inserted %s %s: %d part(s), %d motor(s), %d weld(s)",
\tcontainer.ClassName, container:GetFullName(), placed, motors, welds)
${merge ? '' : ''}`
}

/**
 * The rigged insert script (`assembleRigLuau`, `:659-835`).
 *
 * Builds a playable rig: a `HumanoidRootPart`, one `Motor6D` per joint with its
 * `*RigAttachment` pair, a `Humanoid` or `AnimationController`, and an
 * `AnimSaves` folder holding the test walk and any model clips.
 *
 * The `*RigAttachment` pairs are what the Animation Editor and
 * `BuildRigFromAttachments` read. Without them the rig looks correct but cannot
 * be authored on, which is why they are not optional.
 */
export function assembleRigLuau(rig: StudioRig, name: string): string {
  const joints = rig.joints
    .map(
      (joint) =>
        `\t{ part = ${q(joint.part)}, parent = ${q(joint.parent)}, joint = ${q(joint.joint)}, pivot = ${v3(joint.pivot)} }`
    )
    .join(',\n')

  const keyframes = (frames: StudioKeyframe[]): string =>
    frames
      .map((frame) => {
        const poses = Object.entries(frame.poses)
          .map(([part, rotation]) => `\t\t\t{ part = ${q(part)}, rot = ${v3(rotation)} }`)
          .join(',\n')
        return `\t\t{ time = ${fmt(frame.time)}, poses = {\n${poses}\n\t\t} }`
      })
      .join(',\n')

  const clips = rig.clips
    .map(
      (clip) =>
        `\t{ name = ${q(clip.name)}, loop = ${clip.loop}, keyframes = {\n${keyframes(clip.keyframes)}\n\t} }`
    )
    .join(',\n')

  const humanoidBlock =
    rig.controller === 'Humanoid'
      ? `\tlocal hum = Instance.new("Humanoid")
\thum.RigType = Enum.HumanoidRigType.${rig.rig === 'R6' ? 'R6' : 'R15'}
\thum.HipHeight = ${fmt(rig.root.hipHeight)}
\thum.Parent = model
\tlocal animator = Instance.new("Animator")
\tanimator.Parent = hum`
      : `\tlocal controller = Instance.new("AnimationController")
\tcontroller.Parent = model
\tlocal animator = Instance.new("Animator")
\tanimator.Parent = controller`

  return `local PARTS = ${partsTable(rig.parts)}

local JOINTS = {
${joints}
}

local ROOT = { center = ${v3(rig.root.center)}, size = ${v3(rig.root.size)}, hipHeight = ${fmt(rig.root.hipHeight)} }

local WALK = {
${keyframes(rig.walk)}
}

local CLIPS = {
${clips}
}

local found = {}
for _, d in ipairs(loaded:GetDescendants()) do
\tif d:IsA("BasePart") and PARTS then found[d.Name] = found[d.Name] or d end
end

local model = Instance.new("Model")
model.Name = ${q(name)}

local rootPart = Instance.new("Part")
rootPart.Name = "HumanoidRootPart"
rootPart.Size = ROOT.size
rootPart.Transparency = 1
rootPart.CanCollide = false
rootPart.Anchored = ${rig.anchored ? 'true' : 'false'}
rootPart.Parent = model

local byName = { HumanoidRootPart = rootPart }
for _, p in ipairs(PARTS) do
\tlocal part = found[p.name]
\tif part then
\t\tpart.Name = p.name
\t\tpart.Anchored = false
\t\tpart.CanCollide = false
\t\tpart.Massless = true
\t\tpart.Parent = model
\t\tbyName[p.name] = part
\tend
end

local motors, placed = 0, 0
for _, j in ipairs(JOINTS) do
\tlocal part = byName[j.part]
\tlocal parent = byName[j.parent] or rootPart
\tif part and parent then
\t\tlocal m = Instance.new("Motor6D")
\t\tm.Name = j.joint
\t\tm.Part0, m.Part1 = parent, part
\t\tm.C0 = CFrame.new(j.pivot) * parent.CFrame:ToObjectSpace(part.CFrame):Inverse()
\t\tm.C1 = CFrame.new()
\t\tm.Parent = parent

\t\tlocal a0 = Instance.new("Attachment")
\t\ta0.Name = (j.joint:gsub("%s", "")) .. "RigAttachment"
\t\ta0.CFrame = m.C0
\t\ta0.Parent = parent
\t\tlocal a1 = a0:Clone()
\t\ta1.CFrame = m.C1
\t\ta1.Parent = part
\t\tmotors = motors + 1
\t\tplaced = placed + 1
\tend
end

${humanoidBlock}

local function buildSequence(sequenceName, frames, loop, priority)
\tlocal sequence = Instance.new("KeyframeSequence")
\tsequence.Name = sequenceName
\tsequence.Loop = loop
\tsequence.Priority = priority
\tlocal poseOf = {}
\tfor _, frame in ipairs(frames) do
\t\tlocal keyframe = Instance.new("Keyframe")
\t\tkeyframe.Time = frame.time
\t\tfor _, pose in ipairs(frame.poses) do
\t\t\tlocal target = poseOf[pose.part]
\t\t\tif not target then
\t\t\t\ttarget = Instance.new("Pose")
\t\t\t\ttarget.Name = pose.part
\t\t\t\ttarget.Parent = keyframe
\t\t\t\tposeOf[pose.part] = target
\t\t\tend
\t\t\ttarget.CFrame = CFrame.Angles(math.rad(pose.rot.X), math.rad(pose.rot.Y), math.rad(pose.rot.Z))
\t\tend
\t\tkeyframe.Parent = sequence
\tend
\treturn sequence
end

local saves = Instance.new("Folder")
saves.Name = "AnimSaves"
saves.Parent = model

local walk = buildSequence(${q('Termul Walk')}, WALK, true, Enum.AnimationPriority.Movement)
walk.Parent = saves

for _, clip in ipairs(CLIPS) do
\tlocal sequence = buildSequence(clip.name, clip.keyframes, clip.loop, Enum.AnimationPriority.Action)
\tsequence.Parent = saves
end

local test = Instance.new("Script")
test.Name = "PlayTestWalk"
test.Enabled = false
test.Source = [[
-- Plays Termul's test walk on this rig in a playtest. A KeyframeSequence
-- registered this way works in Studio only: publish it from the Animation
-- Editor (Rig -> AnimSaves -> ${'Termul Walk'}) for a live game.
local model = script.Parent
local seq = model:WaitForChild("AnimSaves"):WaitForChild("${'Termul Walk'}")
local id = game:GetService("KeyframeSequenceProvider"):RegisterKeyframeSequence(seq)
local anim = Instance.new("Animation")
anim.AnimationId = id
local animator = model:FindFirstChildWhichIsA("Animator", true)
animator:LoadAnimation(anim):Play()
model.HumanoidRootPart.Anchored = false
local hum = model:FindFirstChildOfClass("Humanoid")
if hum then hum:MoveTo(model.HumanoidRootPart.Position + model.HumanoidRootPart.CFrame.LookVector * 30) end
]]
test.Parent = model

model.PrimaryPart = rootPart
model.Parent = workspace

return string.format("Inserted %s %s: %d part(s), %d motor(s), %d weld(s)",
\tmodel.ClassName, model:GetFullName(), placed, motors, 0)
`
}

/**
 * The outer wrapper that loads the uploaded asset (`insertLuau`, `:836-848`).
 *
 * The asset id is interpolated as a **number**, so no quoting bug is possible.
 * The body is wrapped in `pcall` and the failure is *returned* as a string, not
 * thrown: that is what lets `sendToStudio` keep the asset id when the insert
 * fails, which is invariant I5.
 */
export function insertLuau({
  assetId,
  name,
  rig,
  ...rest
}: {
  assetId: number
  name: string
  rig?: StudioRig | null
  category?: string
  kind?: string
  attachment?: string
  parts?: StudioPart[]
  merge?: boolean
}): string {
  const body = rig
    ? assembleRigLuau(rig, name)
    : assembleLuau({
        assetId,
        name,
        category: rest.category,
        kind: rest.kind,
        attachment: rest.attachment,
        parts: rest.parts ?? [],
        merge: rest.merge
      })

  if (rig) {
    // The rig script is already complete; it only needs the load prologue.
    return `local InsertService = game:GetService("InsertService")
local ok, loaded = pcall(function() return InsertService:LoadAsset(${Math.trunc(assetId)}) end)
if not ok then return "LOAD_FAILED: " .. tostring(loaded) end

${body}`
  }

  return body
}

/** What `sendToStudio` needs from the outside world. */
export interface StudioUploader {
  /**
   * Upload a GLB as a Model asset and return the asset id once Roblox has
   * processed it, or a moderation note when it has not.
   *
   * `token` is the Open Cloud bearer. It is passed per call rather than held by
   * the uploader, because the token belongs to the user's session and can be
   * rotated between two sends.
   */
  upload: (request: {
    token: string
    name: string
    description: string
    filename: string
    data: Uint8Array
  }) => Promise<{ assetId?: number; moderationNote?: string }>
  /** Run Luau in the open place and return its text result. */
  executeLuau: (code: string) => Promise<string>
}

/** What a successful send produced. */
export interface StudioSendResult {
  assetId: number
  message: string
  /** Present when the insert failed after a successful upload. */
  recovery?: string
}

/**
 * Upload a model and insert it into the open place.
 *
 * The order and the five invariants follow `sendToStudio` exactly (`15/01`
 * §1.1): the place is checked **before** any upload work, only `level:'error'`
 * blocks, a rigged model always forces `merge` off, an accessory defaults it on,
 * and a `LOAD_FAILED` still returns the asset id with a recovery message.
 */
export async function sendToStudio({
  token,
  studio,
  model,
  report,
  category,
  accessoryType,
  prompt,
  merge,
  anchored = true,
  onProgress,
  uploader
}: {
  token: string
  studio: { studioId?: string | null } | null | undefined
  model: Model
  /** The category report from `checkModel`; only its errors can block a send. */
  report?: { issues?: { level: string; message: string }[] }
  category?: string
  accessoryType?: string
  prompt?: string
  merge?: boolean
  anchored?: boolean
  onProgress?: (detail: string) => void
  uploader: StudioUploader
}): Promise<StudioSendResult> {
  // I1: a missing Studio must fail before an upload is attempted.
  if (!studio?.studioId) throw new StudioUnavailable()

  // I2: only errors block. Warnings pass, which is what makes a near-limit
  // accessory insertable.
  const errors = report?.issues?.filter((issue) => issue.level === 'error')
  if (errors?.length) throw new StudioRejected(errors.map((issue) => issue.message))

  const name = sanitizeName(model.name)

  // I3 and I4: a rigged model always splits, an accessory defaults to merged.
  const rigged = Boolean(model.rigSpec)
  const effectiveMerge = rigged ? false : (merge ?? category === 'accessory')

  const rig = rigForStudio(model, { anchored })
  const parts = partsForStudio(model, { merge: effectiveMerge })
  const attachment =
    category === 'accessory' && accessoryType
      ? ACCESSORY_BOUNDS[accessoryType]?.attachment
      : undefined

  onProgress?.('Uploading the model to your Roblox account…')
  const uploaded = await uploader.upload({
    token,
    name,
    description: `Made with Termul: ${prompt ?? model.name}`.slice(0, 900),
    filename: `${name}.glb`,
    data: toGlb(model, { name, merge: effectiveMerge })
  })

  onProgress?.('Waiting for Roblox to process the upload…')
  if (!uploaded.assetId) {
    throw new Error(
      uploaded.moderationNote ??
        'Roblox has not finished processing the upload yet. It will appear under My Models when it does.'
    )
  }

  onProgress?.('Inserting it into the open place…')
  const code = insertLuau({
    assetId: uploaded.assetId,
    name,
    rig,
    category,
    kind: accessoryType,
    attachment,
    parts,
    merge: effectiveMerge
  })

  const message = await uploader.executeLuau(code)

  // I5: a failed insert is not a failed upload.
  if (/LOAD_FAILED/.test(message)) {
    return {
      assetId: uploaded.assetId,
      message,
      recovery:
        `Uploaded as asset ${uploaded.assetId}, but Studio could not insert it yet ` +
        `(${message.replace('LOAD_FAILED: ', '')}). Insert it from Toolbox → My Models, ` +
        'or import the GLB from the workspace with the 3D Importer.'
    }
  }

  return { assetId: uploaded.assetId, message }
}

/** A short description of what a send will contain, for a confirmation dialog. */
export function describeSend(
  model: Model,
  {
    category,
    accessoryType,
    merge
  }: { category?: string; accessoryType?: string; merge?: boolean } = {}
): {
  parts: number
  triangles: number
  merge: boolean
  rigged: boolean
  container: 'Accessory' | 'Tool' | 'Model'
  attachment?: string
} {
  const rigged = Boolean(model.rigSpec)
  const effectiveMerge = rigged ? false : (merge ?? category === 'accessory')
  const groups = partGroups(model, { merge: effectiveMerge })

  return {
    parts: groups.length,
    triangles: modelTriangles(model),
    merge: effectiveMerge,
    rigged,
    container: category === 'accessory' ? 'Accessory' : category === 'tool' ? 'Tool' : 'Model',
    attachment:
      category === 'accessory' && accessoryType
        ? ACCESSORY_BOUNDS[accessoryType]?.attachment
        : undefined
  }
}
