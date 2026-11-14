/**
 * The pitch components on their edges (S64): the trajectory view with no pitch, a
 * batted ball and its playback; the pitch sequence when MLB sent almost nothing and at
 * the ends of the list; the cards with no hand and a multi-homer line. The happy paths
 * run through the Live room (`components/game/LiveRoom.test.tsx`).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AtBat, PitchEvent } from "@bt/domain";
import { MantineProvider } from "@mantine/core";
import {
	act, cleanup, fireEvent, render, screen, within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { MatchupCards } from "./MatchupCards.js";
import { PitchSequence } from "./PitchSequence.js";
import { PitchTrajectoryView } from "./PitchTrajectoryView.js";
import { StrikeZoneChart } from "./StrikeZoneChart.js";

const PLAYS: AtBat[] = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/plays-823823.json"), "utf8"));
const IN_PLAY = PLAYS.flatMap((play) => play.pitches).find((pitch) => pitch.hitData && pitch.details.isInPlay)!;

/** A pitch with nothing but its number: no type, call, data or breaks. */
const BARE: PitchEvent = {
	pitchNumber: 1,
	playId: "",
	startTime: "",
	details: {
		call: null,
		callDescription: null,
		type: null,
		typeDescription: null,
		isBall: true,
		isStrike: false,
		isInPlay: false,
		ballColor: null,
	},
	count: {
		balls: 1,
		strikes: 0,
		outs: 0,
	},
	pitchData: null,
	hitData: null,
};

function wrap(node: ReactNode)
{
	return render(<MantineProvider>{node}</MantineProvider>);
}

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("PitchTrajectoryView", () =>
{
	it("asks for a pitch when none is selected", () =>
	{
		wrap(<PitchTrajectoryView pitch={null} />);
		expect(screen.getByText("Select a pitch to see trajectory.")).toBeInTheDocument();
	});

	it("Animate plays the pitch and then the batted ball through to the end, then can be pressed again", () =>
	{
		vi.useFakeTimers();
		let now = 0;
		vi.stubGlobal("requestAnimationFrame", (tick: FrameRequestCallback) => setTimeout(() =>
		{
			now += 500;
			tick(now);
		}, 0));
		vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
		vi.spyOn(performance, "now").mockReturnValue(0);
		wrap(<PitchTrajectoryView pitch={IN_PLAY} />);
		fireEvent.click(screen.getByRole("button", {
			name: "Animate",
		}));
		// Each stubbed frame is half a second: past the plate on the first, so the
		// batted ball is in the air and the pitch's ball is gone.
		act(() =>
		{
			vi.advanceTimersToNextTimer();
		});
		expect(screen.queryAllByTestId("ball")).toHaveLength(0);
		act(() =>
		{
			vi.runAllTimers();
		});
		expect(screen.getByText(/Batted ball/)).toBeInTheDocument();
		// Done: back at rest, the ball where the pitch crossed the plate in both charts.
		expect(screen.getAllByTestId("ball")).toHaveLength(2);
	});
});

describe("a located pitch MLB described only in codes", () =>
{
	const coded: PitchEvent = {
		...IN_PLAY,
		details: {
			...IN_PLAY.details,
			typeDescription: null,
			callDescription: null,
			isInPlay: false,
		},
		pitchData: {
			...IN_PLAY.pitchData!,
			breaks: null,
		},
	};

	it("the zone and the trajectory fall back to the short type and call, and show no spin", () =>
	{
		wrap(
			<>
				<StrikeZoneChart pitches={[coded, BARE]} selectedPitchNumber={null} onSelectPitch={() => undefined} />
				<PitchTrajectoryView pitch={coded} />
			</>,
		);
		expect(screen.getByText(`#${coded.pitchNumber} ${coded.details.type}`)).toBeInTheDocument();
		expect(screen.queryByText(/rpm/)).toBeNull();
		expect(screen.getByRole("button", {
			name: `Pitch ${coded.pitchNumber}`,
		})).toBeInTheDocument();
	});
});

