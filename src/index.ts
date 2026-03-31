/**
 * @module @c9up/rune
 * @description Rune — Validation engine for the Ream framework
 * @implements FR38, FR39, FR40, FR41, FR42
 */

export { rules, schema } from './Schema.js'
export type { RuleChain, ValidationError, ValidationResult, ValidationSchema } from './Schema.js'
export { RuneError } from './errors.js'
export { RuneI18n } from './i18n.js'
export type { MessageTranslator } from './i18n.js'
