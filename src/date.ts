/**
 * Date parsing for `rules.date()` — VineJS `vine.date()` parity.
 *
 * VineJS delegates parsing to dayjs. rune has **zero runtime dependencies** and
 * keeps it that way, so the formats it accepts are implemented here: ISO 8601,
 * unix timestamps, and a small token grammar covering the shapes VineJS users
 * actually pass (`DD/MM/YYYY`, `YYYY-MM-DD HH:mm:ss`, …).
 *
 * Every parse is calendar-strict: `2026-02-31` and `2026-13-01` match the
 * pattern but are not dates, and a regex-only check would let them through.
 */

/** Formats accepted by `rules.date({ formats })`. */
export type DateFormat = "iso8601" | "x" | "X" | (string & {});

const ISO_RE =
	/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** Reject a day that the month does not have (incl. leap years). */
function isRealDate(y: number, m: number, d: number): boolean {
	if (m < 1 || m > 12 || d < 1) return false;
	const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
	return d <= daysInMonth;
}

function buildDate(
	y: number,
	mo: number,
	d: number,
	h = 0,
	mi = 0,
	s = 0,
	ms = 0,
	offset?: string,
): Date | null {
	if (!isRealDate(y, mo, d)) return null;
	if (h > 23 || mi > 59 || s > 59) return null;
	if (offset === undefined) {
		const local = new Date(y, mo - 1, d, h, mi, s, ms);
		return Number.isNaN(local.getTime()) ? null : local;
	}
	let utcMs = Date.UTC(y, mo - 1, d, h, mi, s, ms);
	if (offset !== "Z") {
		const sign = offset.startsWith("-") ? 1 : -1;
		const [oh, om] = offset.slice(1).replace(":", "").match(/\d{2}/g) ?? [];
		utcMs += sign * ((Number(oh) || 0) * 60 + (Number(om) || 0)) * 60_000;
	}
	const utc = new Date(utcMs);
	return Number.isNaN(utc.getTime()) ? null : utc;
}

/** Parse an ISO 8601 date or date-time. Returns `null` when not parseable. */
export function parseIso(value: string): Date | null {
	const m = ISO_RE.exec(value.trim());
	if (!m) return null;
	const frac = m[7] ? Number(`0.${m[7]}`) * 1000 : 0;
	return buildDate(
		Number(m[1]),
		Number(m[2]),
		Number(m[3]),
		Number(m[4] ?? 0),
		Number(m[5] ?? 0),
		Number(m[6] ?? 0),
		Math.round(frac),
		m[8],
	);
}

/** Token grammar for custom formats — longest tokens first so `YYYY` beats `YY`. */
/** Month names, long then short — index 0 is January. */
const MONTHS_LONG = [
	"january",
	"february",
	"march",
	"april",
	"may",
	"june",
	"july",
	"august",
	"september",
	"october",
	"november",
	"december",
];
const MONTHS_SHORT = MONTHS_LONG.map((month) => month.slice(0, 3));

/** Weekday names. Parsed and CONSUMED, but they never set the date: a name that
 * contradicts the numeric date would otherwise silently win. */
const DAYS_LONG = [
	"sunday",
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
];
const DAYS_SHORT = DAYS_LONG.map((day) => day.slice(0, 3));

// Longest-first ordering is load-bearing: `MMMM` must be tried before `MM`,
// which must come before `M`, or a name is read as a number and the parse fails.
const TOKENS: Array<[string, string]> = [
	["MMMM", `(${MONTHS_LONG.join("|")})`],
	["MMM", `(${MONTHS_SHORT.join("|")})`],
	["dddd", `(${DAYS_LONG.join("|")})`],
	["ddd", `(${DAYS_SHORT.join("|")})`],
	["YYYY", "(\\d{4})"],
	["YY", "(\\d{2})"],
	["MM", "(\\d{2})"],
	["M", "(\\d{1,2})"],
	["Do", "(\\d{1,2})(?:st|nd|rd|th)"],
	["DD", "(\\d{2})"],
	["D", "(\\d{1,2})"],
	["HH", "(\\d{2})"],
	["H", "(\\d{1,2})"],
	["hh", "(\\d{2})"],
	["h", "(\\d{1,2})"],
	["mm", "(\\d{2})"],
	["m", "(\\d{1,2})"],
	["ss", "(\\d{2})"],
	["s", "(\\d{1,2})"],
	["SSS", "(\\d{3})"],
	["A", "(AM|PM)"],
	["a", "(am|pm)"],
	["ZZ", "([+-]\\d{4}|Z)"],
	["Z", "([+-]\\d{2}:\\d{2}|Z)"],
];

