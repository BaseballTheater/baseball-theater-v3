/**
 * The hover feedback and player sizing in `styles.css` (owner, 2026-11-12: "quick animated hover
 * effects, like 0.25-0.5s with a snappy Bézier curve. Use the material design Bézier curve" and
 * "Anything that is clickable needs at least a basic hover effect"). jsdom applies no stylesheet
 * and no hover, so the stylesheet is parsed (postcss) and its rules checked against each other:
 * hovers only where a pointer hovers, every hovered property animated, every animation and
 * movement cancelled under reduced motion, and keyboard focus given the same colours.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import type { AtRule, Rule } from "postcss";
import {
	describe, expect, it,
} from "vitest";

const ROOT = postcss.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "styles.css"), "utf8"));

/** Every rule, with the `@media` query it sits in ("" for none). */
function allRules(): { rule: Rule;
	media: string; }[]
{
	const found: { rule: Rule;
		media: string; }[] = [];
	ROOT.walkRules((rule) =>
	{
		const parent = rule.parent;
		const media = parent?.type === "atrule" && (parent as AtRule).name === "media" ? (parent as AtRule).params : "";
		found.push({
			rule,
			media,
		});
	});
	return found;
}

/** The rules inside `@media <params>`. */
function rulesIn(params: string): Rule[]
{
	const rules: Rule[] = [];
	ROOT.walkAtRules("media", (atRule) =>
	{
		if (atRule.params !== params) return;
		atRule.walkRules((rule) =>
		{
			rules.push(rule);
		});
	});
	return rules;
}

/** One declaration's value in a rule, or undefined. */
function decl(rule: Rule, prop: string): string | undefined
{
	let value: string | undefined;
	rule.walkDecls(prop, (declaration) =>
	{
		value = declaration.value;
	});
	return value;
}

/**
 * What a hover selector moves, as reduced motion may name it: with `:hover` stripped
 * (`.bt-pitch-dot:hover circle` → `.bt-pitch-dot circle`), or with the hovered ancestor dropped
 * (`.bt-zoom-host:hover .bt-zoom img` → `.bt-zoom img`).
 */
function subjects(selector: string): string[]
{
	const parts = selector.trim().split(/\s+/);
	const last = parts.pop()!.replace(/:hover/g, "");
	return [
		[...parts.map((part) => part.replace(/:hover/g, "")), last].join(" "),
		[...parts.filter((part) => !part.includes(":hover")), last].join(" "),
	];
}

const HOVER = "(hover: hover)";
const REDUCED = "(prefers-reduced-motion: reduce)";
const hoverRules = rulesIn(HOVER);
const reducedRules = rulesIn(REDUCED);

/** The base rule that sets `transition-property` (outside any `@media`). */
const transitionRule = allRules().find(({ rule, media }) => media === "" && decl(rule, "transition-property"))!.rule;

