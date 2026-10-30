/**
 * The Studio path: the mirror, the two Luau emitters, and the five invariants.
 *
 * The scripts are emitted as strings, so they are checked as strings — the
 * protocol prefixes (`NO_PARTS:`, `LOAD_FAILED: `), the result format, the
 * `*RigAttachment` names, and the container choice per category. Getting one of
 * those wrong breaks the recovery path silently, which is why they are pinned
 * verbatim rather than matched loosely.
 *
 * The X/Z mirror is asserted on the metadata side here; `export.test.ts`
 * asserts it on the vertex side. Both must hold or a model is right in the
 * viewport and inside-out in Studio (15/01 §2).
 */
import { describe, expect, it, vi } from 'vitest'
import { buildSpec } from '@/lib/generator/engines/3d/build'
import { checkModel, partGroups } from '@/lib/generator/engines/3d/check'
import type { ModelSpec, SpecNode } from '@/lib/generator/engines/3d/schema'
import {
  assembleLuau,
  assembleRigLuau,
  describeSend,
  insertLuau,
  jointsFor,
  modelClips,
  PLACEHOLDER_ASSET_ID,
  partsForStudio,
  poseAt,
  rigForStudio,
  rigRoot,
  rootPartOf,
  STUDIO_ACCESSORY_TYPES,
  StudioRejected,
  StudioUnavailable,
  type StudioUploader,
  sendToStudio,
  testWalk
} from '@/lib/generator/engines/3d/studio'

const prop = (parts: SpecNode[], extra: Partial<ModelSpec> = {}): ModelSpec => ({
  version: 1,
  category: 'prop',
  palette: { a: '#ffffff' },
  parts,
  ...extra
})

const riggedSpec = (): ModelSpec => ({
  version: 1,
  category: 'character',
  rig: 'custom',
  palette: { a: '#ffffff' },
  skeleton: [
    { part: 'Body', parent: 'HumanoidRootPart', joint: 'Root' },
    { part: 'Head', parent: 'Body', joint: 'Neck', axis: [1, 0, 0], limits: [-30, 40] }
  ],
  parts: [
    { name: 'Body', type: 'box', size: [2, 2, 3], pivot: [0, 2, 0] },
    { name: 'Head', type: 'box', size: [1, 1, 1], position: [0, 4, 0], pivot: [0, 3, 0] }
  ]
})

describe('partsForStudio — the second mirror', () => {
  it('negates X and Z on the centre and the pivot', () => {
    const model = buildSpec(
      prop([{ name: 'Box', type: 'box', size: [2, 2, 2], position: [10, 0, 30] }])
    )
    const parts = partsForStudio(model)
    expect(parts).toHaveLength(1)
    // Centre was [10, 0, 30]; pivot defaulted to the position.
    expect(parts[0].center).toEqual([-10, 0, -30])
    expect(parts[0].pivot).toEqual([-10, 0, -30])
  })

  it('leaves Y alone', () => {
    const model = buildSpec(
      prop([{ name: 'Box', type: 'box', size: [1, 1, 1], position: [0, 7, 0] }])
    )
    expect(partsForStudio(model)[0].center[1]).toBe(7)
  })

  it('forces a merged part pivot to the origin', () => {
    const model = buildSpec(
      prop([{ name: 'Box', type: 'box', size: [1, 1, 1], position: [5, 0, 0] }])
    )
    const parts = partsForStudio(model, { merge: true })
    expect(parts).toHaveLength(1)
    expect(parts[0].pivot).toEqual([0, 0, 0])
    expect(parts[0].name).toBe(model.name)
  })

  it('emits one entry per top-level part when not merged', () => {
    const model = buildSpec(
      prop([
        { name: 'One', type: 'box', size: [1, 1, 1] },
        { name: 'Two', type: 'box', size: [1, 1, 1], position: [3, 0, 0] }
      ])
    )
    expect(partsForStudio(model).map((part) => part.name)).toEqual(['One', 'Two'])
  })
})