/** Parse `value` against a token format such as `DD/MM/YYYY`. */
export function parseWithFormat(value: string, format: string): Date | null {
	const order: string[] = [];
	let pattern = "";
	let i = 0;
	while (i < format.length) {
		// `[…]` escapes a literal run, so `[at] HH:mm` does not read the `a` as a
		// meridiem token.
		if (format[i] === "[") {
			const close = format.indexOf("]", i);
			if (close === -1) return null;
			pattern += format
				.slice(i + 1, close)
				.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			i = close + 1;
			continue;
		}
		const token = TOKENS.find(([t]) => format.startsWith(t, i));
		if (token) {
			order.push(token[0]);
			pattern += token[1];
			i += token[0].length;
		} else {
			pattern += format[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			i += 1;
		}
	}
	// Case-insensitive: `Jan`, `jan` and `JAN` are the same month, and a format
	// carrying a name token would otherwise only match one spelling.
	const m = new RegExp(`^${pattern}$`, "i").exec(value.trim());
	if (!m) return null;
	const part: Record<string, number> = {};
	let meridiem: "am" | "pm" | null = null;
	let offset: string | undefined;
	order.forEach((t, idx) => {
		const raw = m[idx + 1];
		if (t === "A" || t === "a") {
			meridiem = raw.toLowerCase() as "am" | "pm";
			return;
		}
		if (t === "MMMM" || t === "MMM") {
			const names = t === "MMMM" ? MONTHS_LONG : MONTHS_SHORT;
			part.MM = names.indexOf(raw.toLowerCase()) + 1;
			return;
		}
		if (t === "dddd" || t === "ddd") {
			// Consumed only. A weekday name that contradicts the numeric date must
			// not silently override it — the date wins, the name is decoration.
			return;
		}
		if (t === "Do") {
			part.DD = Number(raw);
			return;
		}
		if (t === "Z" || t === "ZZ") {
			offset = raw.toUpperCase() === "Z" ? "Z" : raw;
			return;
		}
		part[t] = Number(raw);
	});

	// A two-digit year follows the Day.js pivot: 00-68 → 2000s, 69-99 → 1900s.
	const year =
		part.YYYY ??
		(part.YY === undefined
			? undefined
			: part.YY <= 68
				? 2000 + part.YY
				: 1900 + part.YY);
	const month = part.MM ?? part.M;
	const day = part.DD ?? part.D;
	if (year === undefined || month === undefined || day === undefined) {
		return null;
	}

	let hour = part.HH ?? part.H ?? part.hh ?? part.h ?? 0;
	if (meridiem !== null) {
		const twelveHour = part.hh ?? part.h;
		if (twelveHour === undefined || twelveHour < 1 || twelveHour > 12) {
			return null;
		}
		hour = twelveHour % 12;
		if (meridiem === "pm") hour += 12;
	}

	return buildDate(
		year,
		month,
		day,
		hour,
		part.mm ?? part.m ?? 0,
		part.ss ?? part.s ?? 0,
		part.SSS ?? 0,
		offset,
	);
}

/**
 * Parse a value against the configured formats. `Date` instances pass straight
 * through (already parsed); numbers and numeric strings are read as timestamps
 * only when the `x`/`X` format is enabled, matching VineJS.
 */
export function parseDateValue(
	value: unknown,
	formats: DateFormat[],
): Date | null {
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : value;
	}
	if (typeof value !== "string" && typeof value !== "number") return null;

	for (const format of formats) {
		if (format === "x" || format === "X") {
			const n = typeof value === "number" ? value : Number(value);
			if (!Number.isFinite(n)) continue;
			const d = new Date(format === "x" ? n : n * 1000);
			if (!Number.isNaN(d.getTime())) return d;
			continue;
		}
		const s = String(value);
		const d = format === "iso8601" ? parseIso(s) : parseWithFormat(s, format);
		if (d) return d;
	}
	return null;
}

/** Resolve a comparison operand: a keyword, an ISO string, a number or a Date. */
export function resolveOperand(operand: unknown): Date | null {
	if (typeof operand === "string") {
		const midnight = (offsetDays: number): Date => {
			const d = new Date();
			d.setHours(0, 0, 0, 0);
			d.setDate(d.getDate() + offsetDays);
			return d;
		};
		if (operand === "today") return midnight(0);
		if (operand === "tomorrow") return midnight(1);
		if (operand === "yesterday") return midnight(-1);
	}
	return parseDateValue(operand, ["iso8601", "x"]);
}

/** Truncate to the start of the day — backs `{ compare: 'day' }`. */
export function startOfDay(date: Date): Date {
	const d = new Date(date.getTime());
	d.setHours(0, 0, 0, 0);
	return d;
}

/** Granularity of a date comparison (VineJS `{ compare }`, dayjs units). */
export type CompareUnit =
	| "millisecond"
	| "second"
	| "minute"
	| "hour"
	| "day"
	| "month"
	| "year";

/**
 * Truncate a date to `unit`, so a comparison ignores everything finer.
 * VineJS compares at DAY granularity by default (`options.compare || "day"`),
 * which is why a bare `after('today')` is about the date, not the clock.
 */
export function truncateTo(date: Date, unit: CompareUnit): number {
	const d = new Date(date.getTime());
	switch (unit) {
		case "year":
			d.setMonth(0, 1);
			d.setHours(0, 0, 0, 0);
			break;
		case "month":
			d.setDate(1);
			d.setHours(0, 0, 0, 0);
			break;
		case "day":
			d.setHours(0, 0, 0, 0);
			break;
		case "hour":
			d.setMinutes(0, 0, 0);
			break;
		case "minute":
			d.setSeconds(0, 0);
			break;
		case "second":
			d.setMilliseconds(0);
			break;
		case "millisecond":
			break;
	}
	return d.getTime();
}
