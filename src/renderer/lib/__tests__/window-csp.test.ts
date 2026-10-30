/**
 * The CSP the desktop window runs under, checked against what the 3D viewport
 * actually needs.
 *
 * `GLTFLoader` reads a GLB's embedded palette PNG by turning it into a `blob:`
 * URL and assigning it to an `<img>`, so textures are governed by `img-src`.
 * That directive listed `data:` and the asset protocol but not `blob:`, so every
 * generated model rendered untextured grey while the palette inside the file was
 * correct. A silent, colourless model is hard to attribute to a policy, so the
 * requirement is pinned here instead of being rediscovered from a screenshot.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const CONFIG = join(__dirname, '../../../../src-tauri/tauri.conf.json')

function csp(): string {
  const parsed = JSON.parse(readFileSync(CONFIG, 'utf8')) as {
    app: { security: { csp: string } }
  }
  return parsed.app.security.csp
}

function directive(name: string): string[] {
  const match = csp()
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `) || part === name)
  return match ? match.split(/\s+/).slice(1) : []
}

describe('the window CSP', () => {
  it('lets a texture reach an <img>, which is how GLTFLoader loads a palette', () => {
    expect(directive('img-src')).toContain('blob:')
  })

  it('still lets the viewport fetch its own GLB as data and over the asset protocol', () => {
    expect(directive('img-src')).toContain('data:')
    expect(directive('img-src')).toContain('asset:')
  })

  it('keeps the script policy from widening, so a texture fix is not a blanket opening', () => {
    expect(directive('script-src')).toEqual(["'self'", "'unsafe-eval'"])
  })
})
