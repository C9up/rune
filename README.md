# @c9up/rune

Validation engine for Node.js. Fluent rules, schema validation, transforms.

## Usage

```typescript
import { rules, schema } from '@c9up/rune'

const CreateOrder = schema({
  total: rules.number().positive(),
  email: rules.string().email(),
  name: rules.string().min(3).max(100).trim(),
})

const result = CreateOrder.validate({ total: 42, email: 'a@b.com', name: '  Alice  ' })
// result.valid === true, result.data.name === 'Alice'
```

## Features

- `rules.string()`, `rules.number()`, `rules.boolean()`, `rules.any()`
- `.min()`, `.max()`, `.email()`, `.positive()`, `.trim()`, `.optional()`
- `.custom(name, fn, message)` for custom rules
- `.message()` to override error messages
- Transforms applied before validation
- Structured error output with field, rule, message
- Country and locale tables: postal codes (71), mobile numbering plans (169),
  passport numbers (61), VAT numbers (69) — an unknown one is refused, never
  waved through
- `normalizeEmail()` and `normalizeUrl()`, and a JSON Schema for the shape a
  validator accepts

No runtime dependencies.

## License

MIT. Two modules are transcribed from MIT-licensed libraries rather than
depending on them — see [LICENSE-THIRD-PARTY.md](./LICENSE-THIRD-PARTY.md).
