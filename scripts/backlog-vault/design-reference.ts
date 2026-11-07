/**
 * The ratified reference a design capture is judged against (backlog rule 22): the one
 * implementation behind both `pnpm design:review` (e2e/design-review.ts, which lays the pair out
 * for the owner) and `scripts/audit.sh … --design-match` (which records the pair in the ledger),
 * so the ledger names exactly what the owner was shown (ADR-025: one implementation per rule).
 *
 * A ratified amendment frame (docs/v3/visual/<surface>/amendments/<frame>.png) wins over the
 * original frame of the same name, since it is what the build is matched against. A written
 * amendment (its "## Frames" section says "None") that overrides a frame wins too, and since it
 * has no picture the amendment file itself is the reference: an older frame it supersedes is never
 * paired with a capture (S73: the old under-the-header banner frames, shown beside captures after
 * A6 moved the notice to the bottom, made a stale build look right; S28's ledger row named the
 * same superseded frames).
 *
 *   node scripts/backlog-vault/design-reference.ts <visual dir> <capture name>.png
 *
 * prints the governing reference(s), one path per line: the written amendment alone, else every
 * candidate frame (amendment frames if any, else originals) so a caller can refuse an ambiguous name.
 */

import {
	existsSync, readdirSync, readFileSync,
} from "node:fs";
import { join } from "node:path";

/** A capture's reference: a drawn frame, or the written amendment that governs its name. */
export interface DesignReference
{
	kind: "frame" | "amendment";
	path: string;
}

/** The surface folders under the visual dir (docs/v3/visual/<surface>/). */
function surfaces(visualDir: string): string[]
{
	return readdirSync(visualDir, {
		withFileTypes: true,
	}).filter((d) => d.isDirectory()).map((d) => join(visualDir, d.name)).sort();
}

/**
 * Every ratified frame named like the capture: the amendment frames of that name if any surface
 * has one, else the original frames. More than one means the name is ambiguous across surfaces.
 */
export function ratifiedFrames(visualDir: string, name: string): string[]
{
	const dirs = surfaces(visualDir);
	const amended = dirs.map((s) => join(s, "amendments", name)).filter((p) => existsSync(p));
	return amended.length > 0 ? amended : dirs.map((s) => join(s, name)).filter((p) => existsSync(p));
}

/**
 * The ratified written amendment that governs a frame, if one does: the highest-numbered
 * amendment of any surface whose text names the frame, where that amendment is written (no
 * drawn frames) and names it on its **Overrides:** line. Names there are backticked: whole
 * (`shell-notice-mobile`), a suffix shorthand for the name before it (`-medium`), or a glob
 * (`settings-*`). A later amendment that draws the frame (`<name>.png` in its text) governs instead.
 */
export function writtenAmendment(visualDir: string, name: string): { path: string;
	text: string; } | null
{
	const frame = name.replace(/\.png$/, "");
	let best: { n: number;
		path: string;
		text: string;
		written: boolean; } | null = null;
	for (const surface of surfaces(visualDir))
	{
		const dir = join(surface, "amendments");
		if (!existsSync(dir)) continue;
		for (const file of readdirSync(dir).filter((f) => /^A\d+\.md$/.test(f)))
		{
			const path = join(dir, file);
			const text = readFileSync(path, "utf8");
			const n = Number(file.slice(1, -3));
			const written = /^## Frames\s+None\b/m.test(text);
			const overrides = written ? overriddenNames(text) : [];
			const covers = text.includes(`${frame}.png`) || overrides.some((o) => (o.endsWith("*") ? frame.startsWith(o.slice(0, -1)) : o === frame));
			if (covers && (!best || n > best.n)) best = {
				n,
				path,
				text,
				written,
			};
		}
	}
	return best?.written ? {
		path: best.path,
		text: best.text,
	} : null;
}

/** The frame names on an amendment's **Overrides:** line, with `-medium`-style shorthands expanded. */
export function overriddenNames(text: string): string[]
{
	const line = /^\*\*Overrides:\*\*(.*)$/m.exec(text)?.[1] ?? "";
	const names: string[] = [];
	for (const [, token] of line.matchAll(/`([a-z0-9*-]+)`/g))
	{
		const previous = names.at(-1);
		names.push(token!.startsWith("-") && previous ? previous.replace(/-[a-z0-9]+$/, token!) : token!);
	}
	return names;
}

/** Every reference that could govern the capture: the written amendment alone, else the candidate frames. */
export function designReferences(visualDir: string, name: string): DesignReference[]
{
	const amendment = writtenAmendment(visualDir, name);
	if (amendment) return [{
		kind: "amendment",
		path: amendment.path,
	}];
	return ratifiedFrames(visualDir, name).map((path) => ({
		kind: "frame",
		path,
	}));
}

if (import.meta.main)
{
	const [visualDir, name] = process.argv.slice(2);
	if (!visualDir || !name)
	{
		console.error("usage: node scripts/backlog-vault/design-reference.ts <visual dir> <capture name>.png");
		process.exit(2);
	}
	for (const ref of designReferences(visualDir, name)) console.log(ref.path);
}
