/**
 * Runtime-neutral contracts for the generator loop (porting step `01`).
 *
 * A generator engine is a `build()` + `review()` pair driven by `designLoop`.
 * Nothing here knows about an engine, a transport, or a UI — see
 * `porting/01-orchestration/README.md` §1.3.1 and
 * `re/full-reverse/01-generator-loop/REPORT.md` §2.
 */

/** The four stages reported to the UI while a generation runs (`01` §3). */
export type Stage = 'designing' | 'building' | 'checking' | 'fixing'

/** One structured problem a validator can report without throwing. */
export interface BuildIssue {
  level: 'error' | 'warn'
  message: string
}

/** A structured check result; `ok` gates `DONE` acceptance. */
export interface BuildReport {
  ok: boolean
  issues: BuildIssue[]
  /** Engine-specific extras: `triangles`, `size`, `scores`, … */
  [key: string]: unknown
}

/**
 * What `build(spec)` returns on success.
 *
 * On failure it must **throw** an error carrying `problems: string[]` — that
 * contract is what makes the loop self-correcting (`01` §2.4).
 */
export interface BuildResult {
  /** The normalized spec the engine accepted. */
  spec: unknown
  /** dataURL of the review sheet shown back to the model. */
  sheet?: string
  report: BuildReport
  /** Textual description for vision-less models. */
  layout?: string
  [key: string]: unknown
}

/** The three parts of a review prompt (`14-deep-dives/B-review-prompts.md`). */
export interface ReviewParts {
  /** What the model is looking at, and whose eyes to judge with. */
  lead: string
  /** Pass/fail plus the issue list. */
  facts: string
  /** Measurements for text-only models. */
  layout?: string
}

/** One turn in the model conversation. */
export interface Msg {
  role: 'user' | 'assistant'
  text: string
  /** dataURL; only ever set on a user turn. */
  image?: string
}

/** Which model backend answers a turn. */
export interface Brain {
  id: 'robloxkit' | 'custom' | 'claude' | 'codex' | 'kiro'
  provider?: unknown
  token?: string
  signal?: AbortSignal
  /** `"<placeKey>/<threadId>"`-style session key, e.g. `gen/clothing`. */
  scope?: string
}

/** One request to the model. Pure text/vision: `tools: []` (`01` §1.4). */
export interface BrainRequest {
  brain: Brain
  history: Msg[]
  system: string
  /** Sent on the first turn only; RobloxKit uses it for credit accounting. */
  action?: string
  onPhase?: (detail: string) => void
}

/**
 * The seam between the loop and the transport (`01` §1.4).
 *
 * Termul plugs in here: an ACP session per generation, or direct HTTP.
 */
export type AskBrain = (req: BrainRequest) => Promise<string>

/** Reports whether the selected brain can accept an image on a turn. */
export type BrainTakesImages = (brain: Brain) => Promise<boolean>

/** Signature of a validator: success returns, invalidity throws `{problems}`. */
export type Build = (spec: unknown) => Promise<BuildResult>

/** Signature of the review-prompt builder. */
export type Review = (built: BuildResult, hasImage: boolean) => ReviewParts

/** Everything `designLoop` needs. */
export interface LoopOptions {
  /** Engine id, e.g. `clothing` — sent to the brain on the first turn only. */
  action: string
  /** The assembled system prompt. */
  system: string
  /** The first user message; may carry an image. */
  first: { text: string; image?: string }
  /** The raw user request, quoted back in the review question. */
  prompt: string
  /** What the model is authoring; defaults to `design`. */
  what?: string
  normalize?: (spec: unknown) => unknown
  extract?: (text: string) => unknown | null
  /** Message used when the reply had no JSON. */
  missing?: string
  question?: (ctx: { prompt: string; what: string; round: number }) => string
  /** Return a nudge to reject a `DONE`, or `null` to accept it. */
  accept?: (ctx: { verdict: string; built: BuildResult; round: number }) => string | null
  build: Build
  review: Review
  brain: Brain
  onStage?: (state: { stage: Stage; detail?: string }) => void
  /** Defaults to `MAX_REVIEW_ROUNDS`. */
  rounds?: number
  /** Defaults to `true`. */
  vision?: boolean
  /** Injected transports — the loop never imports a concrete one. */
  askBrain: AskBrain
  brainTakesImages: BrainTakesImages
}

/** What a finished generation produced. */
export interface LoopResult {
  result: unknown
  built: BuildResult
  notes: string[]
}
