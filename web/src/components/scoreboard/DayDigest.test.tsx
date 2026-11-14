/**
 * S71: "Best of <date> — Highlights" under the scoreboard's games. The digest is
 * `dayDigest` over the committed 2024-07-04 games (744834 NYM @ WSH with three clips,
 * 745001 NYY @ BOS with one), served as the API would; the schedule is that day's.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup, render, screen, waitFor, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	MemoryRouter, Route, Routes,
} from "react-router-dom";
import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import type { DigestGame } from "@bt/domain";
import { DEFAULT_SETTINGS, dayDigest } from "@bt/domain";
import type { DayDigestPayload } from "../../api/digest.js";
import { createQueryClient } from "../../api/queryClient.js";
import type { ScheduleDayPayload } from "../../api/schedule.js";
import type { LayoutVariant } from "../../layout/variant.js";
import { ScoreboardPage } from "../../pages/ScoreboardPage.js";
import { hydrateSettings, resetSettings } from "../../settings/store.js";
import { jsonResponse } from "../../test/jsonResponse.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures");

function read<T>(name: string): T
{
	return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;
}

const SCHEDULE: ScheduleDayPayload = {
	...read<ScheduleDayPayload>("schedule-2024-07-04.json"),
	fetchedAt: "2024-07-04T23:00:00.000Z",
	windowMode: "cache",
	version: 1,
	lastChangedAt: "2024-07-04T23:00:00.000Z",
};

const DIGEST: DayDigestPayload = {
	date: "2024-07-04",
	items: dayDigest([read<DigestGame>("game-744834.json"), read<DigestGame>("game-745001.json")]),
};

/** Answers the schedule and the digest; the dev account's settings when asked. */
function serve(settings = DEFAULT_SETTINGS): void
{
	vi.stubGlobal("fetch", vi.fn((request: Request) =>
	{
		const { pathname } = new URL(request.url);
		if (pathname === "/api/v1/digest") return Promise.resolve(jsonResponse(DIGEST));
		if (pathname === "/api/v1/me/settings") return Promise.resolve(jsonResponse(settings));
		return Promise.resolve(jsonResponse(SCHEDULE));
	}));
}

async function renderScoreboard(variant: LayoutVariant = "mobile"): Promise<HTMLElement>
{
	render(
		<MantineProvider>
			<QueryClientProvider client={createQueryClient()}>
				<MemoryRouter initialEntries={["/games/2024-07-04"]}>
					<Routes>
						<Route path="/games/:date" element={<ScoreboardPage variant={variant} />} />
						<Route path="/game/:gamePk" element={<p>game page</p>} />
					</Routes>
				</MemoryRouter>
			</QueryClientProvider>
		</MantineProvider>,
	);
	return screen.findByTestId("day-digest");
}

/** Each digest row's text, top to bottom. */
function rows(digest: HTMLElement): string[]
{
	return within(digest).getAllByTestId("digest-item").map((row) => row.textContent ?? "");
}

// Each test starts with the full digest served (the hidden one re-serves with Hide Scores on).
beforeEach(() => serve());

afterEach(() =>
{
	cleanup();
	resetSettings();
	vi.unstubAllGlobals();
});

/** Each digest column's ranks, top to bottom, left column first. */
function columnRanks(digest: HTMLElement): string[][]
{
	return within(digest).getAllByTestId("digest-column").map((column) => within(column).queryAllByTestId("digest-rank").map((rank) => rank.textContent ?? ""));
}

/** Serves a digest of the first `n` clips (the fixture's four, plus a fifth copied from the fourth). */
function serveDigest(n: number): void
{
	const fifth = {
		...DIGEST.items[3]!,
		rank: 5,
		watchFirst: false,
		highlight: {
			...DIGEST.items[3]!.highlight,
			id: "fifth",
		},
	};
	const items = [...DIGEST.items, fifth].slice(0, n);
	vi.stubGlobal("fetch", vi.fn((request: Request) =>
	{
		const { pathname } = new URL(request.url);
		if (pathname === "/api/v1/digest") return Promise.resolve(jsonResponse({
			...DIGEST,
			items,
		}));
		if (pathname === "/api/v1/me/settings") return Promise.resolve(jsonResponse(DEFAULT_SETTINGS));
		return Promise.resolve(jsonResponse(SCHEDULE));
	}));
}

