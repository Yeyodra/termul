/**
 * `designLoop` — author a spec, build it, show the render back to the model,
 * and iterate until it accepts or the budget runs out.
 *
 * Ported from RobloxKit's `Se` (`gen3d:814-1014`) with the budgets in
 * `./budget`. The reconstruction this follows is
 * `re/full-reverse/01-generator-loop/REPORT.md` §2.
 *
 * Behaviour that is load-bearing, do not "simplify" it away:
 *  - `build()` signals invalidity by **throwing** an error with `.problems`.
 *  - `DONE` needs the regex, no JSON in the reply, and `report.ok` — all three.
 *  - A brain that refuses the image gets the same round retried text-only.
 *  - Transport failures retry; aborts never do.
 */
import {
  MAX_BUILD_RETRIES,
  MAX_DONE_REASKS,
  MAX_REBUILD_RETRIES,
  MAX_REVIEW_ROUNDS,
  MAX_TRANSPORT_RETRIES,
  PROBLEMS_ECHOED,
  PROBLEMS_IN_ERROR
} from './budget'
import { extractSpec as defaultExtractSpec } from './extract'
import type { BuildResult, LoopOptions, LoopResult, Msg, Stage } from './types'

/** Matches a bare `DONE` at either end of the trimmed reply (`gen3d:957`). */
export function isDone(text: string): boolean {
  const trimmed = (text ?? '').trim()
  return /^\s*DONE\b/i.test(trimmed) || /\bDONE\W*$/.test(trimmed)
}

/**
 * Whether a transport error is worth retrying (`gen3d:879`).
 *
 * The shape checks come first because Termul's ACP transport reports these as
 * structured flags, not as title-cased prose.
 */
export function droppedConnection(error: unknown): boolean {
  const e = error as { resumable?: boolean; stalled?: boolean; kind?: string; message?: string }
  if (e?.resumable || e?.stalled || e?.kind === 'exited') return true
  return /network|fetch|connect|timed? ?out|stopped running|went quiet|ECONN|socket/i.test(
    String(e?.message ?? e)
  )
}

function isAbort(error: unknown): boolean {
  const e = error as { name?: string; kind?: string; message?: string }
  if (e?.name === 'AbortError') return true
  if (e?.kind === 'aborted') return true
  return /abort/i.test(String(e?.message ?? error))
}

/** Read `problem[]` off a thrown validator error, or wrap the message. */
function problemsOf(error: unknown): string[] {
  const e = error as { problems?: unknown; message?: unknown }
  if (Array.isArray(e?.problems)) {
    return e.problems.map((p) => String(p))
  }
  if (typeof e?.problems === 'string' && e.problems) return [e.problems]
  return [String(e?.message ?? error)]
}

function brainLabel(options: LoopOptions): string {
  return options.brain.id
}

