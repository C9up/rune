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
const TOKENS: Array<[string, string]> = [
	["YYYY", "(\\d{4})"],
	["MM", "(\\d{2})"],
	["DD", "(\\d{2})"],
	["HH", "(\\d{2})"],
	["mm", "(\\d{2})"],
	["ss", "(\\d{2})"],
];

/** Parse `value` against a token format such as `DD/MM/YYYY`. */
export function parseWithFormat(value: string, format: string): Date | null {
	const order: string[] = [];
	let pattern = "";
	let i = 0;
	while (i < format.length) {
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
	const m = new RegExp(`^${pattern}$`).exec(value.trim());
	if (!m) return null;
	const part: Record<string, number> = {};
	order.forEach((t, idx) => {
		part[t] = Number(m[idx + 1]);
	});
	if (
		part.YYYY === undefined ||
		part.MM === undefined ||
		part.DD === undefined
	) {
		return null;
	}
	return buildDate(
		part.YYYY,
		part.MM,
		part.DD,
		part.HH ?? 0,
		part.mm ?? 0,
		part.ss ?? 0,
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