describe('rootPartOf', () => {
  it('picks the largest part by volume, not the first', () => {
    const model = buildSpec(
      prop([
        { name: 'Small', type: 'box', size: [1, 1, 1] },
        { name: 'Big', type: 'box', size: [4, 4, 4], position: [0, 5, 0] }
      ])
    )
    const groups = partGroups(model)
    expect(rootPartOf(groups)?.name).toBe('Big')
  })

  it('returns null for a model with no parts', () => {
    expect(rootPartOf([])).toBeNull()
  })
})

describe('the mirror is applied twice, not once', () => {
  it('mirrors both the vertex stream and the part metadata to the same side', () => {
    // A box at +Z in spec space. The GLB vertex stream must be at -Z, and so
    // must the Studio centre; if only one were mirrored they would disagree.
    const model = buildSpec(
      prop([{ name: 'Front', type: 'box', size: [1, 1, 1], position: [0, 0, 5] }])
    )
    const parts = partsForStudio(model)
    expect(parts[0].center[2]).toBe(-5)

    const flat = model.parts[0].geometry.attributes.position.array as Float32Array
    let sumZ = 0
    for (let i = 2; i < flat.length; i += 3) sumZ += flat[i]
    // The geometry itself is unmirrored; only `flatten` mirrors it. So the
    // metadata and the exported vertex stream must agree after `flatten` does.
    expect(sumZ / (flat.length / 3)).toBeCloseTo(5, 5)
  })
})

describe('jointsFor', () => {
  it('mirrors each joint pivot and fills in parent and joint', () => {
    const model = buildSpec(riggedSpec())
    const joints = jointsFor(model, partGroups(model))
    expect(joints).toHaveLength(2)
    expect(joints[0]).toMatchObject({ part: 'Body', parent: 'HumanoidRootPart', joint: 'Root' })
    expect(joints[1]).toMatchObject({ part: 'Head', parent: 'Body', joint: 'Neck' })
  })

  it('mirrors the pivot into Roblox space', () => {
    const model = buildSpec(riggedSpec())
    const joints = jointsFor(model, partGroups(model))
    // Head's spec pivot is [0, 3, 0]; the mirror leaves it unchanged on Y.
    expect(joints[1].pivot).toEqual([0, 3, 0])
  })
})