describe("hover feedback", () =>
{
	it("parses: the hover block, the reduced-motion block and the transition rule are all found", () =>
	{
		expect(hoverRules.length).toBeGreaterThanOrEqual(10);
		expect(reducedRules.length).toBeGreaterThanOrEqual(2);
		expect(transitionRule.selectors.length).toBeGreaterThanOrEqual(10);
	});

	it("uses Material's standard curve, and durations inside 0.25–0.5s", () =>
	{
		const vars = new Map<string, string>();
		ROOT.walkDecls(/^--bt-(ease|hover-ms|zoom-ms)$/, (declaration) =>
		{
			vars.set(declaration.prop, declaration.value);
		});
		expect(vars.get("--bt-ease")).toBe("cubic-bezier(0.4, 0, 0.2, 1)");
		for (const name of ["--bt-hover-ms", "--bt-zoom-ms"])
		{
			const seconds = Number(/^([\d.]+)s$/.exec(vars.get(name) ?? "")?.[1]);
			expect(seconds, name).toBeGreaterThanOrEqual(0.25);
			expect(seconds, name).toBeLessThanOrEqual(0.5);
		}
		expect(decl(transitionRule, "transition-timing-function")).toBe("var(--bt-ease)");
		expect(decl(transitionRule, "transition-duration")).toBe("var(--bt-hover-ms)");
	});

	it("every :hover rule sits inside (hover: hover), so a tap never leaves a hover stuck on", () =>
	{
		const hovers = allRules().filter(({ rule }) => rule.selectors.some((selector) => selector.includes(":hover")));
		expect(hovers.length).toBeGreaterThanOrEqual(10);
		for (const { rule, media } of hovers) expect(media, rule.selector).toBe(HOVER);
	});

	it("every property a hover changes is one the transition animates", () =>
	{
		const animated = new Set(decl(transitionRule, "transition-property")!.split(/,\s*/));
		// The lifted card's hover strip is layout for hit-testing, not a look that changes.
		const layout = new Set(["content", "position", "left", "right", "bottom", "height"]);
		let checked = 0;
		for (const rule of hoverRules)
		{
			rule.walkDecls((declaration) =>
			{
				if (layout.has(declaration.prop)) return;
				checked++;
				expect(animated.has(declaration.prop), `${rule.selector} { ${declaration.prop} }`).toBe(true);
			});
		}
		expect(checked).toBeGreaterThanOrEqual(10);
	});

	it("reduced motion turns off exactly the transitions the hover rules use", () =>
	{
		const off = reducedRules.find((rule) => decl(rule, "transition") === "none");
		expect(off).toBeDefined();
		expect([...off!.selectors].sort()).toEqual([...transitionRule.selectors].sort());
	});

	it("every hover movement (a lift, a zoom, a grow) is cancelled under reduced motion", () =>
	{
		const still = new Set(reducedRules.filter((rule) => decl(rule, "transform")?.startsWith("none")).flatMap((rule) => rule.selectors));
		const moving = hoverRules.filter((rule) => decl(rule, "transform"));
		expect(moving.length).toBeGreaterThanOrEqual(3);
		for (const rule of moving)
		{
			for (const selector of rule.selectors) expect(subjects(selector).some((name) => still.has(name)), selector).toBe(true);
		}
	});

	it("a card that lifts keeps a strip under it, so the pointer on its bottom edge doesn't flicker", () =>
	{
		const lift = hoverRules.find((rule) => rule.selector === ".bt-card:hover");
		expect(decl(lift!, "transform")).toBe("translateY(-2px)");
		const strip = hoverRules.find((rule) => rule.selector === ".bt-card:hover::before");
		expect(strip).toBeDefined();
		expect(decl(strip!, "bottom")).toBe("-2px");
		expect(decl(strip!, "height")).toBe("2px");
		expect(decl(strip!, "position")).toBe("absolute");
	});

	it("keyboard focus gets the hover colours: a focused card (itself, or a control inside it), and every washed control", () =>
	{
		const focus = allRules().filter(({ rule, media }) => media === "" && rule.selectors.some((selector) => selector.includes(":focus-visible"))).map(({ rule }) => rule);
		const focusSelectors = new Set(focus.flatMap((rule) => rule.selectors));
		expect(focusSelectors.has(".bt-card:focus-visible")).toBe(true);
		expect(focusSelectors.has(".bt-card:has(:focus-visible)")).toBe(true);
		const washed = hoverRules.filter((rule) => decl(rule, "background-color")?.includes("--bt-hover-wash"));
		expect(washed.length).toBeGreaterThanOrEqual(4);
		for (const rule of washed)
		{
			for (const selector of rule.selectors)
			{
				// A list option is chosen with the arrow keys, which Mantine marks itself.
				if (/option/.test(selector)) continue;
				const base = selector.replace(/:not\(:disabled\):not\(\[data-disabled\]\)/, "").replace(/:hover$/, "");
				expect(focusSelectors.has(`${base}:focus-visible`), selector).toBe(true);
			}
		}
	});
});

describe("text fields", () =>
{
	it("a field being typed in keeps its focus border on hover, MultiSelect's box (a div holding the focused input) included", () =>
	{
		const selectors = hoverRules.flatMap((rule) => rule.selectors).filter((selector) => selector.includes(".mantine-Input-input"));
		expect(selectors).toHaveLength(1);
		expect(selectors[0]).toContain(":not(:focus)");
		expect(selectors[0]).toContain(":not(:focus-within)");
	});
});

describe("the dialog player's frame", () =>
{
	it("grows to 1280px held to the screen's height, but never below the old 560px (or the screen's width)", () =>
	{
		let width = "";
		ROOT.walkRules(".bt-player-frame", (rule) =>
		{
			width = decl(rule, "width") ?? "";
		});
		expect(width).toMatch(/^max\(min\(100%, 560px\), min\(100%, 1280px, calc\(\(100dvh - \d+px\) \* 16 \/ 9\)\)\)$/);
	});
});
