/**
 * Pull a JSON spec out of a model reply.
 *
 * Two strategies, tried in this order (`01-generator-loop/REPORT.md` §5):
 *  1. a fenced block — ` ```json … ``` ` or ` ``` … ``` `
 *  2. the span from the first `{` to the last `}`
 *
 * The first candidate that parses wins. Anything else yields `null`, which the
 * loop turns into "the reply had no JSON" and re-asks.
 */
export function extractSpec(text: string): unknown | null {
  const raw = text ?? ''
  const candidates: string[] = []

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)
  if (fenced?.[1]) candidates.push(fenced[1])

  const open = raw.indexOf('{')
  const close = raw.lastIndexOf('}')
  if (open >= 0 && close > open) candidates.push(raw.slice(open, close + 1))

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      // try the next strategy
    }
  }

  return null
}
