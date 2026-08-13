import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { rules, schema } from "../../src/index.js";

/**
 * Content-based type checking (Adonis parity). The declarative checks — size,
 * extension, reported MIME — all come from the uploader, so a `.exe` renamed
 * `.jpg` passes every one of them. Only the bytes settle it.
 */
const PNG_HEAD = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
]);
const EXE_HEAD = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0, 0, 0]);
const PDF_HEAD = new Uint8Array([
	0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37,
]);

let dir: string;
let pngPath: string;
let exePath: string;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "rune-magic-"));
	pngPath = join(dir, "real.png");
	exePath = join(dir, "payload.png"); // an .exe wearing a .png name
	await writeFile(pngPath, PNG_HEAD);
	await writeFile(exePath, EXE_HEAD);
});

describe("rune > verifyContent (magic number)", () => {
	it("accepts a file whose bytes match its declared extension", async () => {
		const s = schema({
			avatar: rules.file({ extnames: ["png", "jpg"] }).verifyContent(),
		});
		const res = await s.validateResultAsync({
			avatar: { size: 12, extname: "png", tmpPath: pngPath },
		});
		expect(res.valid).toBe(true);
	});

	it("REFUSES an executable renamed as an image", async () => {
		const s = schema({
			avatar: rules.file({ extnames: ["png", "jpg"] }).verifyContent(),
		});
		// Opting OUT leaves only declarative checks — size ok, extname "png",
		// allowed list ok — so the renamed executable passes. That is exactly why
		// the check is ON by default.
		const optedOut = schema({
			avatar: rules.file({ extnames: ["png"], verifyContent: false }),
		});
		expect(
			optedOut.validateResult({
				avatar: { size: 8, extname: "png", tmpPath: exePath },
			}).valid,
		).toBe(true);

		// With the default, the bytes decide.
		const res = await s.validateResultAsync({
			avatar: { size: 8, extname: "png", tmpPath: exePath },
		});
		expect(res.valid).toBe(false);
		expect(res.errors[0]?.rule).toBe("verifyContent");
		expect(res.errors[0]?.message).toMatch(/Content is exe/);
	});

	it("works from an in-memory buffer too", async () => {
		// `extnames` compares against the DECLARED name, so the object must carry
		// one; verifyContent then confronts that declaration with the bytes.
		const s = schema({
			doc: rules.file({ extnames: ["pdf"] }).verifyContent(),
		});
		expect(
			(
				await s.validateResultAsync({
					doc: { size: 8, extname: "pdf", buffer: PDF_HEAD },
				})
			).valid,
		).toBe(true);
		expect(
			(
				await s.validateResultAsync({
					doc: { size: 8, extname: "pdf", buffer: EXE_HEAD },
				})
			).valid,
		).toBe(false);
	});

	it("FAILS when no byte source is reachable — never passes by default", async () => {
		const s = schema({ doc: rules.file().verifyContent() });
		const res = await s.validateResultAsync({
			doc: { size: 8, extname: "png" },
		});
		expect(res.valid).toBe(false);
		expect(res.errors[0]?.message).toMatch(/Cannot read/);
	});

	it("reports an unrecognised head instead of trusting the declaration", async () => {
		const s = schema({ doc: rules.file().verifyContent() });
		const res = await s.validateResultAsync({
			doc: { size: 4, extname: "png", buffer: new Uint8Array([1, 2, 3, 4]) },
		});
		expect(res.valid).toBe(false);
		expect(res.errors[0]?.message).toMatch(/could not be recognised/);
	});

	it("accepts the legitimate aliases of a detected type", async () => {
		const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
		const s = schema({ p: rules.file({ extnames: ["jpeg"] }).verifyContent() });
		expect(
			(
				await s.validateResultAsync({
					p: { size: 4, extname: "jpeg", buffer: jpeg },
				})
			).valid,
		).toBe(true);
	});

	it("checks the reported MIME against the bytes", async () => {
		const s = schema({
			doc: rules.nativeFile().mimeTypes(["application/pdf"]).verifyContent(),
		});
		expect(
			(
				await s.validateResultAsync({
					doc: { size: 8, type: "application/pdf", buffer: PDF_HEAD },
				})
			).valid,
		).toBe(true);
		// Claims PDF, is a PNG.
		const lying = await s.validateResultAsync({
			doc: { size: 12, type: "application/pdf", buffer: PNG_HEAD },
		});
		expect(lying.valid).toBe(false);
		expect(lying.errors[0]?.rule).toBe("verifyContent");
	});
});

describe("rune > la vérification de contenu est le DÉFAUT", () => {
	it("file({ extnames }) refuse un exécutable renommé, sans rien ajouter", async () => {
		// Parité Adonis : là-bas `extname` est dérivé des octets par le bodyparser
		// AVANT la validation, donc un validateur transcrit tel quel est sûr.
		const s = schema({ avatar: rules.file({ extnames: ["png"] }) });
		const res = await s.validateResultAsync({
			avatar: { size: 8, extname: "png", tmpPath: exePath },
		});
		expect(res.valid).toBe(false);
		expect(res.errors[0]?.rule).toBe("verifyContent");
	});

	it("le chemin synchrone REFUSE de tourner plutôt que de sauter le contrôle", () => {
		const s = schema({ avatar: rules.file({ extnames: ["png"] }) });
		expect(() =>
			s.validateResult({
				avatar: { size: 8, extname: "png", tmpPath: exePath },
			}),
		).toThrow(/validateResultAsync/);
	});

	it("mimeTypes() active aussi le contrôle", async () => {
		const s = schema({ doc: rules.nativeFile().mimeTypes(["image/png"]) });
		const res = await s.validateResultAsync({
			doc: { size: 8, type: "image/png", tmpPath: exePath },
		});
		expect(res.valid).toBe(false);
	});

	it("sans extnames ni mimeTypes, file() reste déclaratif", () => {
		// Rien n'a été déclaré sur le type, donc il n'y a pas de contrat de type à
		// confronter aux octets : le contrôle ne s'impose pas.
		const s = schema({ doc: rules.file({ size: "1mb" }) });
		expect(s.validateResult({ doc: { size: 10 } }).valid).toBe(true);
	});

	it("l'opt-out est explicite et laisse une trace dans le schéma", () => {
		const s = schema({
			avatar: rules.file({ extnames: ["png"], verifyContent: false }),
		});
		expect(
			s.validateResult({
				avatar: { size: 8, extname: "png", tmpPath: exePath },
			}).valid,
		).toBe(true);
	});
});