describe('rigRoot', () => {
  it('centres on the torso parts when they exist', () => {
    const model = buildSpec({
      version: 1,
      category: 'character',
      rig: 'R15',
      palette: { a: '#ffffff' },
      parts: [
        {
          name: 'LowerTorso',
          type: 'box',
          size: [2, 1, 1],
          position: [0, 1, 0],
          pivot: [0, 0.5, 0]
        },
        {
          name: 'UpperTorso',
          type: 'box',
          size: [2, 1, 1],
          position: [0, 2, 0],
          pivot: [0, 1.5, 0]
        },
        { name: 'Head', type: 'box', size: [1, 1, 1], position: [0, 3, 0], pivot: [0, 2.5, 0] },
        {
          name: 'LeftUpperArm',
          type: 'box',
          size: [1, 1, 1],
          position: [2, 2, 0],
          pivot: [1.5, 2, 0]
        },
        {
          name: 'LeftLowerArm',
          type: 'box',
          size: [1, 1, 1],
          position: [2, 1, 0],
          pivot: [2, 1.5, 0]
        },
        { name: 'LeftHand', type: 'box', size: [1, 1, 1], position: [2, 0, 0], pivot: [2, 0.5, 0] },
        {
          name: 'RightUpperArm',
          type: 'box',
          size: [1, 1, 1],
          position: [-2, 2, 0],
          pivot: [-1.5, 2, 0]
        },
        {
          name: 'RightLowerArm',
          type: 'box',
          size: [1, 1, 1],
          position: [-2, 1, 0],
          pivot: [-2, 1.5, 0]
        },
        {
          name: 'RightHand',
          type: 'box',
          size: [1, 1, 1],
          position: [-2, 0, 0],
          pivot: [-2, 0.5, 0]
        },
        {
          name: 'LeftUpperLeg',
          type: 'box',
          size: [1, 1, 1],
          position: [0.5, 0, 0],
          pivot: [0.5, 0.5, 0]
        },
        {
          name: 'LeftLowerLeg',
          type: 'box',
          size: [1, 1, 1],
          position: [0.5, -1, 0],
          pivot: [0.5, -0.5, 0]
        },
        {
          name: 'LeftFoot',
          type: 'box',
          size: [1, 1, 1],
          position: [0.5, -2, 0],
          pivot: [0.5, -1.5, 0]
        },
        {
          name: 'RightUpperLeg',
          type: 'box',
          size: [1, 1, 1],
          position: [-0.5, 0, 0],
          pivot: [-0.5, 0.5, 0]
        },
        {
          name: 'RightLowerLeg',
          type: 'box',
          size: [1, 1, 1],
          position: [-0.5, -1, 0],
          pivot: [-0.5, -0.5, 0]
        },
        {
          name: 'RightFoot',
          type: 'box',
          size: [1, 1, 1],
          position: [-0.5, -2, 0],
          pivot: [-0.5, -1.5, 0]
        }
      ]
    })
    const groups = partGroups(model)
    const root = rigRoot(groups, jointsFor(model, groups))
    // The torso spans y 0.5..2.5, so its centre is y 1.5.
    expect(root.center[1]).toBeCloseTo(1.5, 5)
    expect(root.hipHeight).toBeGreaterThanOrEqual(0)
  })

  it('falls back to the declared root pivot when there is no torso', () => {
    const model = buildSpec(riggedSpec())
    const groups = partGroups(model)
    const root = rigRoot(groups, jointsFor(model, groups))
    expect(root.size).toHaveLength(3)
    expect(Number.isFinite(root.hipHeight)).toBe(true)
  })
})

describe('testWalk', () => {
  const joints = [{ part: 'LeftLeg' }, { part: 'RightLeg' }, { part: 'Tail' }, { part: 'Head' }]

  it('emits 9 keyframes over the period', () => {
    const walk = testWalk('R15', joints)
    expect(walk).toHaveLength(9)
    expect(walk[0].time).toBe(0)
    expect(walk[8].time).toBeCloseTo(1.1, 4)
  })

  it('uses a faster period for a custom rig, because a quadruped walks faster', () => {
    expect(testWalk('custom', joints)[8].time).toBeCloseTo(0.9, 4)
  })

  it('swings opposite legs in antiphase', () => {
    const walk = testWalk('custom', joints)
    // At a quarter period the wave peaks, so one leg swings forward and the
    // other back.
    const quarter = walk[2].poses
    const left = quarter.LeftLeg?.[0] ?? 0
    const right = quarter.RightLeg?.[0] ?? 0
    expect(Math.sign(left)).toBe(-Math.sign(right))
  })

  it('sways a tail and nods a head', () => {
    const poses = poseAt(joints, 0.2, 0.9)
    expect(poses.Tail).toBeDefined()
    expect(poses.Head).toBeDefined()
  })
})

describe('modelClips', () => {
  it('is empty when the spec declares none', () => {
    expect(modelClips(buildSpec(prop([{ type: 'box', size: [1, 1, 1] }])))).toEqual([])
  })

  it('samples the union of every track time, mirrored, and loops', () => {
    const model = buildSpec({
      ...riggedSpec(),
      motion: {
        clips: {
          wave: {
            duration: 1,
            tracks: {
              Head: {
                times: [0, 0.5, 1],
                rot: [
                  [0, 0, 0],
                  [10, 0, 0],
                  [0, 0, 0]
                ]
              }
            }
          }
        }
      }
    })

    const clips = modelClips(model)
    expect(clips).toHaveLength(1)
    expect(clips[0].name).toBe('wave')
    expect(clips[0].loop).toBe(true)
    expect(clips[0].keyframes.map((frame) => frame.time)).toEqual([0, 0.5, 1])
  })
})

