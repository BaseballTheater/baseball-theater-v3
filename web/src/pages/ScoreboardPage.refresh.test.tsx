/**
 * S20: the scoreboard keeps an in-window day current on its own. The day is
 * `schedule-823823-moments.json`'s in-progress CHC @ MIA (1–0, Top 3rd), served as
 * `active`; the schedule hook re-asks BT's `/api/v1/schedule` every `LIVE_REFRESH_MS`
 * while the tab is visible, and asks nothing while it is hidden.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	act, cleanup, render, screen,
} from "@testing-library/react";
import {
	MemoryRouter, Route, Routes,
} from "react-router-dom";
import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import { LIVE_REFRESH_MS } from "../api/freshness.js";
import { createQueryClient } from "../api/queryClient.js";
import type { ScheduleDayPayload } from "../api/schedule.js";
import { jsonResponse } from "../test/jsonResponse.js";
import { ScoreboardPage } from "./ScoreboardPage.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures");

type Game = ScheduleDayPayload["games"][number];

/** 2026-09-05 with the in-progress CHC @ MIA alone, its runs set to `away`–`home`, as `version`. */
function day(away: number, home: number, version: number): ScheduleDayPayload
{
	const schedule = JSON.parse(readFileSync(join(FIXTURES, "schedule-2026-09-05.json"), "utf8")) as ScheduleDayPayload;
	const { live } = JSON.parse(readFileSync(join(FIXTURES, "schedule-823823-moments.json"), "utf8")) as { live: Game };
	const linescore = live.linescore!;
	return {
		...schedule,
		games: [{
			...live,
			linescore: {
				...linescore,
				teams: {
					away: {
						...linescore.teams.away,
						runs: away,
					},
					home: {
						...linescore.teams.home,
						runs: home,
					},
				},
			},
		}],
		fetchedAt: "2026-09-05T20:57:20.000Z",
		windowMode: "active",
		version,
		lastChangedAt: "2026-09-05T20:57:20.000Z",
	};
}

/** Serves `payloads` in order to schedule requests (the last one repeats); returns the fetch mock. */
function serve(...payloads: ScheduleDayPayload[])
{
	let next = 0;
	const fetch = vi.fn((request: Request) =>
	{
		if (!new URL(request.url).pathname.startsWith("/api/v1/schedule")) return Promise.resolve(jsonResponse({}, 404));
		const payload = payloads[Math.min(next, payloads.length - 1)];
		next += 1;
		return Promise.resolve(jsonResponse(payload));
	});
	vi.stubGlobal("fetch", fetch);
	return () => fetch.mock.calls.filter(([request]) => new URL(request.url).pathname.startsWith("/api/v1/schedule")).length;
}

/** Sets `document.hidden` / `visibilityState` and fires `visibilitychange`, which bubbles to `window` as in a browser (TanStack listens there). */
function setHidden(hidden: boolean): void
{
	Object.defineProperty(document, "hidden", {
		configurable: true,
		get: () => hidden,
	});
	Object.defineProperty(document, "visibilityState", {
		configurable: true,
		get: () => (hidden ? "hidden" : "visible"),
	});
	document.dispatchEvent(new Event("visibilitychange", {
		bubbles: true,
	}));
}

async function renderScoreboard(): Promise<void>
{
	render(
		<MantineProvider>
			<QueryClientProvider client={createQueryClient()}>
				<MemoryRouter initialEntries={["/games/2026-09-05"]}>
					<Routes>
						<Route path="/games/:date" element={<ScoreboardPage variant="mobile" />} />
					</Routes>
				</MemoryRouter>
			</QueryClientProvider>
		</MantineProvider>,
	);
	await screen.findAllByTestId("runs");
}

/** The runs column, away then home. */
function runs(): (string | null)[]
{
	return screen.getAllByTestId("runs").map((cell) => cell.textContent);
}

beforeEach(() =>
{
	vi.useFakeTimers({
		shouldAdvanceTime: true,
	});
});

afterEach(() =>
{
	cleanup();
	setHidden(false);
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("scoreboard live refresh (S20)", () =>
{
	it("second payload: after one refresh interval the scores are the second payload's", async () =>
	{
		const asked = serve(day(1, 0, 1), day(3, 2, 2));
		await renderScoreboard();
		expect(runs()).toEqual(["1", "0"]);
		expect(asked()).toBe(1);

		await act(() => vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS));
		await vi.waitFor(() => expect(runs()).toEqual(["3", "2"]));
		expect(asked()).toBe(2);
	});

	it("hidden: a hidden tab asks nothing on the interval, and coming back asks again", async () =>
	{
		const asked = serve(day(1, 0, 1), day(3, 2, 2));
		await renderScoreboard();
		expect(asked()).toBe(1);

		act(() => setHidden(true));
		await act(() => vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS * 3));
		expect(asked()).toBe(1);
		expect(runs()).toEqual(["1", "0"]);

		act(() => setHidden(false));
		await vi.waitFor(() => expect(runs()).toEqual(["3", "2"]));
		expect(asked()).toBe(2);
	});
});
