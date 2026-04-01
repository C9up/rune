import { describe, expect, it } from 'vitest'
import { rules, schema } from '../../src/index.js'

describe('rune > schema validation', () => {
  it('validates valid data', () => {
    const s = schema({
      name: rules.string().min(3).max(100),
      email: rules.string().email(),
      age: rules.number().positive(),
    })

    const result = s.validate({ name: 'Kaen', email: 'kaen@c9up.com', age: 28 })
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.data?.name).toBe('Kaen')
  })

  it('rejects invalid data with errors', () => {
    const s = schema({
      name: rules.string().min(3),
      email: rules.string().email(),
    })

    const result = s.validate({ name: 'Ka', email: 'not-an-email' })
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBe(2)
    const fields = result.errors.map((e) => e.field).sort()
    expect(fields).toEqual(['email', 'name'])
    expect(result.errors.find((e) => e.field === 'name')?.rule).toBe('min')
  })

  it('reports missing required fields', () => {
    const s = schema({ name: rules.string() })
    const result = s.validate({})
    expect(result.valid).toBe(false)
    expect(result.errors[0].rule).toBe('required')
  })

  it('optional fields skip validation when absent', () => {
    const s = schema({ bio: rules.string().optional() })
    const result = s.validate({})
    expect(result.valid).toBe(true)
  })

  it('applies transforms (trim)', () => {
    const s = schema({ name: rules.string().trim().min(3) })
    const result = s.validate({ name: '  Kaen  ' })
    expect(result.valid).toBe(true)
    expect(result.data?.name).toBe('Kaen')
  })
})

describe('rune > rule types', () => {
  it('string rule', () => {
    const s = schema({ x: rules.string() })
    expect(s.validate({ x: 'hello' }).valid).toBe(true)
    expect(s.validate({ x: 123 }).valid).toBe(false)
  })

  it('number rule', () => {
    const s = schema({ x: rules.number() })
    expect(s.validate({ x: 42 }).valid).toBe(true)
    expect(s.validate({ x: 'nope' }).valid).toBe(false)
  })

  it('boolean rule', () => {
    const s = schema({ x: rules.boolean() })
    expect(s.validate({ x: true }).valid).toBe(true)
    expect(s.validate({ x: 'yes' }).valid).toBe(false)
  })

  it('positive rule', () => {
    const s = schema({ x: rules.number().positive() })
    expect(s.validate({ x: 5 }).valid).toBe(true)
    expect(s.validate({ x: -1 }).valid).toBe(false)
    expect(s.validate({ x: 0 }).valid).toBe(false)
  })

  it('email rule', () => {
    const s = schema({ x: rules.string().email() })
    expect(s.validate({ x: 'a@b.com' }).valid).toBe(true)
    expect(s.validate({ x: 'nope' }).valid).toBe(false)
  })

  it('custom rule', () => {
    const s = schema({
      phone: rules.string().custom('frenchPhone', (v) => /^0[1-9]\d{8}$/.test(v as string), 'Invalid French phone'),
    })
    expect(s.validate({ phone: '0612345678' }).valid).toBe(true)
    expect(s.validate({ phone: '123' }).valid).toBe(false)
  })

  it('custom error message', () => {
    const s = schema({
      email: rules.string().email().message('Please enter a valid email address'),
    })
    const result = s.validate({ email: 'bad' })
    expect(result.errors[0].message).toBe('Please enter a valid email address')
  })
})

describe('rune > security & edge cases', () => {
  it('rejects email with newline (header injection)', () => {
    const s = schema({ email: rules.string().email() })
    expect(s.validate({ email: 'user@example.com\n' }).valid).toBe(false)
    expect(s.validate({ email: 'user@example.com\r\nBcc: evil@hacker.com' }).valid).toBe(false)
  })

  it('rejects Infinity as number', () => {
    const s = schema({ x: rules.number() })
    expect(s.validate({ x: Infinity }).valid).toBe(false)
    expect(s.validate({ x: -Infinity }).valid).toBe(false)
  })

  it('rejects Infinity in positive', () => {
    const s = schema({ x: rules.number().positive() })
    expect(s.validate({ x: Infinity }).valid).toBe(false)
  })

  it('rejects NaN', () => {
    const s = schema({ x: rules.number() })
    expect(s.validate({ x: NaN }).valid).toBe(false)
  })

  it('handles null input to schema.validate', () => {
    const s = schema({ name: rules.string() })
    const result = s.validate(null as unknown as Record<string, unknown>)
    expect(result.valid).toBe(false)
    expect(result.errors[0].field).toBe('_root')
  })

  it('handles undefined input to schema.validate', () => {
    const s = schema({ name: rules.string() })
    const result = s.validate(undefined as unknown as Record<string, unknown>)
    expect(result.valid).toBe(false)
  })

  it('message() throws if no rule exists', () => {
    expect(() => rules.any().message('test')).toThrow('message() must be called after a rule')
  })

  it('custom rule default message', () => {
    const s = schema({
      x: rules.string().custom('slug', (v) => typeof v === 'string' && /^[a-z-]+$/.test(v)),
    })
    const result = s.validate({ x: 'NOT_A_SLUG' })
    expect(result.errors[0].message).toBe('Failed custom rule: slug')
  })
})
