/**
 * Mounts the real viewport in Chromium and screenshots it.
 *
 * Unit tests cover the pure decisions; this covers what they cannot — that the
 * scene, grid, lights and atlas reach pixels. Run after changing `viewport/`:
 *
 *   node .omo/roblox-fix/verify-viewport.mjs
 */

import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'shots')
mkdirSync(out, { recursive: true })

const CHROME =
  process.env.CHROME_PATH ??
  'C:\\Users\\Novella\\AppData\\Local\\ms-playwright\\chromium-1208\\chrome-win64\\chrome.exe'

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
})
const page = await browser.newPage({ viewport: { width: 900, height: 620 } })
page.on('pageerror', (error) => console.log('[throw]', error.message))
page.on('console', (message) => {
  if (message.type() === 'error') console.log('[error]', message.text())
})

await page.goto(`http://localhost:${process.env.PORT ?? 5180}/viewport-harness.html`, {
  waitUntil: 'domcontentloaded',
  timeout: 90_000
})

try {
  await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 90_000 })
  console.log('scene ready:', await page.evaluate(() => window.__LABEL__))
} catch {
  console.log('scene never became ready')
}

await page.waitForTimeout(1200)
await page.screenshot({ path: join(out, 'viewport.png') })
console.log('wrote shots/viewport.png')
await browser.close()
