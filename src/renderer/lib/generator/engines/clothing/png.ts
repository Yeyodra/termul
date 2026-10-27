/**
 * The rendered sheet as a PNG data URL.
 *
 * RobloxKit renders into a canvas and calls `toBlob('image/png')`
 * (`render-CpljO1Hx.js`, `function _`); this is the same encoder reached through
 * `toDataURL('image/png')`, because the generator hands the bytes to an MCP image
 * block rather than saving a blob. `toDataURL` is lossless PNG for the same
 * canvas, so the pixels are identical.
 */

import type { SheetCanvas } from './render'

/** `data:image/png;base64,…` for the sheet. */
export function pngDataUrl(canvas: SheetCanvas): string {
  return canvas.toDataURL('image/png')
}
