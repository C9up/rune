# @c9up/rune

Validation engine for Node.js. Fluent rules, schema validation, transforms.

## Installation

```bash
pnpm add @c9up/rune
```

A schema the Rust engine can run is run by it or not at all. Each platform's engine is its own npm package, which `@c9up/rune` lists as an optional dependency at its exact version:

| Platform | Package |
|---|---|
| Linux x64 (glibc) | `@c9up/rune-linux-x64-gnu` |
| Linux arm64 (glibc) | `@c9up/rune-linux-arm64-gnu` |
| macOS x64 | `@c9up/rune-darwin-x64` |
| macOS arm64 | `@c9up/rune-darwin-arm64` |
| Windows x64 | `@c9up/rune-win32-x64-msvc` |

Your package manager installs only the one that matches the machine (`os`, `cpu` and `libc` fields), so an install downloads one binary and needs no Rust toolchain. An install run with optional dependencies omitted (`--no-optional`, `--omit=optional`) skips it. Each platform package carries `LICENSE` and `LICENSE-THIRD-PARTY.md`, like this one.

If the engine is missing, validating a schema throws `E_RUNE_NAPI_REQUIRED`, naming the package to install:

```text
The Rust validation engine is required but not loaded.
  Fix: install @c9up/rune-linux-x64-gnu at the exact version of @c9up/rune: ...
```

The load error itself is the exception's `cause`.

In a checkout of this repository, `pnpm build:napi` builds `index.<platform>.node` at the package root, and rune loads that file before looking for the platform package. `node scripts/platform-packages.mjs` rewrites the platform packages' manifests (`npm/<platform>/package.json`) and the optional dependencies after a version bump; CI fails when they are stale.

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
// order.name === 'Alice' — throws ValidationError (errors.E_VALIDATION_ERROR) instead of reporting
```

## Features

- `rules.string()`, `rules.number()`, `rules.boolean()`, `rules.any()`
- `.min()`, `.max()`, `.email()`, `.positive()`, `.trim()`, `.optional()`
- `.custom(name, fn, message)` for custom rules
- `.message()` to override error messages
- `.trim()` and the other built-in mutators run before the rules; `.transform()`
  runs after them, on a valid payload; `.parse()` runs first, on the raw input
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

const form = await request.formData() // a web Request
const result = await s.validateResultAsync({
  avatar: ctx.request.file('avatar'),
  report: form.get('report'),
})
```

- `rules.file({ size, extnames, verifyContent })` accepts any object with a
  `size` and a name or extension — the body parser's upload. `extnames` are
  compared lowercase, without the dot.
- `rules.nativeFile({ minSize, maxSize, mimeTypes })` is for the platform
  `File` (what `formData()` returns): anything else, a JSON object shaped like
  a file included, fails with `nativeFile`. It adds a lower bound and a
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
