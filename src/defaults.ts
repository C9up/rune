/**
 * Default error message templates, mirroring `the upstream package`'s `./defaults`.
 *
 * Every template is a mustache string interpolated with `{{ field }}` — the
 * failing field's LAST path segment, or the label a messages provider maps it
 * to — plus whatever the rule put in its `args` (`{{ min }}`, `{{ max }}`,
 * `{{ otherField }}`, ...). Keeping the text here rather than inline at each
 * rule is what lets a messages provider, a translator and the raw default all
 * read from ONE table: a rule that carried its own pre-formatted string could
 * never be re-rendered in another language.
 *
 * Keys mirror what a rule REPORTS, so `messages` doubles as the key space a
 * caller writes against:
 *
 * ```ts
 * rune.messagesProvider = new SimpleMessagesProvider({
 *   "array.minLength": "Pick at least {{ min }}",
 * })
 * ```
 *
 * ## Named deviation: `record` and `tuple` are reachable here
 *
 * Upstream ships `record` and `tuple` keys but reports those type failures as
 * `object` and `array`, so its own two entries can never be selected. rune
 * reports `record` and `tuple`, which makes the keys mean what they say. The
 * text is upstream's, unchanged — only the key becomes reachable.
 */

/**
 * The one template resolved outside the rule pipeline: a missing field never
 * reaches a rule, so it has no `RuleDef` to read a default off. Named so it
 * types as a plain string rather than an optional index lookup.
 */
export const requiredMessage = "The {{ field }} field must be defined";

