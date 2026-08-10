/**
 * Content-based file type detection — magic numbers.
 *
 * Adonis rejects a `.exe` renamed to `.jpg` because its bodyparser sniffs the
 * real bytes. rune validates a structural object, so on its own it can only
 * trust what the upload DECLARES. This module closes that gap when a byte
 * source is reachable: no external dependency, just the signature table and
 * `node:fs` to read the first bytes.
 *
 * Signatures are matched at their documented offsets, longest-first, so a
 * container that shares a prefix with another format is not mistaken for it.
 */

import { open } from "node:fs/promises";

/** One magic-number signature. */
interface Signature {
	/** File extension, lowercase, no dot. */
	ext: string;
	/** Canonical MIME type. */
	mime: string;
	/** Byte offset the pattern starts at. */
	offset: number;
	/** Bytes to match; `null` matches any byte at that position. */
	bytes: ReadonlyArray<number | null>;
}

const ascii = (text: string): number[] =>
	[...text].map((char) => char.charCodeAt(0));

/**
 * Ordered longest-pattern-first within an offset group. `zip` sits LAST of the
 * PK family because docx/xlsx/pptx are zip containers: matching `zip` first
 * would label every Office document a zip.
 */
const SIGNATURES: readonly Signature[] = [
	{
		ext: "png",
		mime: "image/png",
		offset: 0,
		bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
	},
	{ ext: "jpg", mime: "image/jpeg", offset: 0, bytes: [0xff, 0xd8, 0xff] },
	{ ext: "gif", mime: "image/gif", offset: 0, bytes: ascii("GIF8") },
	{ ext: "bmp", mime: "image/bmp", offset: 0, bytes: ascii("BM") },
	{ ext: "webp", mime: "image/webp", offset: 8, bytes: ascii("WEBP") },
	{ ext: "avif", mime: "image/avif", offset: 4, bytes: ascii("ftypavif") },
	{ ext: "heic", mime: "image/heic", offset: 4, bytes: ascii("ftypheic") },
	{
		ext: "tif",
		mime: "image/tiff",
		offset: 0,
		bytes: [0x49, 0x49, 0x2a, 0x00],
	},
	{
		ext: "tif",
		mime: "image/tiff",
		offset: 0,
		bytes: [0x4d, 0x4d, 0x00, 0x2a],
	},
	{
		ext: "ico",
		mime: "image/x-icon",
		offset: 0,
		bytes: [0x00, 0x00, 0x01, 0x00],
	},
	{ ext: "pdf", mime: "application/pdf", offset: 0, bytes: ascii("%PDF-") },
	{ ext: "mp4", mime: "video/mp4", offset: 4, bytes: ascii("ftyp") },
	{
		ext: "webm",
		mime: "video/webm",
		offset: 0,
		bytes: [0x1a, 0x45, 0xdf, 0xa3],
	},
	{ ext: "ogg", mime: "audio/ogg", offset: 0, bytes: ascii("OggS") },
	{ ext: "wav", mime: "audio/wav", offset: 8, bytes: ascii("WAVE") },
	{ ext: "mp3", mime: "audio/mpeg", offset: 0, bytes: ascii("ID3") },
	{ ext: "mp3", mime: "audio/mpeg", offset: 0, bytes: [0xff, 0xfb] },
	{ ext: "flac", mime: "audio/flac", offset: 0, bytes: ascii("fLaC") },
	{ ext: "gz", mime: "application/gzip", offset: 0, bytes: [0x1f, 0x8b] },
	{ ext: "bz2", mime: "application/x-bzip2", offset: 0, bytes: ascii("BZh") },
	{
		ext: "7z",
		mime: "application/x-7z-compressed",
		offset: 0,
		bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c],
	},
	{ ext: "rar", mime: "application/vnd.rar", offset: 0, bytes: ascii("Rar!") },
	{
		ext: "zip",
		mime: "application/zip",
		offset: 0,
		bytes: [0x50, 0x4b, 0x03, 0x04],
	},
	// Executables — the whole point of sniffing: these must never pass as media.
	{
		ext: "exe",
		mime: "application/vnd.microsoft.portable-executable",
		offset: 0,
		bytes: ascii("MZ"),
	},
	{
		ext: "elf",
		mime: "application/x-elf",
		offset: 0,
		bytes: [0x7f, 0x45, 0x4c, 0x46],
	},
	{
		ext: "class",
		mime: "application/java-vm",
		offset: 0,
		bytes: [0xca, 0xfe, 0xba, 0xbe],
	},
	{
		ext: "wasm",
		mime: "application/wasm",
		offset: 0,
		bytes: [0x00, 0x61, 0x73, 0x6d],
	},
];

/** How many leading bytes are enough for every signature above. */
export const MAGIC_HEAD_BYTES = 32;

/** The detected type of a byte head, or `null` when nothing matches. */
export interface DetectedType {
	ext: string;
	mime: string;
}

/** Does `head` carry `signature` at its documented offset? */
function matches(head: Uint8Array, signature: Signature): boolean {
	if (head.length < signature.offset + signature.bytes.length) return false;
	return signature.bytes.every((byte, index) => {
		if (byte === null) return true;
		return head[signature.offset + index] === byte;
	});
}

/**
 * Detect the type of a byte head. Returns `null` when no signature matches —
 * never a guess: an unrecognised head must be reported as unrecognised, not
 * silently accepted as whatever was declared.
 */
export function detectFileType(head: Uint8Array): DetectedType | null {
	for (const signature of SIGNATURES) {
		if (matches(head, signature))
			return { ext: signature.ext, mime: signature.mime };
	}
	return null;
}

/** Read the leading bytes of a file. */
export async function readHead(
	path: string,
	length = MAGIC_HEAD_BYTES,
): Promise<Uint8Array> {
	const handle = await open(path, "r");
	try {
		const buffer = new Uint8Array(length);
		const { bytesRead } = await handle.read(buffer, 0, length, 0);
		return buffer.subarray(0, bytesRead);
	} finally {
		await handle.close();
	}
}

/** Extensions that a given detected type legitimately covers. */
const ALIASES: Record<string, readonly string[]> = {
	jpg: ["jpg", "jpeg"],
	tif: ["tif", "tiff"],
	// A zip container is what an Office document actually is on the wire.
	zip: ["zip", "docx", "xlsx", "pptx", "odt", "ods", "odp", "epub", "jar"],
	mp4: ["mp4", "m4v", "m4a", "mov"],
};

/** Is `declared` an acceptable spelling of `detected`? */
export function extensionMatches(detected: string, declared: string): boolean {
	const normalized = declared.replace(/^\./, "").toLowerCase();
	return (ALIASES[detected] ?? [detected]).includes(normalized);
}