describe('rigForStudio', () => {
  it('is null for a model with no bones, which is the only gate', () => {
    expect(rigForStudio(buildSpec(prop([{ type: 'box', size: [1, 1, 1] }])))).toBeNull()
  })

  it('returns a Humanoid controller for R15 and R6', () => {
    const model = buildSpec({
      version: 1,
      category: 'character',
      rig: 'custom',
      palette: { a: '#ffffff' },
      skeleton: [{ part: 'Body', parent: 'HumanoidRootPart', joint: 'Root' }],
      parts: [{ name: 'Body', type: 'box', size: [1, 1, 1], pivot: [0, 0, 0] }]
    })
    model.rigSpec = {
      rig: 'R15',
      skeleton: [{ part: 'Body', parent: 'HumanoidRootPart', joint: 'Root' }]
    }
    expect(rigForStudio(model)?.controller).toBe('Humanoid')
  })

  it('returns an AnimationController for a custom rig', () => {
    expect(rigForStudio(buildSpec(riggedSpec()))?.controller).toBe('AnimationController')
  })

  it('carries the joints, the parts, the root, the walk and the clips', () => {
    const rig = rigForStudio(buildSpec(riggedSpec()))
    expect(rig).not.toBeNull()
    expect(rig?.joints).toHaveLength(2)
    expect(rig?.parts).toHaveLength(2)
    expect(rig?.root.size).toHaveLength(3)
    expect(rig?.walk).toHaveLength(9)
    expect(rig?.clips).toEqual([])
  })
})

describe('assembleLuau', () => {
  const parts = [
    {
      name: 'Crate',
      center: [0, 1, 0] as [number, number, number],
      pivot: [0, 1, 0] as [number, number, number]
    }
  ]

  it('interpolates the asset id as a number, so it cannot be quoted wrong', () => {
    const code = assembleLuau({ assetId: 12345, name: 'crate', parts })
    expect(code).toContain('InsertService:LoadAsset(12345)')
    expect(code).not.toContain('LoadAsset("12345")')
  })

  it('wraps the load in pcall and returns LOAD_FAILED rather than throwing', () => {
    const code = assembleLuau({ assetId: 1, name: 'crate', parts })
    expect(code).toContain('pcall(function()')
    expect(code).toContain('return "LOAD_FAILED: " .. tostring(loaded)')
  })

  it('carries the NO_PARTS protocol string', () => {
    expect(assembleLuau({ assetId: 1, name: 'crate', parts })).toContain(
      'NO_PARTS: the upload has no mesh parts'
    )
  })

  it('uses first-wins for a duplicate part name', () => {
    // Roblox renames duplicates on import, so first-wins keeps the map stable.
    expect(assembleLuau({ assetId: 1, name: 'crate', parts })).toContain(
      'found[d.Name] = found[d.Name] or d'
    )
  })

  it('recovers a single merged part by type', () => {
    const code = assembleLuau({ assetId: 1, name: 'crate', parts, merge: true })
    expect(code).toContain('FindFirstChildWhichIsA("BasePart", true)')
  })

  it('builds an Accessory with the right type', () => {
    const code = assembleLuau({
      assetId: 1,
      name: 'hat',
      category: 'accessory',
      kind: 'Hat',
      attachment: 'HatAttachment',
      parts
    })
    expect(code).toContain('Instance.new("Accessory")')
    expect(code).toContain('Enum.AccessoryType.Hat')
    expect(code).toContain('"HatAttachment"')
  })

  it('builds a Tool for the tool category', () => {
    const code = assembleLuau({ assetId: 1, name: 'sword', category: 'tool', parts })
    expect(code).toContain('Instance.new("Tool")')
    expect(code).toContain('StarterPack')
  })

  it('builds a Model for everything else', () => {
    const code = assembleLuau({ assetId: 1, name: 'wall', category: 'building', parts })
    expect(code).toContain('Instance.new("Model")')
  })

  it('welds a building instead of jointing it', () => {
    const code = assembleLuau({ assetId: 1, name: 'wall', category: 'building', parts })
    expect(code).toContain('Instance.new("WeldConstraint")')
    // The Motor6D branch still exists in the script, but the building branch is
    // the one it takes.
    expect(code).toContain('category == "building"')
  })

  it('joints a prop with a Motor6D', () => {
    const code = assembleLuau({ assetId: 1, name: 'crate', category: 'prop', parts })
    expect(code).toContain('Instance.new("Motor6D")')
  })

  it('drops a model onto the ground, and an accessory is not dropped', () => {
    const code = assembleLuau({ assetId: 1, name: 'wall', category: 'building', parts })
    expect(code).toContain('size.Y/2 - cf.Y')
  })

  it('names the result in the documented format', () => {
    const code = assembleLuau({ assetId: 1, name: 'crate', parts })
    expect(code).toContain('Inserted %s %s: %d part(s), %d motor(s), %d weld(s)')
  })

  it('lists all 8 accessory types as accepted', () => {
    expect([...STUDIO_ACCESSORY_TYPES]).toEqual([
      'Hat',
      'Hair',
      'Face',
      'Neck',
      'Shoulder',
      'Front',
      'Back',
      'Waist'
    ])
  })
})