describe("PitchSequence", () =>
{
	it("reads a dash for every detail MLB didn't send, and the call or type it falls back on", () =>
	{
		wrap(<PitchSequence pitches={[BARE]} selectedPitchNumber={1} onSelectPitch={() => undefined} variant="mobile" />);
		expect(screen.getByText("1 · Pitch")).toBeInTheDocument();
		expect(screen.getAllByText("—")).toHaveLength(4);
	});

	it("falls back to the short type and call, and keys other than Up / Down or past the ends do nothing", () =>
	{
		const onSelect = vi.fn();
		const pitch: PitchEvent = {
			...BARE,
			details: {
				...BARE.details,
				call: "B",
				type: "FF",
			},
		};
		wrap(<PitchSequence pitches={[pitch]} selectedPitchNumber={1} onSelectPitch={onSelect} variant="desktop" />);
		expect(screen.getByText("1 · FF")).toBeInTheDocument();
		const row = screen.getByRole("button");
		for (const key of ["ArrowDown", "ArrowUp", "Enter"]) fireEvent.keyDown(row, {
			key,
		});
		expect(onSelect).not.toHaveBeenCalled();
		expect(screen.getByTestId("pitch-detail-grid")).toBeInTheDocument();
	});

	it("each row ends in a chevron: up on the open pitch, down on the rest (owner, 2026-11-04)", () =>
	{
		const second: PitchEvent = {
			...BARE,
			pitchNumber: 2,
			playId: "p2",
		};
		wrap(<PitchSequence pitches={[BARE, second]} selectedPitchNumber={2} onSelectPitch={() => undefined} variant="mobile" />);
		const chevrons = screen.getAllByTestId("pitch-chevron");
		expect(chevrons).toHaveLength(2);
		// Newest first: pitch 2 (open) then pitch 1.
		expect(chevrons.map((c) => c.getAttribute("data-open"))).toEqual(["true", "false"]);
		expect(chevrons[0]!.querySelector(".tabler-icon-chevron-up")).not.toBeNull();
		expect(chevrons[1]!.querySelector(".tabler-icon-chevron-down")).not.toBeNull();
	});

	it("a row never clips its button, so the focus ring drawn outside it stays whole; the button carries the rounding for its hover wash", () =>
	{
		const second: PitchEvent = {
			...BARE,
			pitchNumber: 2,
			playId: "p2",
		};
		wrap(<PitchSequence pitches={[BARE, second]} selectedPitchNumber={2} onSelectPitch={() => undefined} variant="mobile" />);
		const rows = screen.getAllByTestId("pitch-row");
		for (const row of rows) expect(row.style.overflow).toBe("");
		const [open, closed] = rows.map((row) => row.querySelector<HTMLElement>("button[aria-expanded]")!);
		expect(open!.style.borderRadius).toMatch(/^7px 7px 0(px)? 0(px)?$/);
		expect(closed!.style.borderRadius).toBe("7px");
	});
});

describe("MatchupCards", () =>
{
	it("leaves out a hand MLB didn't send, and counts home runs and RBI", () =>
	{
		const base = PLAYS[0]!;
		const homer = (index: number): AtBat => ({
			...base,
			about: {
				...base.about,
				atBatIndex: index,
				isComplete: true,
			},
			result: {
				...base.result,
				eventType: "home_run",
				rbi: 2,
			},
			matchup: {
				...base.matchup,
				batSide: null,
				pitchHand: null,
			},
		});
		const plays = [homer(0), homer(1)];
		wrap(<MatchupCards plays={plays} atBat={plays[1]!} />);
		expect(screen.getByTestId("card-batter")).toHaveTextContent(/2-2, 2 HR, 4 RBI$/);
		expect(screen.getByTestId("card-pitcher")).not.toHaveTextContent("HP");
		cleanup();
		wrap(<MatchupCards plays={plays.slice(0, 1)} atBat={plays[0]!} />);
		expect(screen.getByTestId("card-batter")).toHaveTextContent(/1-1, HR, 2 RBI$/);
	});
});

