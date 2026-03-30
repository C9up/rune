/**
 * Rune Validation Schema — fluent validation rules.
 *
 * @implements FR38, FR39, FR41
 */

import { RuneError } from './errors.js'

export interface ValidationError {
  field: string
  rule: string
  message: string
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  data?: Record<string, unknown>
}

export interface ValidationSchema {
  fields: Record<string, RuleChain>
  validate(data: Record<string, unknown>): ValidationResult
}

/** Create a validation schema. */
export function schema(fields: Record<string, RuleChain>): ValidationSchema {
  return {
    fields,
    validate(data: Record<string, unknown>): ValidationResult {
      // Guard against null/undefined/non-object input
      if (data === null || data === undefined || typeof data !== 'object' || Array.isArray(data)) {
        return { valid: false, errors: [{ field: '_root', rule: 'type', message: 'Input must be an object' }] }
      }

      const errors: ValidationError[] = []
      const validated: Record<string, unknown> = {}

      for (const [field, chain] of Object.entries(fields)) {
        const value = data[field]
        const result = chain._validateWithTransform(field, value)
        errors.push(...result.errors)
        if (result.errors.length === 0 && value !== undefined) {
          validated[field] = result.transformed
        }
      }

      return {
        valid: errors.length === 0,
        errors,
        data: errors.length === 0 ? validated : undefined,
      }
    },
  }
}

/** Rule chain — fluent validation builder. */
export class RuleChain {
  private _rules: Array<{ name: string; validate: (value: unknown) => boolean; message: string }> = []
  private _optional = false
  private _transforms: Array<(value: unknown) => unknown> = []

  /** Mark field as optional. */
  optional(): this {
    this._optional = true
    return this
  }

  /** Must be a string. */
  string(): this {
    this._rules.push({ name: 'string', validate: (v) => typeof v === 'string', message: 'Must be a string' })
    return this
  }

  /** Must be a number. */
  number(): this {
    this._rules.push({ name: 'number', validate: (v) => typeof v === 'number' && !Number.isNaN(v) && Number.isFinite(v), message: 'Must be a number' })
    return this
  }

  /** Must be a boolean. */
  boolean(): this {
    this._rules.push({ name: 'boolean', validate: (v) => typeof v === 'boolean', message: 'Must be a boolean' })
    return this
  }

  /** Minimum length (string) or minimum value (number). */
  min(n: number): this {
    this._rules.push({
      name: 'min',
      validate: (v) => typeof v === 'string' ? v.length >= n : typeof v === 'number' ? v >= n : false,
      message: `Minimum ${n}`,
    })
    return this
  }

  /** Maximum length (string) or maximum value (number). */
  max(n: number): this {
    this._rules.push({
      name: 'max',
      validate: (v) => typeof v === 'string' ? v.length <= n : typeof v === 'number' ? v <= n : false,
      message: `Maximum ${n}`,
    })
    return this
  }

  /** Must be a valid email. */
  email(): this {
    this._rules.push({
      name: 'email',
      validate: (v) => typeof v === 'string' && !/[\r\n]/.test(v) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      message: 'Must be a valid email',
    })
    return this
  }

  /** Must be positive (> 0) and finite. */
  positive(): this {
    this._rules.push({
      name: 'positive',
      validate: (v) => typeof v === 'number' && Number.isFinite(v) && v > 0,
      message: 'Must be positive',
    })
    return this
  }

  /** Trim whitespace (transform). */
  trim(): this {
    this._transforms.push((v) => typeof v === 'string' ? v.trim() : v)
    return this
  }

  /** Custom validation rule. */
  custom(name: string, validate: (value: unknown) => boolean, message?: string): this {
    this._rules.push({ name, validate, message: message ?? `Failed custom rule: ${name}` })
    return this
  }

  /** Set custom error message for the last rule. */
  message(msg: string): this {
    if (this._rules.length === 0) {
      throw new RuneError('NO_RULE', 'message() must be called after a rule')
    }
    this._rules[this._rules.length - 1].message = msg
    return this
  }

  /** Internal: validate a field value and return errors + transformed value (single transform pass). */
  _validateWithTransform(field: string, value: unknown): { errors: ValidationError[]; transformed: unknown } {
    if (value === undefined || value === null) {
      if (this._optional) return { errors: [], transformed: value }
      return { errors: [{ field, rule: 'required', message: `${field} is required` }], transformed: value }
    }

    const errors: ValidationError[] = []
    const transformed = this._transform(value)

    for (const rule of this._rules) {
      if (!rule.validate(transformed)) {
        errors.push({ field, rule: rule.name, message: rule.message })
      }
    }

    return { errors, transformed }
  }

  /** Internal: validate a field value against all rules. */
  _validate(field: string, value: unknown): ValidationError[] {
    return this._validateWithTransform(field, value).errors
  }

  /** Internal: apply transforms. */
  _transform(value: unknown): unknown {
    let result = value
    for (const transform of this._transforms) {
      result = transform(result)
    }
    return result
  }
}

/** Entry point for building rules. */
export const rules = {
  string: () => new RuleChain().string(),
  number: () => new RuleChain().number(),
  boolean: () => new RuleChain().boolean(),
  any: () => new RuleChain(),
}