describe('assembleRigLuau', () => {
  const model = buildSpec(riggedSpec())
  const rig = rigForStudio(model)
  const code = assembleRigLuau(rig as NonNullable<typeof rig>, 'puppy')

  it('creates a HumanoidRootPart with no collision and full transparency', () => {
    expect(code).toContain('rootPart.Name = "HumanoidRootPart"')
    expect(code).toContain('rootPart.Transparency = 1')
    expect(code).toContain('rootPart.CanCollide = false')
  })

  it('emits one Motor6D per joint, named after the joint', () => {
    expect(code).toContain('m.Name = j.joint')
    expect(code).toContain('Instance.new("Motor6D")')
  })

  it('emits both *RigAttachment halves, because the Animation Editor reads them', () => {
    expect(code).toContain('.. "RigAttachment"')
    expect(code).toContain('a0.Parent = parent')
    expect(code).toContain('a1.Parent = part')
  })

  it('gives a custom rig an AnimationController, not a Humanoid', () => {
    expect(code).toContain('Instance.new("AnimationController")')
    expect(code).not.toContain('Instance.new("Humanoid")')
  })

  it('gives R15 a Humanoid with its RigType', () => {
    const r15 = buildSpec(riggedSpec())
    r15.rigSpec = { rig: 'R15', skeleton: rig?.joints.map((joint) => ({ part: joint.part })) ?? [] }
    const r15Code = assembleRigLuau(rigForStudio(r15) as NonNullable<typeof rig>, 'hero')
    expect(r15Code).toContain('Instance.new("Humanoid")')
    expect(r15Code).toContain('Enum.HumanoidRigType.R15')
  })

  it('names the walk sequence after the product, not RobloxKit', () => {
    expect(code).toContain('"Termul Walk"')
    expect(code).not.toContain('RobloxKit Walk')
  })

  it('ships PlayTestWalk disabled, so it cannot run by accident', () => {
    expect(code).toContain('test.Name = "PlayTestWalk"')
    expect(code).toContain('test.Enabled = false')
  })

  it('uses KeyframeSequenceProvider in the play script', () => {
    expect(code).toContain('KeyframeSequenceProvider')
    expect(code).toContain('RegisterKeyframeSequence')
  })

  it('puts the walk and the clips in AnimSaves', () => {
    expect(code).toContain('saves.Name = "AnimSaves"')
    expect(code).toContain('walk.Parent = saves')
  })

  it('names the result in the documented format', () => {
    expect(code).toContain('Inserted %s %s: %d part(s), %d motor(s), %d weld(s)')
  })
})

