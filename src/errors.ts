/**
 * RuneError — structured error for Rune validation.
 */
export class RuneError extends Error {
  readonly code: string
  readonly hint?: string

  constructor(code: string, message: string, options?: { hint?: string }) {
    super(message)
    this.name = 'RuneError'
    this.code = `RUNE_${code}`
    this.hint = options?.hint
  }
}
