import {
	describe, expect, it,
} from "vitest";
import {
	adoptAcrossStores, applyIfNewer, compareAcrossStores, INGEST_OWNS_MS, stampVersion,
} from "./versioning.js";
import { DEFAULT_CADENCE } from "./window.js";

type State = {
	version: number;
	label: string;
};

const SEQUENCE: State[] = [
	{
		version: 1,
		label: "first pitch",
	},
	{
		version: 2,
		label: "single",
	},
	{
		version: 3,
		label: "home run",
	},
	{
		version: 4,
		label: "strikeout",
	},
	{
		version: 5,
		label: "final",
	},
];

/** Fold updates in arrival order, the way every consumer applies them. */
function fold(updates: State[]): State | null
{
	return updates.reduce<State | null>((held, next) => applyIfNewer(held, next), null);
}

describe("applyIfNewer", () =>
{
	it("takes the incoming state when nothing is held yet (current is null)", () =>
	{
		const first = SEQUENCE[0]!;
		expect(applyIfNewer(null, first)).toBe(first);
	});

	it("takes a strictly newer version and keeps the held one otherwise", () =>
	{
		const [v1, v2] = SEQUENCE as [State, State];
		expect(applyIfNewer(v1, v2)).toBe(v2);
		expect(applyIfNewer(v2, v1)).toBe(v2);
	});

	it("keeps the held state on a tie, so re-delivery changes nothing", () =>
	{
		const held = {
			version: 3,
			label: "held",
		};
		const resent = {
			version: 3,
			label: "resent",
		};
		expect(applyIfNewer(held, resent)).toBe(held);
	});

	it("ends on the highest version when every update is duplicated", () =>
	{
		const duplicated = SEQUENCE.flatMap((s) => [s, s]);
		expect(fold(duplicated)).toEqual(SEQUENCE[4]);
	});

	// Index orders into SEQUENCE, each a different arrival shuffle.
	const shuffles: number[][] = [
		[4, 3, 2, 1, 0],
		[2, 0, 4, 1, 3],
		[1, 3, 0, 4, 2],
		[3, 4, 0, 2, 1],
	];

	it.each(shuffles)("ends on the highest version for shuffled order %j, duplicated", (...order: number[]) =>
	{
		const shuffled = order.map((i) => SEQUENCE[i]!);
		expect(fold([...shuffled, ...[...shuffled].reverse()])).toEqual(SEQUENCE[4]);
	});
});

describe("stampVersion", () =>
{
	type Doc = { id: number;
		score: number;
		fetchedAt: string;
		version: number;
		lastChangedAt: string; };

	const stored: Doc = {
		id: 1,
		score: 2,
		fetchedAt: "2024-07-04T18:00:00.000Z",
		version: 4,
		lastChangedAt: "2024-07-04T17:00:00.000Z",
	};

	it("starts a new state at version 1, changed now", () =>
	{
		expect(stampVersion<Doc>(null, {
			id: 1,
			score: 0,
			fetchedAt: "t0",
		}, "t0")).toEqual({
			id: 1,
			score: 0,
			fetchedAt: "t0",
			version: 1,
			lastChangedAt: "t0",
		});
	});

	it("keeps the version and lastChangedAt when only the poll time differs", () =>
	{
		const polled = stampVersion<Doc>(stored, {
			id: 1,
			score: 2,
			fetchedAt: "2024-07-04T18:05:00.000Z",
		}, "2024-07-04T18:05:00.000Z");
		expect(polled.version).toBe(4);
		expect(polled.lastChangedAt).toBe(stored.lastChangedAt);
	});

	it("bumps the version and lastChangedAt when the content changes", () =>
	{
		const changed = stampVersion<Doc>(stored, {
			id: 1,
			score: 3,
			fetchedAt: "2024-07-04T18:05:00.000Z",
		}, "2024-07-04T18:05:00.000Z");
		expect(changed.version).toBe(5);
		expect(changed.lastChangedAt).toBe("2024-07-04T18:05:00.000Z");
	});
});