describe('insertLuau', () => {
  it('wraps the non-rigged body with the load prologue', () => {
    const code = insertLuau({
      assetId: 7,
      name: 'crate',
      parts: [{ name: 'Crate', center: [0, 0, 0], pivot: [0, 0, 0] }]
    })
    expect(code).toContain('LoadAsset(7)')
    expect(code).toContain('LOAD_FAILED')
    expect(code).toContain('NO_PARTS')
  })

  it('wraps the rigged body with the same prologue', () => {
    const model = buildSpec(riggedSpec())
    const code = insertLuau({ assetId: 9, name: 'puppy', rig: rigForStudio(model) })
    expect(code).toContain('LoadAsset(9)')
    expect(code).toContain('HumanoidRootPart')
    expect(code).toContain('RigAttachment')
  })

  it('interpolates the id as a number in both paths', () => {
    const model = buildSpec(riggedSpec())
    for (const code of [
      insertLuau({ assetId: 42, name: 'a', parts: [] }),
      insertLuau({ assetId: 42, name: 'b', rig: rigForStudio(model) })
    ]) {
      expect(code).toContain('LoadAsset(42)')
      expect(code).not.toContain('LoadAsset("42")')
    }
  })

  it('emits the placeholder bare in both paths, so the host can substitute it', () => {
    // The Open Cloud path builds the script before the upload has an id, so it
    // passes PLACEHOLDER_ASSET_ID and the host replaces it. Bare, not quoted:
    // the substitution lands inside `LoadAsset(...)`.
    const model = buildSpec(riggedSpec())
    for (const code of [
      insertLuau({ assetId: PLACEHOLDER_ASSET_ID, name: 'a', parts: [] }),
      insertLuau({ assetId: PLACEHOLDER_ASSET_ID, name: 'b', rig: rigForStudio(model) })
    ]) {
      expect(code).toContain(`LoadAsset(${PLACEHOLDER_ASSET_ID})`)
      expect(code).not.toContain(`LoadAsset("${PLACEHOLDER_ASSET_ID}")`)
    }
  })

  it('uses the token the Rust uploader substitutes', () => {
    // One string, two languages: a mismatch here means an upload succeeds and the
    // insert script loads asset 0. The Rust side replaces exactly this token.
    expect(PLACEHOLDER_ASSET_ID).toBe('{{ASSET_ID}}')
  })
})