export async function designLoop(options: LoopOptions): Promise<LoopResult> {
  const {
    action,
    system,
    first,
    prompt,
    what = 'design',
    normalize,
    extract = defaultExtractSpec,
    missing,
    question,
    accept,
    build,
    review,
    brain,
    onStage,
    askBrain,
    brainTakesImages
  } = options

  const history: Msg[] = [{ role: 'user', text: first.text, image: first.image }]
  const notes: string[] = []
  let actionSent = false

  /** One model turn, with transport retry and abort passthrough. */
  const turn = async (stage: Stage): Promise<string> => {
    onStage?.({ stage, detail: `${brainLabel(options)} is ${stage}` })

    for (let attempt = 0; ; attempt++) {
      try {
        const reply = await askBrain({
          brain,
          history,
          system,
          action: actionSent ? undefined : action,
          onPhase: (detail) => onStage?.({ stage, detail })
        })
        actionSent = true
        history.push({ role: 'assistant', text: reply })
        return reply
      } catch (error) {
        if (isAbort(error) || attempt >= MAX_TRANSPORT_RETRIES || !droppedConnection(error)) {
          throw error
        }
        onStage?.({
          stage,
          detail: `Connection dropped; asking again (${attempt + 1} of ${MAX_TRANSPORT_RETRIES})`
        })
      }
    }
  }

  // ── A. author the spec ───────────────────────────────────────────────────
  let reply = await turn('designing')

  // ── B. extract → normalize → build, retrying on rejection ────────────────
  let spec: unknown = null
  let built: BuildResult | null = null

  for (let attempt = 0; ; attempt++) {
    spec = extract(reply)
    let problems: string[] | null = spec
      ? null
      : [missing ?? `The reply had no JSON ${what}. Answer with one \`\`\`json block.`]

    if (spec) {
      const normalized = normalize?.(spec)
      if (normalized !== undefined) spec = normalized
      onStage?.({ stage: 'building', detail: 'Building it' })
      try {
        built = await build(spec)
      } catch (error) {
        // The validator contract: an error carrying `.problems`.
        problems = problemsOf(error)
      }
    }

    if (!problems) break

    if (attempt >= MAX_BUILD_RETRIES) {
      throw new Error(
        `The AI's ${what} could not be built: ${problems.slice(0, PROBLEMS_IN_ERROR).join('; ')}`
      )
    }

    notes.push(`fixed ${problems.length} ${what} problem(s)`)
    history.push({
      role: 'user',
      text: `The engine rejected the ${what}:\n- ${problems
        .slice(0, PROBLEMS_ECHOED)
        .join('\n- ')}\nReturn the whole corrected ${what}.`
    })
    reply = await turn('fixing')
  }

  if (!built) {
    // Unreachable: the loop only breaks out of B with a built artifact.
    throw new Error(`designLoop: ${what} was never built`)
  }
  let current: BuildResult = built

  // ── C. review rounds ────────────────────────────────────────────────────
  let visionOk = options.vision ?? true
  const rounds = options.rounds ?? MAX_REVIEW_ROUNDS

  for (let round = 0; round < rounds; round++) {
    onStage?.({ stage: 'checking', detail: 'Checking the result' })

    let canImage = visionOk && !!current.sheet && (await brainTakesImages(brain))
    let parts = review(current, canImage)

    const ask = question
      ? `\n${question({ prompt, what, round })}`
      : `\nDoes it match the request "${prompt}"? If it does and there are no errors, reply with the single word DONE. Otherwise return the whole corrected ${what}.`

    history.push({
      role: 'user',
      text: `${parts.lead} ${parts.facts}${parts.layout ?? ''}${ask}`,
      image: canImage ? current.sheet : undefined
    })

    let verdict: string
    try {
      verdict = await turn('checking')
    } catch (error) {
      if (!canImage || isAbort(error)) throw error
      // The brain refused the image: retry this same round text-only.
      visionOk = false
      canImage = false
      notes.push('reviewed without pictures (the brain refused the image)')
      parts = review(current, false)
      history[history.length - 1] = {
        role: 'user',
        text: `${parts.lead} ${parts.facts}${parts.layout ?? ''}${ask}`
      }
      verdict = await turn('checking')
    }

    // ── DONE handling, with the acceptance gate ───────────────────────────
    let next = extract(verdict)
    let accepted = false

    for (let n = 0; !next && n < MAX_DONE_REASKS && isDone(verdict); n++) {
      const nudge = current.report.ok
        ? (accept?.({ verdict, built: current, round }) ?? null)
        : `The checks still find errors:\n- ${current.report.issues
            .filter((issue) => issue.level === 'error')
            .map((issue) => issue.message)
            .join('\n- ')}\nFix them and return the whole corrected ${what}.`

      if (!nudge) {
        accepted = true
        break
      }

      notes.push(`review ${round + 1}: DONE not accepted`)
      history.push({ role: 'user', text: nudge })
      verdict = await turn('checking')
      next = extract(verdict)
    }

    if (accepted || !next) break

    // ── rebuild the revised spec; MAX_REBUILD_RETRIES per round ───────────
    for (let attempt = 0; next; attempt++) {
      const normalized = normalize?.(next)
      if (normalized !== undefined) next = normalized

      onStage?.({ stage: 'fixing', detail: 'Rebuilding with the corrections' })
      try {
        current = await build(next)
        spec = next
        notes.push(`revised after review ${round + 1}`)
        break
      } catch (error) {
        const problems = problemsOf(error)
        if (attempt >= MAX_REBUILD_RETRIES) {
          notes.push(`a revision did not build (${problems[0]})`)
          next = null
          break
        }
        history.push({
          role: 'user',
          text: `The engine rejected the ${what}:\n- ${problems
            .slice(0, PROBLEMS_ECHOED)
            .join('\n- ')}\nReturn the whole corrected ${what}.`
        })
        next = extract(await turn('fixing'))
      }
    }

    if (!next) break
  }

  return { result: spec, built: current, notes }
}