/** Rule name → message template. */
export const messages: Record<string, string> = {
	required: requiredMessage,
	string: "The {{ field }} field must be a string",
	email: "The {{ field }} field must be a valid email address",
	mobile: "The {{ field }} field must be a valid mobile phone number",
	creditCard:
		"The {{ field }} field must be a valid {{ providersList }} card number",
	passport: "The {{ field }} field must be a valid passport number",
	postalCode: "The {{ field }} field must be a valid postal code",
	regex: "The {{ field }} field format is invalid",
	ascii: "The {{ field }} field must only contain ASCII characters",
	iban: "The {{ field }} field must be a valid IBAN number",
	jwt: "The {{ field }} field must be a valid JWT token",
	coordinates:
		"The {{ field }} field must contain latitude and longitude coordinates",
	url: "The {{ field }} field must be a valid URL",
	activeUrl: "The {{ field }} field must be a valid URL",
	alpha: "The {{ field }} field must contain only letters",
	alphaNumeric: "The {{ field }} field must contain only letters and numbers",
	minLength: "The {{ field }} field must have at least {{ min }} characters",
	maxLength:
		"The {{ field }} field must not be greater than {{ max }} characters",
	fixedLength: "The {{ field }} field must be {{ size }} characters long",
	confirmed:
		"The {{ originalField }} field and {{ otherField }} field must be the same",
	endsWith: "The {{ field }} field must end with {{ substring }}",
	startsWith: "The {{ field }} field must start with {{ substring }}",
	sameAs: "The {{ field }} field and {{ otherField }} field must be the same",
	notSameAs:
		"The {{ field }} field and {{ otherField }} field must be different",
	in: "The selected {{ field }} is invalid",
	notIn: "The selected {{ field }} is invalid",
	ipAddress: "The {{ field }} field must be a valid IP address",
	vat: "The {{ field }} field must be a valid VAT number",
	uuid: "The {{ field }} field must be a valid UUID",
	ulid: "The {{ field }} field must be a valid ULID",
	hexCode: "The {{ field }} field must be a valid hex color code",
	// Upstream leaves this one without a `{{ field }}` token. Transcribed as it
	// is: a caller who overrides the key gets their own text either way, and
	// "fixing" it here would make the default text differ from upstream's for
	// no gain the caller asked for.
	boolean: "The value must be a boolean",
	number: "The {{ field }} field must be a number",
	"number.in": "The selected {{ field }} is not in {{ values }}",
	min: "The {{ field }} field must be at least {{ min }}",
	max: "The {{ field }} field must not be greater than {{ max }}",
	range: "The {{ field }} field must be between {{ min }} and {{ max }}",
	positive: "The {{ field }} field must be positive",
	negative: "The {{ field }} field must be negative",
	nonNegative: "The {{ field }} field must be positive or zero",
	nonPositive: "The {{ field }} field must be negative or zero",
	decimal: "The {{ field }} field must have {{ digits }} decimal places",
	withoutDecimals: "The {{ field }} field must be an integer",
	accepted: "The {{ field }} field must be accepted",
	enum: "The selected {{ field }} is invalid",
	literal: "The {{ field }} field must be {{ expectedValue }}",
	object: "The {{ field }} field must be an object",
	array: "The {{ field }} field must be an array",
	"array.minLength": "The {{ field }} field must have at least {{ min }} items",
	"array.maxLength":
		"The {{ field }} field must not have more than {{ max }} items",
	"array.fixedLength": "The {{ field }} field must contain {{ size }} items",
	notEmpty: "The {{ field }} field must not be empty",
	distinct: "The {{ field }} field has duplicate values",
	record: "The {{ field }} field must be an object",
	"record.minLength":
		"The {{ field }} field must have at least {{ min }} items",
	"record.maxLength":
		"The {{ field }} field must not have more than {{ max }} items",
	"record.fixedLength": "The {{ field }} field must contain {{ size }} items",
	tuple: "The {{ field }} field must be an array",
	union: "Invalid value provided for {{ field }} field",
	unionGroup: "Invalid value provided for {{ field }} field",
	unionOfTypes: "Invalid value provided for {{ field }} field",
	date: "The {{ field }} field must be a datetime value",
	"date.equals":
		"The {{ field }} field must be a date equal to {{ expectedValue }}",
	"date.after":
		"The {{ field }} field must be a date after {{ expectedValue }}",
	"date.before":
		"The {{ field }} field must be a date before {{ expectedValue }}",
	"date.afterOrEqual":
		"The {{ field }} field must be a date after or equal to {{ expectedValue }}",
	"date.beforeOrEqual":
		"The {{ field }} field must be a date before or equal to {{ expectedValue }}",
	"date.sameAs":
		"The {{ field }} field and {{ otherField }} field must be the same",
	"date.notSameAs":
		"The {{ field }} field and {{ otherField }} field must be different",
	"date.afterField":
		"The {{ field }} field must be a date after {{ otherField }}",
	"date.afterOrSameAs":
		"The {{ field }} field must be a date after or same as {{ otherField }}",
	"date.beforeField":
		"The {{ field }} field must be a date before {{ otherField }}",
	"date.beforeOrSameAs":
		"The {{ field }} field must be a date before or same as {{ otherField }}",
	"date.weekend": "The {{ field }} field is not a weekend",
	"date.weekday": "The {{ field }} field is not a weekday",
	nativeFile: "The {{ field }} field must be a valid file",
	"nativeFile.minSize":
		"The {{ field }} field must be at least {{ min }} bytes in size",
	"nativeFile.maxSize":
		"The {{ field }} field must not exceed {{ max }} bytes in size",
	"nativeFile.mimeTypes": "The {{ field }} mime type is invalid",

	// ---------------------------------------------------------------------
	// rune-only rules. Upstream has no equivalent, so there is nothing to
	// transcribe — the wording follows the same shape so a catalogue reads as
	// one voice.
	// ---------------------------------------------------------------------
	/** rune's own multipart file type, distinct from the web `File` above. */
	file: "The {{ field }} field must be a valid file",
	"file.minSize": "The {{ field }} field must be at least {{ size }} in size",
	"file.maxSize": "The {{ field }} field must not exceed {{ size }} in size",
	"file.mimeTypes": "The {{ field }} mime type is invalid",
};

/**
 * Field path → human label. The empty key names the root payload, which is what
 * an error on the object itself is reported against.
 */
export const fields: Record<string, string> = { "": "data" };
