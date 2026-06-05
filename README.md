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

## License

MIT