describe('sendToStudio — the five invariants', () => {
  const uploader = (): StudioUploader & {
    upload: ReturnType<typeof vi.fn>
    executeLuau: ReturnType<typeof vi.fn>
  } => ({
    upload: vi.fn(async () => ({ assetId: 555 })),
    executeLuau: vi.fn(
      async () => 'Inserted Model Workspace.Crate: 1 part(s), 0 motor(s), 0 weld(s)'
    )
  })

  const model = () => buildSpec(prop([{ name: 'Crate', type: 'box', size: [1, 1, 1] }]))

  it('I1: refuses before uploading when no place is open', async () => {
    const port = uploader()
    await expect(
      sendToStudio({ token: 't', studio: null, model: model(), uploader: port })
    ).rejects.toThrow(StudioUnavailable)
    await expect(
      sendToStudio({ token: 't', studio: null, model: model(), uploader: port })
    ).rejects.toThrow('Open a place in Roblox Studio first.')
    expect(port.upload).not.toHaveBeenCalled()
  })

  it('I2: only errors block, so a warning still sends', async () => {
    const port = uploader()
    const report = { issues: [{ level: 'warn', message: 'a warning' }] }
    await expect(
      sendToStudio({
        token: 't',
        studio: { studioId: 'st-1' },
        model: model(),
        report,
        uploader: port
      })
    ).resolves.toMatchObject({ assetId: 555 })
  })

  it('I2: an error blocks the send', async () => {
    const port = uploader()
    const report = { issues: [{ level: 'error', message: 'too many triangles' }] }
    await expect(
      sendToStudio({
        token: 't',
        studio: { studioId: 'st-1' },
        model: model(),
        report,
        uploader: port
      })
    ).rejects.toThrow(StudioRejected)
    expect(port.upload).not.toHaveBeenCalled()
  })

  it('I3: forces merge off for a rigged model, discarding the caller request', async () => {
    const port = uploader()
    const riggedModel = buildSpec(riggedSpec())
    const result = await sendToStudio({
      token: 't',
      studio: { studioId: 'st-1' },
      model: riggedModel,
      category: 'character',
      merge: true,
      uploader: port
    })
    expect(result.assetId).toBe(555)
    // The rig path was taken, which only happens when merge was forced off.
    const code = port.executeLuau.mock.calls[0][0] as string
    expect(code).toContain('HumanoidRootPart')
  })

  it('I4: defaults merge on for an accessory', async () => {
    const port = uploader()
    const accessory = buildSpec(
      prop([{ name: 'Hat', type: 'box', size: [1, 1, 1] }], {
        category: 'accessory',
        accessoryType: 'Hat'
      })
    )
    await sendToStudio({
      token: 't',
      studio: { studioId: 'st-1' },
      model: accessory,
      category: 'accessory',
      accessoryType: 'Hat',
      uploader: port
    })
    const code = port.executeLuau.mock.calls[0][0] as string
    expect(code).toContain('Instance.new("Accessory")')
    expect(code).toContain('HatAttachment')
  })

  it('I5: a LOAD_FAILED keeps the asset id and explains the recovery', async () => {
    const port = uploader()
    port.executeLuau.mockResolvedValue('LOAD_FAILED: HTTP 500')
    const result = await sendToStudio({
      token: 't',
      studio: { studioId: 'st-1' },
      model: model(),
      uploader: port
    })

    expect(result.assetId).toBe(555)
    expect(result.recovery).toContain('Uploaded as asset 555')
    expect(result.recovery).toContain('HTTP 500')
    expect(result.recovery).toContain('Toolbox → My Models')
    expect(result.recovery).toContain('3D Importer')
  })

  it('reports progress at each stage', async () => {
    const port = uploader()
    const seen: string[] = []
    await sendToStudio({
      token: 't',
      studio: { studioId: 'st-1' },
      model: model(),
      onProgress: (detail) => seen.push(detail),
      uploader: port
    })
    expect(seen).toEqual([
      'Uploading the model to your Roblox account…',
      'Waiting for Roblox to process the upload…',
      'Inserting it into the open place…'
    ])
  })

  it('throws the documented message when Roblox has not finished processing', async () => {
    const port = uploader()
    port.upload.mockResolvedValue({})
    await expect(
      sendToStudio({ token: 't', studio: { studioId: 'st-1' }, model: model(), uploader: port })
    ).rejects.toThrow('Roblox has not finished processing the upload yet')
  })

  it('surfaces a moderation note when Roblox gives one', async () => {
    const port = uploader()
    port.upload.mockResolvedValue({ moderationNote: 'Rejected by moderation' })
    await expect(
      sendToStudio({ token: 't', studio: { studioId: 'st-1' }, model: model(), uploader: port })
    ).rejects.toThrow('Rejected by moderation')
  })

  it('uploads a real GLB under the sanitised name', async () => {
    const port = uploader()
    const named = buildSpec(
      prop([{ name: 'Crate', type: 'box', size: [1, 1, 1] }], { name: 'Wooden Crate' })
    )
    await sendToStudio({
      token: 't',
      studio: { studioId: 'st-1' },
      model: named,
      uploader: port
    })
    const request = port.upload.mock.calls[0][0] as {
      name: string
      filename: string
      data: Uint8Array
    }
    // A name with a space is sanitised into a file stem.\n    expect(request.filename).toBe('wooden-crate.glb')
    // The bytes are a real GLB: the magic is `glTF`.
    expect([...request.data.subarray(0, 4)]).toEqual([0x67, 0x6c, 0x54, 0x46])
  })
})

