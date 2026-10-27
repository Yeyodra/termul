import '@testing-library/jest-dom'
import React from 'react'
import { vi } from 'vitest'

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false
  })
})

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

window.ResizeObserver = ResizeObserverMock

// jsdom has no Element.scrollTo; Streamdown pins streaming code blocks to the bottom with it.
if (typeof Element.prototype.scrollTo !== 'function') {
  Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo
}

class IntersectionObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}

window.IntersectionObserver = IntersectionObserverMock as unknown as typeof IntersectionObserver

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

// Desktop-context suites script the ACP carrier through the `invoke` mock above:
// swap the real `/ws`-over-Channel `DesktopAcpTransport` for the invoke-backed
// double. Suites that test the real class call `vi.unmock` on this module.
vi.mock('@/lib/acp-transport/desktop-transport', async () => {
  // Non-literal specifier: this setup file belongs to the node tsconfig project,
  // which must not pull renderer sources into its file list.
  const double = './src/renderer/lib/test-utils/invoke-acp-transport'
  const { createInvokeAcpTransport } = await import(/* @vite-ignore */ double)
  return {
    DESKTOP_CHANNEL_URL: 'channel://desktop',
    // A plain function: `new` yields the returned transport object.
    DesktopAcpTransport: function DesktopAcpTransport() {
      return createInvokeAcpTransport()
    }
  }
})

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {}))
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  readDir: vi.fn(),
  readFile: vi.fn(),
  readTextFile: vi.fn(),
  writeFile: vi.fn(),
  writeTextFile: vi.fn(),
  mkdir: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
  stat: vi.fn(),
  watchImmediate: vi.fn()
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: vi.fn(),
  message: vi.fn(),
  confirm: vi.fn()
}))

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  readText: vi.fn(),
  writeText: vi.fn(),
  readImage: vi.fn(),
  writeImage: vi.fn()
}))

vi.mock('@tauri-apps/plugin-store', () => ({
  createStore: vi.fn()
}))

vi.mock('@tauri-apps/plugin-os', () => ({
  platform: vi.fn(),
  version: vi.fn(),
  type: vi.fn(),
  arch: vi.fn(),
  tempdir: vi.fn(),
  homedir: vi.fn()
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
  Command: vi.fn(),
  open: vi.fn()
}))

vi.mock('@tauri-apps/plugin-opener', () => ({
  openPath: vi.fn(),
  openUrl: vi.fn(),
  revealItemInDir: vi.fn()
}))

vi.mock('react-virtuoso', () => {
  const VirtuosoComponent = React.forwardRef(
    (
      {
        data,
        itemContent
      }: {
        data: unknown[]
        itemContent: (index: number, item: unknown) => React.JSX.Element
      },
      _ref: React.Ref<unknown>
    ) => {
      return React.createElement(
        'div',
        { 'data-testid': 'virtuoso-scroller', 'data-virtuoso-scroller': 'true' },
        React.createElement(
          'div',
          { 'data-testid': 'virtuoso-item-list' },
          data.map((item, index) =>
            React.createElement('div', { key: index }, itemContent(index, item))
          )
        )
      )
    }
  )

  VirtuosoComponent.displayName = 'Virtuoso'

  return { Virtuoso: VirtuosoComponent }
})

// jsdom ships no 2D canvas. The clothing renderer is a real compositor now — it
// clears, fills, clips per region and draws text/shapes/trims — so this stands in
// with an actual RGBA raster rather than a stub: every draw call mutates a pixel
// buffer, which keeps the assertions meaningful (a determinism test that compares
// two empty stubs proves nothing).
//
// Paths are tracked as a flat point list with a bounding box; `fill()` resolves
// them with an even-odd style scanline over the bbox. That is enough to tell a
// filled star from an empty region, which is what the checks assert on.

type Raster = { width: number; height: number; data: Uint8ClampedArray }

const CANVAS_STORE = new WeakMap<object, Raster>()

function rasterOf(canvas: { width: number; height: number }): Raster {
  const existing = CANVAS_STORE.get(canvas as object)
  if (existing && existing.width === canvas.width && existing.height === canvas.height) {
    return existing
  }
  const fresh: Raster = {
    width: canvas.width,
    height: canvas.height,
    data: new Uint8ClampedArray(canvas.width * canvas.height * 4)
  }
  CANVAS_STORE.set(canvas as object, fresh)
  return fresh
}

class ImageDataMock {
  data: Uint8ClampedArray
  constructor(
    public width: number,
    public height: number
  ) {
    this.data = new Uint8ClampedArray(width * height * 4)
  }
}

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) {
    c ^= bytes[i]
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  return (c ^ 0xffffffff) >>> 0
}

