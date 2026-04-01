/**
 * Native validation loader — loads the Rust NAPI binary.
 *
 * @implements FR40
 */

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { arch, platform } from 'node:process'
import { fileURLToPath } from 'node:url'

const require2 = createRequire(import.meta.url)
const __dirname2 = dirname(fileURLToPath(import.meta.url))

const platformMap: Record<string, string> = {
  'linux-x64': 'linux-x64-gnu',
  'linux-arm64': 'linux-arm64-gnu',
  'darwin-x64': 'darwin-x64',
  'darwin-arm64': 'darwin-arm64',
  'win32-x64': 'win32-x64-msvc',
}

let native: { validate: (json: string) => string } | undefined
let loadError: unknown

try {
  const suffix = platformMap[`${platform}-${arch}`]
  if (suffix) {
    native = require2(join(__dirname2, `../index.${suffix}.node`))
  }
} catch (e) {
  loadError = e
}

/**
 * Validate data via the Rust NAPI engine.
 */
export function validateNative(requestJson: string): { valid: boolean; errors: Array<{ field: string; rule: string; message: string }>; data?: Record<string, unknown> } {
  if (!native) {
    throw new Error(`[RUNE_NAPI_NOT_FOUND] Rust validation engine not available: ${loadError ?? 'binary not found'}`)
  }
  return JSON.parse(native.validate(requestJson))
}

export function isNativeAvailable(): boolean {
  return native !== undefined
}
