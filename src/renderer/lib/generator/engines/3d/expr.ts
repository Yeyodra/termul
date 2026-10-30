/**
 * The 3D spec expression language.
 *
 * Every numeric field in a 3D spec may be a **string** instead of a number, so
 * a parametric model can be re-solved when a slider moves. The parser is a
 * hand-written recursive-descent evaluator, ported from
 * `spec-D11M_y_m.js:7-137`; see `re/full-reverse/08-3d-polyforge/REPORT.md` §4.
 *
 * Behaviour that is load-bearing, do not "simplify" it away:
 *  - `sin`/`cos` take **degrees**, not radians. This is the single most common
 *    source of wrong models.
 *  - A number passes through untouched; anything else is stringified and parsed.
 *  - `$name` binds a resolved param by exact name. A missing param is a hard
 *    error, never a silent `0`.
 *  - Function arity is **not** checked, matching the original: `min()` is
 *    `Infinity` and therefore fails the finiteness check; `abs(1,2)` is `1`.
 *  - There is no `^`, no comparison, no ternary, no `ceil`, no `tan`, no `pow`,
 *    no `lerp`, and no `pi` constant. Adding one would accept specs the real
 *    engine rejects.
 *
 * The error strings are echoed to the model verbatim through the validator, so
 * they are part of the contract — do not reword them.
 */

/** Resolved parameter values, as `paramValues()` produces them. */
export type ParamValues = Record<string, number>

/**
 * The function table (`spec-D11M_y_m.js:7-17`).
 *
 * `sin`/`cos` wrap the radian `Math` functions with a degree conversion. Arity
 * is not validated, exactly as in the original.
 */
export const EXPR_FUNCTIONS: Record<string, (...args: number[]) => number> = {
  min: Math.min,
  max: Math.max,
  abs: Math.abs,
  sqrt: Math.sqrt,
  sin: (degrees) => Math.sin((degrees * Math.PI) / 180),
  cos: (degrees) => Math.cos((degrees * Math.PI) / 180),
  floor: Math.floor,
  round: Math.round,
  clamp: (value, low, high) => Math.min(high, Math.max(low, value))
}

/** The eight names a spec may call, in the order the prompt should list them. */
export const EXPR_FUNCTION_NAMES = Object.keys(EXPR_FUNCTIONS)

/** A `$param` name: an ASCII letter or `_`, then letters, digits or `_`. */
const PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_]*/
/** A number literal (`spec-D11M_y_m.js:66`): `12`, `12.5`, `.5`, `12.`, `1e3`, `2.5E-2`. */
const NUMBER_LITERAL = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i
/** A candidate function name: lowercase letters only. */
const FUNCTION_NAME = /^[a-z]+/

/**
 * Evaluate one spec value to a number.
 *
 * Numbers return unchanged. Strings are parsed. Anything else is stringified
 * first, so `undefined` fails as `bad expression "undefined": unexpected "u"` —
 * which is the original behaviour, and the reason a missing required field
 * surfaces as an expression error rather than a "field is required" error.
 *
 * @throws Error whose message is `bad expression "<src>": <reason>`.
 */
export function evaluate(value: unknown, params: ParamValues = {}): number {
  if (typeof value === 'number') return value

  const src = String(value)
  let at = 0

  const peek = (): string | undefined => src[at]
  const skipSpace = () => {
    while (/\s/.test(src[at] ?? '')) at++
  }
  const fail = (reason: string): never => {
    throw Error(`bad expression "${src}": ${reason}`)
  }

  /** `primary` — a parenthesised expression, unary sign, `$param`, literal, or call. */
  function primary(): number {
    skipSpace()
    const ch = peek()

    if (ch === '(') {
      at++
      const inner = additive()
      skipSpace()
      if (peek() !== ')') fail('missing )')
      at++
      return inner
    }
    if (ch === '-') {
      at++
      return -primary()
    }
    if (ch === '+') {
      at++
      return primary()
    }
    if (ch === '$') {
      at++
      const name = PARAM_NAME.exec(src.slice(at))
      if (!name) return fail('expected a parameter name after $')
      at += name[0].length
      if (!(name[0] in params)) fail(`unknown parameter $${name[0]}`)
      return Number(params[name[0]])
    }

    const literal = NUMBER_LITERAL.exec(src.slice(at))
    if (literal) {
      at += literal[0].length
      return Number(literal[0])
    }

    const fn = FUNCTION_NAME.exec(src.slice(at))
    if (fn && EXPR_FUNCTIONS[fn[0]]) {
      at += fn[0].length
      skipSpace()
      if (peek() !== '(') fail(`${fn[0]} needs (`)
      at++
      const args: number[] = []
      skipSpace()
      if (peek() !== ')') {
        for (;;) {
          args.push(additive())
          skipSpace()
          if (peek() === ',') {
            at++
            continue
          }
          break
        }
      }
      if (peek() !== ')') fail('missing )')
      at++
      return EXPR_FUNCTIONS[fn[0]](...args)
    }

    return fail(`unexpected "${ch ?? 'end'}"`)
  }

  /** `mul` — `* / %`, left-associative, tighter than `+ -`. */
  function multiplicative(): number {
    let value = primary()
    for (;;) {
      skipSpace()
      const op = peek()
      if (op === '*' || op === '/' || op === '%') {
        at++
        const right = primary()
        value = op === '*' ? value * right : op === '/' ? value / right : value % right
      } else {
        return value
      }
    }
  }

  /** `add` — `+ -`, the loosest level. */
  function additive(): number {
    let value = multiplicative()
    for (;;) {
      skipSpace()
      const op = peek()
      if (op === '+' || op === '-') {
        at++
        const right = multiplicative()
        value = op === '+' ? value + right : value - right
      } else {
        return value
      }
    }
  }

  const result = additive()
  skipSpace()
  if (at < src.length) fail(`unexpected "${src[at]}"`)
  if (!Number.isFinite(result)) fail('not a finite number')
  return result
}

/**
 * `T` (`spec-D11M_y_m.js:715`): evaluate, or take the default when absent.
 *
 * `undefined` is the only value that means "absent". `null` is a value, and
 * stringifies to a parse error, exactly as the original does.
 */
export function numberOr(value: unknown, fallback: number, params: ParamValues = {}): number {
  return value === undefined ? fallback : evaluate(value, params)
}

/**
 * `E` (`spec-D11M_y_m.js:716`): evaluate an array element-wise, or take the
 * default when the array itself is absent.
 */
export function numbersOr(value: unknown, fallback: number[], params: ParamValues = {}): number[] {
  return value ? (value as unknown[]).map((item) => evaluate(item, params)) : fallback
}