describe("the day digest (S71)", () =>
{
	it("two columns rank down the left, then the right: five clips read 1–3 then 4–5; one clip sits alone at the top of the left column", async () =>
	{
		serveDigest(5);
		expect(columnRanks(await renderScoreboard("desktop"))).toEqual([["1", "2", "3"], ["4", "5"]]);
		cleanup();
		serveDigest(1);
		expect(columnRanks(await renderScoreboard("desktop"))).toEqual([["1"], []]);
	});

	it("digest: Best of Jul 4, then rank, still, title and duration per clip, and one WATCH FIRST on the top one", async () =>
	{
		const digest = await renderScoreboard();
		expect(within(digest).getByText("Best of Jul 4 — Highlights")).toBeInTheDocument();
		const items = within(digest).getAllByTestId("digest-item");
		expect(items).toHaveLength(4);
		expect(items.map((row) => within(row).getByTestId("digest-rank").textContent)).toEqual(["1", "2", "3", "4"]);
		// The two home runs lead (the impact rule), the walk-off first by id.
		expect(within(items[0]!).getByText("Lane Thomas hits a walk-off home run")).toBeInTheDocument();
		expect(within(items[1]!).getByText("Judge hammers a two-run home run")).toBeInTheDocument();
		expect(within(items[0]!).getByTestId("digest-duration")).toHaveTextContent("0:42");
		for (const row of items) expect(row.querySelector("[style*='aspect-ratio']")).not.toBeNull();
		const watchFirst = within(digest).getAllByTestId("watch-first");
		expect(watchFirst).toHaveLength(1);
		expect(items[0]).toContainElement(watchFirst[0]!);
		expect(watchFirst[0]).toHaveTextContent(/watch first/i);
	});

	it("plays: choosing a clip opens the player dialog with its game link; Close returns to the scoreboard", async () =>
	{
		const user = userEvent.setup();
		const digest = await renderScoreboard();
		await user.click(within(digest).getByRole("button", {
			name: "Play Judge hammers a two-run home run",
		}));
		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByTestId("video-player")).toBeInTheDocument();
		const link = within(dialog).getByRole("link", {
			name: "Go to game: NYY @ BOS, Jul 4 →",
		});
		expect(link).toHaveAttribute("href", "/game/745001");
		await user.click(within(dialog).getByRole("button", {
			name: "Close video",
		}));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(screen.getByTestId("day-digest")).toBeInTheDocument();
	});

	it("mobile: one column; no row carries the old gold ground (owner, 2026-11-12: \"Let's remove that for now\")", async () =>
	{
		const digest = await renderScoreboard();
		expect(within(digest).getAllByTestId("digest-column")).toHaveLength(1);
		for (const row of within(digest).getAllByTestId("digest-item"))
		{
			expect(row.getAttribute("style")).not.toMatch(/gold|gradient/);
			expect(row).toHaveClass("bt-card", "bt-zoom-host");
		}
	});

	it("hidden: with Hide Scores on, the digest renders the same, titles as MLB writes them", async () =>
	{
		const shown = rows(await renderScoreboard());
		cleanup();

		serve({
			...DEFAULT_SETTINGS,
			hideScores: true,
			version: 1,
		});
		await hydrateSettings("test-user");
		const hidden = await renderScoreboard();
		expect(rows(hidden)).toEqual(shown);
		expect(within(hidden).getByText("Judge hammers a two-run home run")).toBeInTheDocument();
		expect(within(hidden).getAllByTestId("watch-first")).toHaveLength(1);
	});

	it("a clip MLB gives no duration shows its title alone", async () =>
	{
		const [top, ...rest] = DIGEST.items;
		vi.stubGlobal("fetch", vi.fn((request: Request) => Promise.resolve(jsonResponse(new URL(request.url).pathname === "/api/v1/digest" ? {
			...DIGEST,
			items: [{
				...top!,
				highlight: {
					...top!.highlight,
					duration: null,
				},
			}, ...rest],
		} : SCHEDULE))));
		const digest = await renderScoreboard();
		const [first] = within(digest).getAllByTestId("digest-item");
		expect(within(first!).queryByTestId("digest-duration")).toBeNull();
		expect(within(first!).getByTestId("watch-first")).toBeInTheDocument();
	});

	it("at medium the clips sit in two columns, ranked down the first then the second; a day with no clips shows no digest", async () =>
	{
		const digest = await renderScoreboard("medium");
		expect(within(digest).getAllByTestId("digest-item")).toHaveLength(4);
		// Owner, 2026-11-12: "those 5 are sorted LR then TB should be TB then LR".
		expect(columnRanks(digest)).toEqual([["1", "2"], ["3", "4"]]);
		cleanup();

		vi.stubGlobal("fetch", vi.fn((request: Request) => Promise.resolve(jsonResponse(new URL(request.url).pathname === "/api/v1/digest" ? {
			date: "2024-07-04",
			items: [],
		} : SCHEDULE))));
		render(
			<MantineProvider>
				<QueryClientProvider client={createQueryClient()}>
					<MemoryRouter initialEntries={["/games/2024-07-04"]}>
						<Routes>
							<Route path="/games/:date" element={<ScoreboardPage variant="mobile" />} />
						</Routes>
					</MemoryRouter>
				</QueryClientProvider>
			</MantineProvider>,
		);
		await screen.findAllByTestId("scoreboard-module");
		expect(screen.queryByTestId("day-digest")).toBeNull();
	});
});
