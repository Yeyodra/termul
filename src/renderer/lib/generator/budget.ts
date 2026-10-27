/**
 * Loop budget constants, ported verbatim from RobloxKit's `designLoop`.
 *
 * Every value here was read out of the bundle with a `file:line` citation in
 * `re/full-reverse/01-generator-loop/REPORT.md` §2.6. They are load-bearing:
 * changing one silently changes how many times a user pays for a retry.
 *
 * Do not inline these numbers anywhere else — import them.
 */

/** Review cycles after a successful build (`gen3d:416`, `:833`). */
export const MAX_REVIEW_ROUNDS = 2

/** Authoring-phase build retries (`gen3d:528` `_e`) → 4 attempts total. */
export const MAX_BUILD_RETRIES = 3

/** Rebuild retries per review round (`gen3d:992`) → 3 attempts. */
export const MAX_REBUILD_RETRIES = 2

/** Transport retries per turn (`gen3d:1015` `Q`) → 3 attempts. */
export const MAX_TRANSPORT_RETRIES = 2

/** How many times a rejected `DONE` is re-asked within one round (`gen3d:957`). */
export const MAX_DONE_REASKS = 2

/** Problems echoed back to the model (`gen3d:912`, `:999`). */
export const PROBLEMS_ECHOED = 20

/** Problems quoted in the terminal error (`gen3d:907`). */
export const PROBLEMS_IN_ERROR = 5

/** Longest edge of the review image (`gen3d:334` `ce`). */
export const REVIEW_IMAGE_MAX_EDGE = 1568

/** Largest review image in bytes — 5 MB (`gen3d:335` `le`). */
export const REVIEW_IMAGE_MAX_BYTES = 5 * 1024 * 1024

/** Upload hard limit — 20 MB (`gen3d:343`, `le * 4`). */
export const IMAGE_UPLOAD_HARD_LIMIT = 20 * 1024 * 1024

/** MIME types a brain may receive (`gen3d:333`). */
export const IMAGE_MIME_ALLOW = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

/** Downscale quality when normalizing a review image (`gen3d:377`). */
export const REVIEW_JPEG_QUALITY = 0.9

/** Default background job concurrency (`tasks:20`, clamped `1..4` at `:41-43`). */
export const TASK_CONCURRENCY = 2

/** Finished tasks kept in the persisted log (`tasks:20`). */
export const MAX_FINISHED_TASKS = 60

/** Task results are cut at this many characters, with a notice (`tasks:97-107`). */
export const TASK_RESULT_CAP = 20000

/** Debounce before a task-state write reaches the store (`tasks:73-75`). */
export const TASK_SAVE_DEBOUNCE_MS = 600