describe("compareAcrossStores / adoptAcrossStores (the baseball-data copy)", () =>
{
	type Doc = {
		id: number;
		score: number;
		fetchedAt: string;
		windowMode: "active" | "cache";
		version: number;
		lastChangedAt: string;
	};
	const NOW = new Date("2026-11-13T12:00:00.000Z");
	const staging: Doc = {
		id: 777,
		score: 3,
		fetchedAt: "2026-07-01T20:00:00.000Z",
		windowMode: "active",
		version: 40,
		lastChangedAt: "2026-07-01T20:00:00.000Z",
	};
	const production: Doc = {
		id: 777,
		score: 5,
		fetchedAt: "2026-07-02T03:00:00.000Z",
		windowMode: "cache",
		version: 1,
		lastChangedAt: "2026-07-02T03:00:00.000Z",
	};

	it("takes a state nothing is stored for as it is, with its own version", () =>
	{
		expect(compareAcrossStores(null, production, NOW)).toBe("new");
		expect(adoptAcrossStores(null, production, NOW)).toEqual({
			outcome: "new",
			state: production,
		});
	});

	it("adopts a state that changed later, at the stored version + 1, never by comparing versions", () =>
	{
		expect(compareAcrossStores(staging, production, NOW)).toBe("later");
		expect(adoptAcrossStores(staging, production, NOW)).toEqual({
			outcome: "later",
			state: {
				...production,
				version: 41,
			},
		});
	});

	it("keeps the stored state when the other changed earlier, even at a higher version", () =>
	{
		const older = {
			...staging,
			lastChangedAt: "2026-07-01T19:00:00.000Z",
			version: 90,
		};
		expect(compareAcrossStores(production, older, NOW)).toBe("notLater");
		expect(adoptAcrossStores(production, older, NOW)).toEqual({
			outcome: "notLater",
			state: null,
		});
	});

	it("keeps the stored state on a tie, even with different content", () =>
	{
		expect(adoptAcrossStores(staging, {
			...production,
			lastChangedAt: staging.lastChangedAt,
		}, NOW).outcome).toBe("notLater");
	});

	it("writes nothing for the same content, whatever the versions and times", () =>
	{
		expect(adoptAcrossStores({
			...production,
			version: 1,
			lastChangedAt: "2026-07-01T00:00:00.000Z",
			fetchedAt: "2026-07-01T00:00:00.000Z",
		}, {
			...production,
			version: 40,
		}, NOW)).toEqual({
			outcome: "same",
			state: null,
		});
	});

	it("keeps the stored state when either change time can't be read", () =>
	{
		expect(compareAcrossStores({
			...staging,
			lastChangedAt: "not a time",
		}, production, NOW)).toBe("unreadable");
		expect(adoptAcrossStores(staging, {
			...production,
			lastChangedAt: "",
		}, NOW).outcome).toBe("unreadable");
	});

	it("leaves a state its own ingest may still be writing: in its active window and changed within the trail", () =>
	{
		const live = {
			...staging,
			lastChangedAt: "2026-11-13T11:00:00.000Z",
		};
		expect(compareAcrossStores(live, {
			...production,
			lastChangedAt: "2026-11-13T11:30:00.000Z",
		}, NOW)).toBe("ingesting");
		// A game left active months ago, stuck mid-game, is no longer anyone's: it is adopted.
		expect(compareAcrossStores(staging, production, NOW)).toBe("later");
		// A cache-window state changed a minute ago is adopted too: nothing polls it.
		expect(compareAcrossStores({
			...live,
			windowMode: "cache",
		}, {
			...production,
			lastChangedAt: "2026-11-13T11:30:00.000Z",
		}, NOW)).toBe("later");
	});

	it("gives the target's ingest an hour past the trail: just inside is ingesting, just past is adopted", () =>
	{
		expect(INGEST_OWNS_MS).toBe((DEFAULT_CADENCE.trailHours + 1) * 60 * 60 * 1000);
		const at = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
		const incoming = {
			...production,
			lastChangedAt: NOW.toISOString(),
		};
		expect(compareAcrossStores({
			...staging,
			lastChangedAt: at(INGEST_OWNS_MS - 1000),
		}, incoming, NOW)).toBe("ingesting");
		expect(compareAcrossStores({
			...staging,
			lastChangedAt: at(INGEST_OWNS_MS + 1000),
		}, incoming, NOW)).toBe("later");
	});
});