describe("StrikeZoneChart, the catcher's view", () =>
{
	const atBat = PLAYS.find((play) => play.pitches.filter((pitch) => pitch.pitchData).length >= 3)!;

	it("draws one flight per located pitch from its own data, the selected one last and strongest", () =>
	{
		const strokes: { alpha: number;
			points: number }[] = [];
		let points = 0;
		const ctx = {
			globalAlpha: 1,
			setTransform: () => undefined,
			clearRect: () => undefined,
			beginPath: () =>
			{
				points = 0;
			},
			moveTo: () =>
			{
				points++;
			},
			lineTo: () =>
			{
				points++;
			},
			stroke()
			{
				strokes.push({
					alpha: this.globalAlpha,
					points,
				});
			},
		};
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
		const located = atBat.pitches.filter((pitch) => pitch.pitchData);
		const selected = located[0]!.pitchNumber;
		wrap(<StrikeZoneChart pitches={[...atBat.pitches, BARE]} selectedPitchNumber={selected} onSelectPitch={() => undefined} />);
		expect(strokes).toHaveLength(located.length);
		expect(strokes.every((stroke) => stroke.points === 49)).toBe(true);
		expect(strokes.at(-1)!.alpha).toBe(1);
		expect(strokes[0]!.alpha).toBeLessThan(1);
		vi.restoreAllMocks();
	});

	it("dimensions the batter's zone in the empty box: top, bottom and total height, from the batter's own zone", () =>
	{
		const data = atBat.pitches.find((p) => p.pitchData)!.pitchData!;
		const starts: Record<string, number> = {};
		for (const side of ["R", "L"] as const)
		{
			wrap(<StrikeZoneChart pitches={atBat.pitches} selectedPitchNumber={null} onSelectPitch={() => undefined} batSide={side} />);
			const dims = screen.getByTestId("zone-measurements");
			for (const feet of [data.strikeZoneTop, data.strikeZoneBottom, data.strikeZoneTop - data.strikeZoneBottom])
			{
				expect(dims).toHaveTextContent(`${(feet * 12).toFixed(1)}"`);
			}
			expect(dims.querySelectorAll("line")).toHaveLength(4);
			starts[side] = Number(dims.querySelector("line")!.getAttribute("x1"));
			cleanup();
		}
		// A right-hander's dimensions run right of the zone (into the empty box), a left-hander's left.
		expect(starts.R).toBeGreaterThan(180);
		expect(starts.L).toBeLessThan(180);
	});

	it("puts a left-handed batter on the catcher's right, and a dot answers Enter", () =>
	{
		const onSelect = vi.fn();
		wrap(<StrikeZoneChart pitches={atBat.pitches} selectedPitchNumber={null} onSelectPitch={onSelect} batSide="L" />);
		expect(screen.getByRole("img", {
			name: "Left-handed batter",
		})).toHaveStyle({
			transform: "scaleX(-1)",
		});
		// A ball's number is dark on the green; a strike's or a ball in play's is light.
		for (const pitch of atBat.pitches.filter((p) => p.pitchData))
		{
			const number = within(screen.getByRole("button", {
				name: `Pitch ${pitch.pitchNumber}`,
			})).getByText(String(pitch.pitchNumber));
			expect(number).toHaveAttribute("fill", pitch.details.isBall && !pitch.details.isStrike && !pitch.details.isInPlay ? "var(--bt-dark)" : "var(--bt-light)");
		}
		const dot = screen.getAllByRole("button")[0]!;
		fireEvent.keyDown(dot, {
			key: "Tab",
		});
		expect(onSelect).not.toHaveBeenCalled();
		fireEvent.keyDown(dot, {
			key: "Enter",
		});
		expect(onSelect).toHaveBeenCalledOnce();
	});

	it("replays the selected pitch in the zone in real time, then reports it landed", () =>
	{
		vi.useFakeTimers();
		let now = 0;
		vi.stubGlobal("requestAnimationFrame", (tick: FrameRequestCallback) => setTimeout(() =>
		{
			now += 100;
			tick(now);
		}, 0));
		vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
		vi.spyOn(performance, "now").mockReturnValue(0);
		const onEnd = vi.fn();
		const pitch = atBat.pitches.find((p) => p.pitchData)!;
		wrap(<StrikeZoneChart pitches={atBat.pitches} selectedPitchNumber={pitch.pitchNumber} onSelectPitch={() => undefined} playing onPlaybackEnd={onEnd} />);
		act(() =>
		{
			vi.advanceTimersToNextTimer();
		});
		// A tenth of a second in, the ball is in the air; its dot waits for it to land.
		expect(screen.getByTestId("zone-ball")).toBeInTheDocument();
		expect(screen.queryByRole("button", {
			name: `Pitch ${pitch.pitchNumber}`,
		})).toBeNull();
		expect(onEnd).not.toHaveBeenCalled();
		act(() =>
		{
			vi.runAllTimers();
		});
		expect(onEnd).toHaveBeenCalledOnce();
		vi.restoreAllMocks();
	});
});
