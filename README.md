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

// `validateResult` reports the failure; `validate` throws it.
const result = CreateOrder.validateResult({ total: 42, email: 'a@b.com', name: '  Alice  ' })
// result.valid === true, result.data.name === 'Alice'

const order = await CreateOrder.validate({ total: 42, email: 'a@b.com', name: '  Alice  ' })
// order.name === 'Alice' — throws RuneValidationError instead of reporting
```

## Features

- `rules.string()`, `rules.number()`, `rules.boolean()`, `rules.any()`
- `.min()`, `.max()`, `.email()`, `.positive()`, `.trim()`, `.optional()`
- `.custom(name, fn, message)` for custom rules
- `.message()` to override error messages
- Transforms applied before validation
- String lengths (`minLength`, `maxLength`, `fixedLength`, `min`, `max`) count
  characters as Unicode code points: `"😀"` is one character, not two UTF-16
  units — the unit a database column and a JSON Schema `maxLength` count in
- Structured error output with field, rule, message
- Country and locale tables: postal codes (71), mobile numbering plans (169),
  passport numbers (61), VAT numbers (69) — an unknown one is refused, never
  waved through
- `normalizeEmail()` and `normalizeUrl()`, and a JSON Schema for the shape a
  validator accepts

No runtime dependencies.

## Files

```typescript
const s = schema({
  avatar: rules.file({ size: '2mb', extnames: ['jpg', 'png'] }),
  report: rules.nativeFile({ maxSize: '10mb', mimeTypes: ['application/pdf'] }),
})

const result = await s.validateResultAsync({
  avatar: ctx.request.file('avatar'),
  report: ctx.request.file('report'),
})
```

- `rules.file({ size, extnames, verifyContent })` accepts any object with a
  `size` and a name or extension. `extnames` are compared lowercase, without
  the dot.
- `rules.nativeFile({ minSize, maxSize, mimeTypes })` adds a lower bound and a
  MIME-type list.
- Sizes are a byte count or a spelling such as `'512kb'`, `'2mb'`, `'1gb'`
  (powers of 1024). A spelling rune cannot read throws `E_RUNE_INVALID_SIZE`
  when the schema is built, rather than leaving the field uncapped.

The name, the extension and the reported type all come from the uploader: a
`.exe` renamed `.png` satisfies every one of them. So declaring `extnames` or
`mimeTypes` also reads the file's leading bytes and refuses content that does
not match the declaration (rule `verifyContent`); `.verifyContent()` arms the
same check on a chain that declares neither. The check is asynchronous: a
schema carrying it runs through `validate()` / `validateResultAsync()`.

The check reads bytes only: the upload's in-memory `content` / `buffer`, a
`Blob`, or what the reader a host binds with `rune.bindFileReader()` returns.
A path on the value is never opened (a JSON body can build a file-shaped
object, and a path in it would be a read of any file the process can open).
With no byte source, the check fails rather than passing.

```typescript
import rune from '@c9up/rune'

rune.bindFileReader((file) =>
  file instanceof MyUpload ? readHead(file.tmpPath) : null,
)
```

`rules.file({ extnames, verifyContent: false })` turns the content check off.
The extension list is then the uploader's word alone; keep the opt-out for
files whose bytes are checked elsewhere.

## Strict numbers and booleans, empty strings

`rules.number()` and `rules.boolean()` coerce the text a form or a query
string carries (`"32"` → `32`; `"true"`, `"on"`, `"1"` → `true`).
`rules.number({ strict: true })` and `rules.boolean({ strict: true })` refuse
anything that is not already a number or a boolean: the choice for a JSON API
where `"1"` is a client bug.

`rune.convertEmptyStringsToNull = true` reads every `""` as `null` before the
rules run, for every schema in the process. An empty input then counts as
absent: `.optional()` accepts it, a required field refuses it as missing, and a
string rule never sees `""`. It is off by default; turn it on once, at boot,
not per request.

## License

MIT. Two modules are transcribed from MIT-licensed libraries rather than
depending on them — see [LICENSE-THIRD-PARTY.md](./LICENSE-THIRD-PARTY.md).
