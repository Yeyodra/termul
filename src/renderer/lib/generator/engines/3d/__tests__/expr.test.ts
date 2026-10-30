/**
 * The expression language: degrees, clamping, error wording, and pass-through.
 *
 * `sin`/`cos` taking degrees is the single most common source of wrong models,
 * so it is pinned here first. The error strings are echoed to the model through
 * the validator, so they are pinned verbatim.
 */
import { describe, expect, it } from 'vitest'
import { EXPR_FUNCTION_NAMES, evaluate, numberOr, numbersOr } from '@/lib/generator/engines/3d/expr'
import { paramValues } from '@/lib/generator/engines/3d/schema'

describe('evaluate — literals', () => {
  it('passes a number through untouched', () => {
    expect(evaluate(4.5)).toBe(4.5)
  })

  it('reads the number literal forms the grammar allows', () => {
    expect(evaluate('12')).toBe(12)
    expect(evaluate('12.5')).toBe(12.5)
    expect(evaluate('.5')).toBe(0.5)
    expect(evaluate('12.')).toBe(12)
    expect(evaluate('1e3')).toBe(1000)
    expect(evaluate('2.5E-2')).toBe(0.025)
  })

  it('tolerates surrounding whitespace', () => {
    expect(evaluate('  3 + 4  ')).toBe(7)
  })
})

describe('evaluate — the eight functions', () => {
  it('exposes exactly min max abs sqrt sin cos floor round clamp', () => {
    expect(EXPR_FUNCTION_NAMES.sort()).toEqual(
      ['abs', 'clamp', 'cos', 'floor', 'max', 'min', 'round', 'sin', 'sqrt'].sort()
    )
  })

  it('takes DEGREES for sin and cos, not radians', () => {
    // The radians reading would give -0.988 for sin(30).
    expect(evaluate('sin(30)')).toBeCloseTo(0.5, 12)
    expect(evaluate('sin(90)')).toBeCloseTo(1, 12)
    expect(evaluate('cos(60)')).toBeCloseTo(0.5, 12)
    expect(evaluate('cos(180)')).toBeCloseTo(-1, 12)
  })

  it('clamps into the range', () => {
    expect(evaluate('clamp(5, 0, 1)')).toBe(1)
    expect(evaluate('clamp(-5, 0, 1)')).toBe(0)
    expect(evaluate('clamp(0.5, 0, 1)')).toBe(0.5)
  })

  it('nests calls', () => {
    expect(evaluate('round(sqrt(16))')).toBe(4)
    expect(evaluate('min(max(1, 2), abs(-3))')).toBe(2)
  })

  it('does not check arity, as the original does not', () => {
    // min() is Infinity, so the finiteness check rejects it.
    expect(() => evaluate('min()')).toThrow('not a finite number')
    // clamp with one argument is NaN.
    expect(() => evaluate('clamp(1)')).toThrow('not a finite number')
    // abs ignores the second argument.
    expect(evaluate('abs(1, 2)')).toBe(1)
  })
})

describe('evaluate — arithmetic', () => {
  it('applies * / % tighter than + -', () => {
    expect(evaluate('2 + 3 * 4')).toBe(14)
    expect(evaluate('(2 + 3) * 4')).toBe(20)
    expect(evaluate('10 - 2 - 3')).toBe(5)
    expect(evaluate('12 / 3 / 2')).toBe(2)
  })

  it('takes % as the JavaScript remainder, so the sign follows the dividend', () => {
    expect(evaluate('7 % 3')).toBe(1)
    expect(evaluate('-7 % 3')).toBe(-1)
  })

  it('handles unary minus and plus', () => {
    expect(evaluate('-($h - 1) * 0.5'.replace('$h', '3'))).toBe(-1)
    expect(evaluate('+4')).toBe(4)
    expect(evaluate('--4')).toBe(4)
  })
})

describe('evaluate — $param binding', () => {
  it('binds by exact name', () => {
    expect(evaluate('$r * 2', { r: 3 })).toBe(6)
  })

  it('is case-sensitive', () => {
    expect(() => evaluate('$Height', { height: 4 })).toThrow('unknown parameter $Height')
  })

  it('clamps a slider override into the param range before binding', () => {
    const spec = { params: { r: { value: 1, min: 0, max: 3 } } }
    // 9 is clamped to the max of 3, then doubled.
    expect(evaluate('$r * 2', paramValues(spec, { r: 9 }))).toBe(6)
    expect(evaluate('$r * 2', paramValues(spec, { r: -9 }))).toBe(0)
  })

  it('rejects a missing param instead of silently using 0', () => {
    expect(() => evaluate('$nope', {})).toThrow('unknown parameter $nope')
  })

  it('rejects a bare $ with no name', () => {
    expect(() => evaluate('$')).toThrow('expected a parameter name after $')
  })
})

describe('evaluate — error strings', () => {
  const bad = (src: string, reason: string) =>
    expect(() => evaluate(src)).toThrow(`bad expression "${src}": ${reason}`)

  it('reports a missing close paren', () => {
    bad('(1 + 2', 'missing )')
  })

  it('reports a function used without parentheses', () => {
    bad('sin 30', 'sin needs (')
  })

  it('reports an unrecognised token', () => {
    bad('1 + @', 'unexpected "@"')
  })

  it('reports running out of input', () => {
    bad('1 +', 'unexpected "end"')
  })

  it('reports trailing junk after a complete parse', () => {
    bad('1 2', 'unexpected "2"')
  })

  it('reports a non-finite result', () => {
    bad('1 / 0', 'not a finite number')
  })

  it('rejects constructs the grammar does not have', () => {
    // No ^, no ceil, no pi, no comparison, no ternary.
    expect(() => evaluate('2 ^ 3')).toThrow('bad expression')
    expect(() => evaluate('ceil(2)')).toThrow('bad expression')
    expect(() => evaluate('pi')).toThrow('bad expression')
    expect(() => evaluate('1 > 0')).toThrow('bad expression')
    expect(() => evaluate('1 ? 2 : 3')).toThrow('bad expression')
  })
})

describe('numberOr / numbersOr', () => {
  it('takes the default only when the value is absent', () => {
    expect(numberOr(undefined, 0.5)).toBe(0.5)
    expect(numberOr(0, 0.5)).toBe(0)
    expect(numberOr('2 + 2', 0.5)).toBe(4)
  })

  it('evaluates an array element-wise, or returns the default array', () => {
    expect(numbersOr(['1', 2, '3 * 2'], [0, 0, 0])).toEqual([1, 2, 6])
    expect(numbersOr(undefined, [0, 0, 0])).toEqual([0, 0, 0])
  })
})