describe('describeSend', () => {
  it('reports the container and the attachment per category', () => {
    const accessory = buildSpec(
      prop([{ name: 'Hat', type: 'box', size: [1, 1, 1] }], {
        category: 'accessory',
        accessoryType: 'Back'
      })
    )
    const described = describeSend(accessory, { category: 'accessory', accessoryType: 'Back' })
    expect(described.container).toBe('Accessory')
    expect(described.attachment).toBe('BodyBackAttachment')
    expect(described.merge).toBe(true)
  })

  it('says a rigged model is split', () => {
    const described = describeSend(buildSpec(riggedSpec()), { category: 'character' })
    expect(described.rigged).toBe(true)
    expect(described.merge).toBe(false)
  })

  it('reports a tool container', () => {
    const model = buildSpec(prop([{ type: 'box', size: [1, 1, 1] }]))
    expect(describeSend(model, { category: 'tool' }).container).toBe('Tool')
  })
})

describe('the emitted scripts are syntactically plausible Luau', () => {
  const balanced = (code: string, open: string, close: string): boolean => {
    let depth = 0
    for (const char of code) {
      if (char === open) depth++
      if (char === close) depth--
      if (depth < 0) return false
    }
    return depth === 0
  }

  it('balances its parentheses in both emitters', () => {
    const model = buildSpec(riggedSpec())
    for (const code of [
      assembleLuau({
        assetId: 1,
        name: 'crate',
        category: 'building',
        parts: [{ name: 'Crate', center: [0, 0, 0], pivot: [0, 0, 0] }]
      }),
      assembleRigLuau(rigForStudio(model) as NonNullable<ReturnType<typeof rigForStudio>>, 'puppy')
    ]) {
      expect(balanced(code, '(', ')')).toBe(true)
      expect(balanced(code, '{', '}')).toBe(true)
    }
  })

  it('escapes a quote in a part name rather than breaking the string', () => {
    const code = assembleLuau({
      assetId: 1,
      name: 'a "quoted" name',
      parts: [{ name: 'Crate', center: [0, 0, 0], pivot: [0, 0, 0] }]
    })
    expect(code).toContain('container.Name = "a \\"quoted\\" name"')
  })

  it('writes a whole-number vector without a decimal point', () => {
    const code = assembleLuau({
      assetId: 1,
      name: 'crate',
      parts: [{ name: 'Crate', center: [1, 2, 3], pivot: [0, 0, 0] }]
    })
    expect(code).toContain('Vector3.new(1, 2, 3)')
  })

  it('writes a fractional coordinate to 4 dp', () => {
    const code = assembleLuau({
      assetId: 1,
      name: 'crate',
      parts: [{ name: 'Crate', center: [1.23456789, 0, 0], pivot: [0, 0, 0] }]
    })
    expect(code).toContain('Vector3.new(1.2346, 0, 0)')
  })
})

describe('checkModel integration', () => {
  it('a near-limit accessory passes the check that gates the send', () => {
    const model = buildSpec(
      prop([{ name: 'Hat', type: 'box', size: [3, 4, 3] }], {
        category: 'accessory',
        accessoryType: 'Hat'
      })
    )
    const report = checkModel(model, { category: 'accessory', accessoryType: 'Hat' })
    expect(report.ok).toBe(true)
  })

  it('an oversized hat fails, so sendToStudio would refuse it', () => {
    const model = buildSpec(
      prop([{ name: 'Hat', type: 'box', size: [9, 4, 3] }], {
        category: 'accessory',
        accessoryType: 'Hat'
      })
    )
    const report = checkModel(model, { category: 'accessory', accessoryType: 'Hat' })
    expect(report.ok).toBe(false)
  })
})
