/**
 * Rune i18n — internationalization for validation error messages.
 *
 * @implements FR42
 */

export type MessageTranslator = (key: string, params?: Record<string, string | number>) => string | undefined

/** Built-in English messages (default). */
const DEFAULT_MESSAGES: Record<string, string> = {
  'required': '{field} is required',
  'string': 'Must be a string',
  'number': 'Must be a number',
  'boolean': 'Must be a boolean',
  'min': 'Minimum {min}',
  'max': 'Maximum {max}',
  'email': 'Must be a valid email',
  'positive': 'Must be positive',
}

/**
 * I18n message registry for Rune validation.
 *
 * Usage:
 *   const i18n = new RuneI18n()
 *   i18n.locale('fr', {
 *     'required': '{field} est requis',
 *     'email': 'Doit être un email valide',
 *   })
 *   i18n.setLocale('fr')
 *   // Now validation errors use French messages
 */
export class RuneI18n {
  private locales: Map<string, Record<string, string>> = new Map()
  private currentLocale = 'en'
  private translator?: MessageTranslator

  constructor() {
    this.locales.set('en', { ...DEFAULT_MESSAGES })
  }

  /** Register messages for a locale. */
  locale(name: string, messages: Record<string, string>): this {
    const existing = this.locales.get(name) ?? {}
    this.locales.set(name, { ...existing, ...messages })
    return this
  }

  /** Set the active locale. */
  setLocale(name: string): this {
    this.currentLocale = name
    return this
  }

  /** Get the active locale. */
  getLocale(): string {
    return this.currentLocale
  }

  /** Set a custom translator function (overrides locale messages). */
  setTranslator(translator: MessageTranslator): this {
    this.translator = translator
    return this
  }

  /** Translate a validation error message. */
  translate(key: string, params?: Record<string, string | number>): string {
    // Custom translator takes priority
    if (this.translator) {
      const result = this.translator(key, params)
      if (result) return result
    }

    // Look up in current locale, fall back to English
    const messages = this.locales.get(this.currentLocale) ?? this.locales.get('en') ?? {}
    let message = messages[key] ?? DEFAULT_MESSAGES[key] ?? key

    // Replace {param} placeholders (escape key for safe RegExp)
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        const escapedKey = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        message = message.replace(new RegExp(`\\{${escapedKey}\\}`, 'g'), String(v))
      }
    }

    return message
  }
}