function pngOf(raster: Raster): string {
  const zlib = require('node:zlib') as typeof import('node:zlib')
  const { width, height, data } = raster
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  const chunk = (type: string, payload: Buffer): Buffer => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(payload.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), payload])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
  return `data:image/png;base64,${png.toString('base64')}`
}

function parseHex(value: string): [number, number, number] {
  const text = String(value).replace('#', '')
  const full = text.length === 3 ? text.replace(/./g, '$&$&') : text
  const n = Number.parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function createContext2d(canvas: { width: number; height: number }) {
  let points: Array<[number, number]> = []
  let rects: Array<{ x: number; y: number; w: number; h: number }> = []
  let clip: { x: number; y: number; w: number; h: number } | null = null
  type ClipRect = { x: number; y: number; w: number; h: number }
  let saved: Array<ClipRect | null> = []
  const state = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineJoin: 'miter',
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic'
  }

  const insideClip = (x: number, y: number): boolean => {
    if (!clip) return true
    return x >= clip.x && x < clip.x + clip.w && y >= clip.y && y < clip.y + clip.h
  }

  const put = (x: number, y: number, rgb: [number, number, number]): void => {
    const raster = rasterOf(canvas)
    if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return
    if (!insideClip(x, y)) return
    const offset = (y * raster.width + x) * 4
    raster.data[offset] = rgb[0]
    raster.data[offset + 1] = rgb[1]
    raster.data[offset + 2] = rgb[2]
    raster.data[offset + 3] = 255
  }

  const fillRect = (x: number, y: number, w: number, h: number): void => {
    const rgb = parseHex(String(state.fillStyle))
    for (let py = Math.floor(y); py < Math.ceil(y + h); py += 1) {
      for (let px = Math.floor(x); px < Math.ceil(x + w); px += 1) put(px, py, rgb)
    }
  }

  const fillPath = (): void => {
    if (!points.length && !rects.length) return
    const rgb = parseHex(String(state.fillStyle))

    for (const rect of rects) fillRect(rect.x, rect.y, rect.w, rect.h)
    if (!points.length) {
      points = []
      return
    }

    const xs = points.map((p) => p[0])
    const ys = points.map((p) => p[1])
    const minX = Math.floor(Math.min(...xs))
    const maxX = Math.ceil(Math.max(...xs))
    const minY = Math.floor(Math.min(...ys))
    const maxY = Math.ceil(Math.max(...ys))

    for (let py = minY; py <= maxY; py += 1) {
      for (let px = minX; px <= maxX; px += 1) {
        if (pointInPolygon(px + 0.5, py + 0.5, points)) put(px, py, rgb)
      }
    }
    points = []
  }

  return {
    ...state,
    get fillStyle() {
      return state.fillStyle
    },
    set fillStyle(value: string) {
      state.fillStyle = value
    },
    get strokeStyle() {
      return state.strokeStyle
    },
    set strokeStyle(value: string) {
      state.strokeStyle = value
    },
    get lineWidth() {
      return state.lineWidth
    },
    set lineWidth(value: number) {
      state.lineWidth = value
    },
    get lineJoin() {
      return state.lineJoin
    },
    set lineJoin(value: string) {
      state.lineJoin = value
    },
    get font() {
      return state.font
    },
    set font(value: string) {
      state.font = value
    },
    get textAlign() {
      return state.textAlign
    },
    set textAlign(value: string) {
      state.textAlign = value
    },
    get textBaseline() {
      return state.textBaseline
    },
    set textBaseline(value: string) {
      state.textBaseline = value
    },
    save() {
      saved = [...saved, clip]
    },
    restore() {
      clip = saved.pop() ?? null
    },
    beginPath() {
      points = []
      rects = []
    },
    closePath() {},
    moveTo(x: number, y: number) {
      points.push([x, y])
    },
    lineTo(x: number, y: number) {
      points.push([x, y])
    },
    bezierCurveTo(_c1x: number, _c1y: number, _c2x: number, _c2y: number, x: number, y: number) {
      points.push([x, y])
    },
    ellipse(cx: number, cy: number, rx: number, ry: number) {
      for (let step = 0; step < 32; step += 1) {
        const angle = (step / 32) * Math.PI * 2
        points.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry])
      }
    },
    arc(cx: number, cy: number, radius: number, start: number, end: number) {
      const steps = 24
      for (let step = 0; step <= steps; step += 1) {
        const angle = start + ((end - start) * step) / steps
        points.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius])
      }
    },
    rect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h })
      points.push([x, y], [x + w, y], [x + w, y + h], [x, y + h])
    },
    clip() {
      const xs = points.map((p) => p[0])
      const ys = points.map((p) => p[1])
      if (!xs.length) return
      clip = {
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs),
        h: Math.max(...ys) - Math.min(...ys)
      }
    },
    fill() {
      fillPath()
    },
    stroke() {
      fillPath()
    },
    fillRect,
    strokeRect: fillRect,
    clearRect(x: number, y: number, w: number, h: number) {
      const raster = rasterOf(canvas)
      for (let py = Math.floor(y); py < Math.ceil(y + h); py += 1) {
        for (let px = Math.floor(x); px < Math.ceil(x + w); px += 1) {
          if (px < 0 || py < 0 || px >= raster.width || py >= raster.height) continue
          const offset = (py * raster.width + px) * 4
          raster.data.fill(0, offset, offset + 4)
        }
      }
    },
    fillText(text: string, x: number, y: number) {
      // A glyph has no size here, so paint a block one fifth of the font size
      // tall: enough for a painted-region assertion, not a legibility claim.
      const size = Number.parseInt(String(state.font).match(/(\d+)px/)?.[1] ?? '10', 10)
      const width = Math.max(1, String(text).length * size * 0.5)
      fillRect(x - width / 2, y - size / 5, width, size / 2.5)
    },
    strokeText() {},
    drawImage(source: unknown, x: number, y: number, w?: number, h?: number) {
      const from = source as { width?: number; height?: number }
      const sourceRaster = CANVAS_STORE.get(source as object)
      const drawWidth = w ?? from.width ?? 0
      const drawHeight = h ?? from.height ?? 0
      if (!sourceRaster || !drawWidth || !drawHeight) return

      const raster = rasterOf(canvas)
      for (let py = 0; py < drawHeight; py += 1) {
        for (let px = 0; px < drawWidth; px += 1) {
          const sx = Math.floor((px / drawWidth) * sourceRaster.width)
          const sy = Math.floor((py / drawHeight) * sourceRaster.height)
          const srcOffset = (sy * sourceRaster.width + sx) * 4
          const alpha = sourceRaster.data[srcOffset + 3]
          if (!alpha) continue
          const tx = Math.floor(x + px)
          const ty = Math.floor(y + py)
          if (tx < 0 || ty < 0 || tx >= raster.width || ty >= raster.height) continue
          if (!insideClip(tx, ty)) continue
          const offset = (ty * raster.width + tx) * 4
          raster.data[offset] = sourceRaster.data[srcOffset]
          raster.data[offset + 1] = sourceRaster.data[srcOffset + 1]
          raster.data[offset + 2] = sourceRaster.data[srcOffset + 2]
          raster.data[offset + 3] = alpha
        }
      }
    },
    createImageData(width: number, height: number) {
      return new ImageDataMock(width, height)
    },
    putImageData(image: ImageDataMock, dx: number, dy: number) {
      const raster = rasterOf(canvas)
      raster.width = image.width
      raster.height = image.height
      raster.data = new Uint8ClampedArray(image.data)
      CANVAS_STORE.set(canvas as object, raster)
      void dx
      void dy
    },
    getImageData(x: number, y: number, width: number, height: number) {
      const raster = rasterOf(canvas)
      const out = new ImageDataMock(width, height)
      for (let row = 0; row < height; row += 1) {
        for (let col = 0; col < width; col += 1) {
          const sx = x + col
          const sy = y + row
          if (sx < 0 || sy < 0 || sx >= raster.width || sy >= raster.height) continue
          const from = (sy * raster.width + sx) * 4
          out.data.set(raster.data.subarray(from, from + 4), (row * width + col) * 4)
        }
      }
      return out
    }
  }
}

function pointInPolygon(x: number, y: number, polygon: Array<[number, number]>): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersects) inside = !inside
  }
  return inside
}

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value(this: HTMLCanvasElement, kind: string) {
    if (kind !== '2d') return null
    rasterOf(this)
    const key = '__ctx2d'
    const cached = (this as unknown as Record<string, unknown>)[key]
    if (cached) return cached
    const ctx = createContext2d(this)
    ;(this as unknown as Record<string, unknown>)[key] = ctx
    return ctx
  }
})

Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
  configurable: true,
  value(this: HTMLCanvasElement, type?: string) {
    if (type !== 'image/png') throw new Error(`unexpected toDataURL(${type})`)
    return pngOf(rasterOf(this))
  }
})
