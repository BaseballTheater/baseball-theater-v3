import type { AtBat } from "@bt/domain";
import {
	defaultPlaysInning, inningHalves, linescoreCells, ordinal, scoreAfterLabel, scoringPlays,
} from "@bt/domain";
import {
	Accordion, Badge, Box, Group, Stack, Text, UnstyledButton,
} from "@mantine/core";
import type { ReactNode } from "react";
import {
	Fragment, useEffect, useRef, useState,
} from "react";
import { flushSync } from "react-dom";
import type { GamePayload } from "../../api/game.js";
import { useScoresHidden } from "../../settings/useScoresHidden.js";
import { HiddenValue } from "../HiddenValue.js";
import { shortPlayerName } from "../game/format.js";
import { Linescore } from "../game/Linescore.js";
import { AtBatViewer } from "./AtBatViewer.js";

/**
 * An open at-bat's header: the matchup, inning and final count, what happened, and the
 * result — in place of the one-line label, rather than repeating it in a box below
 * (owner, 2026-10-29: "When expanded, can the accordion header show the data that's in
 * this box instead of having both the header and the box?").
 */
function OpenHeader({ atBat }: { atBat: AtBat })
{
	return (
		<Stack gap={4} align="flex-start">
			<Text fw={700}>
				{atBat.matchup.batter.fullName} vs {atBat.matchup.pitcher.fullName}
			</Text>
			<Text size="sm" c="dimmed">
				{atBat.about.halfInning === "top" ? "Top" : "Bottom"} {atBat.about.inning} ·{" "}
				{atBat.count.balls}-{atBat.count.strikes}, {atBat.count.outs} out
				{atBat.count.outs === 1 ? "" : "s"}
			</Text>
			<Text>{atBat.result.description}</Text>
			{/* Under the text, not beside it, so a long result isn't clipped by the chevron. */}
			<Badge color={atBat.result.isOut ? "gray" : "teal"} variant="light" style={{
				flexShrink: 0,
			}}>
				{atBat.result.event}
			</Badge>
		</Stack>
	);
}

/** `Top 3` / `Bot 7`: a scoring play's inning tag (`plays-scoring-mobile`). */
function inningTag(atBat: AtBat): string
{
	return `${atBat.about.halfInning === "top" ? "Top" : "Bot"} ${atBat.about.inning}`;
}

/** The control's accessible name: half, inning, batter and result, whatever the row shows. */
function atBatLabel(atBat: AtBat): string
{
	return `${inningTag(atBat)} · ${atBat.matchup.batter.fullName} — ${atBat.result.event}`;
}

/**
 * What a collapsed row's second line ends with: the outs after it, or the score after a
 * scoring play — masked with Hide Scores on (S75).
 */
type RowEnd = (atBat: AtBat) => ReactNode;

/**
 * A collapsed at-bat row as the frames draw it: `A. Judge — Flyout` over `vs K. Jansen ·
 * 4 pitches · 1 out`; a scoring play leads with its inning tag and ends with the score.
 */
function ClosedRow({
	atBat, tagged, end,
}: { atBat: AtBat;
	tagged: boolean;
	end: RowEnd; })
{
	const meta = [`vs ${shortPlayerName(atBat.matchup.pitcher.fullName)}`, `${atBat.pitches.length} pitch${atBat.pitches.length === 1 ? "" : "es"}`, end(atBat)].filter((part) => part !== null && part !== "");
	return (
		<Stack gap={2}>
			<Text fz={15} fw={600}>
				{tagged ? `${inningTag(atBat)} · ` : ""}
				{shortPlayerName(atBat.matchup.batter.fullName)} — {atBat.result.event}
			</Text>
			<Text fz={12} c="var(--bt-accent)">
				{meta.map((part, i) => <Fragment key={i}>{i > 0 ? " · " : ""}{part}</Fragment>)}
			</Text>
		</Stack>
	);
}

/** One labeled run of rows in the accordion: a half-inning, or the game's scoring plays. */
type Section = {
	label: string;
	plays: AtBat[];
};

/** Which view the sidebar has chosen: an inning, or every scoring play. */
type View = number | "runs";

/**
 * The floating inning sidebar (game-rooms `plays-*`): every inning in order, extras
 * included, then **Runs** under a hairline. The chosen one fills Primary. It stays in
 * view at the room's right edge at every pairing, in reach of the thumb on mobile.
 */
function InningSidebar({
	innings, view, onChoose,
}: { innings: readonly number[];
	view: View;
	onChoose: (view: View) => void; })
{
	const item = (value: View, label: string) => (
		<UnstyledButton
			key={label}
			aria-current={view === value ? "true" : undefined}
			onClick={() => onChoose(value)}
			w={36}
			h={30}
			fz={value === "runs" ? 11 : 14}
			ta="center"
			style={{
				borderRadius: 6,
				background: view === value ? "var(--bt-primary)" : undefined,
				color: "var(--bt-light)",
			}}
		>
			{label}
		</UnstyledButton>
	);
	return (
		<Box
			component="nav"
			aria-label="Inning sidebar"
			p={6}
			style={{
				position: "sticky",
				top: 16,
				flexShrink: 0,
				borderRadius: 12,
				border: "1px solid var(--bt-hairline)",
				background: "var(--bt-raised)",
			}}
		>
			<Stack gap={2}>
				{innings.map((inning) => item(inning, String(inning)))}
				<Box my={4} style={{
					borderTop: "1px solid var(--bt-hairline)",
				}} />
				{item("runs", "Runs")}
			</Stack>
		</Box>
	);
}

/**
 * The Plays room (S41; game-rooms `plays-mobile` / `-medium` / `-desktop` /
 * `plays-scoring-mobile`): the boxed-inning linescore (S2's `Linescore`), then one
 * inning at a time — its top and bottom halves as at-bat rows — with the floating
 * sidebar to choose another inning or **Runs**, every scoring play of the game with the
 * score after it (owner, 2026-10-14: "Plays is basically like browsing a list of the
 * individual batters in Live … you need to be able to select the inning you're looking
 * at. By default, it should show the most recent inning that has any actual information
 * to show"). An open at-bat is Live's cards, zone and pitch sequence (`AtBatViewer`).
 * With Hide Scores on (S75; game-rooms A4 `plays-hidden-nonotice-mobile`,
 * `plays-scoring-hidden-nonotice-mobile`) the linescore masks every inning and R·H·E, the
 * Runs view masks the score after each play, and an in-play pitch reads "IN PLAY"; the
 * descriptions and the batter's line stay, since someone browsing plays wants the plays.
 */
export function PlaysPanel({ game }: { game: GamePayload })
{
	const { plays } = game;
	const latest = defaultPlaysInning(plays);
	const [view, setView] = useState<View | null>(null);
	const scoresHidden = useScoresHidden(game);
	if (latest === null)
	{
		return <Text c="dimmed">No pitch-level play data for this game yet.</Text>;
	}
	const shown = view ?? latest;
	const away = game.teams.away.abbreviation;
	const home = game.teams.home.abbreviation;
	const { innings } = linescoreCells(game.linescore, game.linescore?.scheduledInnings ?? 9);

	let heading: string;
	let sections: Section[];
	let end: RowEnd;
	if (shown === "runs")
	{
		heading = "Scoring plays";
		sections = [{
			label: "",
			plays: scoringPlays(plays),
		}];
		end = (atBat) => (scoresHidden ? <HiddenValue kind="score" /> : scoreAfterLabel(atBat, away, home));
	}
	else
	{
		const halves = inningHalves(plays, shown);
		heading = `${ordinal(shown)} inning`;
		sections = [{
			label: `Top ${ordinal(shown)} · ${away}`,
			plays: halves.top,
		}, {
			label: `Bottom ${ordinal(shown)} · ${home}`,
			plays: halves.bottom,
		}];
		end = (atBat) => `${atBat.count.outs} out${atBat.count.outs === 1 ? "" : "s"}`;
	}
	const rows = sections.flatMap((section) => section.plays);

	return (
		<Stack gap={16}>
			<Linescore linescore={game.linescore} away={away} home={home} hidden={scoresHidden} />
			<Group align="flex-start" gap={8} wrap="nowrap">
				<Stack gap={8} style={{
					flex: 1,
					minWidth: 0,
				}}>
					<Text fz={11} fw={700} tt="uppercase">{heading}</Text>
					{rows.length === 0 ? <Text c="dimmed">No scoring plays yet.</Text> : (
						<PlaysAccordion
							// A new view starts fresh, its last row open (game-rooms DESIGN: "In the default view the game's last at-bat is the open row").
							key={String(shown)}
							plays={plays}
							sections={sections}
							tagged={shown === "runs"}
							end={end}
							scoresHidden={scoresHidden}
							defaultOpen={view === null ? rows.at(-1)!.about.atBatIndex : null}
						/>
					)}
				</Stack>
				<InningSidebar innings={innings} view={shown} onChoose={setView} />
			</Group>
		</Stack>
	);
}

/** How long an at-bat takes to open, in ms. */
const OPEN_MS = 200;

/** Calls `then` once a smooth scroll has finished: on `scrollend`, or after a second without one. Returns a cancel. */
function afterScroll(then: () => void): () => void
{
	let done = false;
	const finish = () =>
	{
		if (done) return;
		done = true;
		window.removeEventListener("scrollend", finish);
		then();
	};
	window.addEventListener("scrollend", finish, {
		once: true,
	});
	const timer = window.setTimeout(finish, 1000);
	return () =>
	{
		done = true;
		window.clearTimeout(timer);
		window.removeEventListener("scrollend", finish);
	};
}

/**
 * The at-bats as an accordion, one open at a time, in labeled sections. Opening one
 * happens in three steps so nothing moves under the reader at once (owner, 2026-10-29:
 * "Opening an at bat should scroll the accordion item to the top of the screen"; "The
 * accordion animation is janky because the open one closes while the scrolling
 * animation is happening"): the open at-bat closes instantly with the tapped one held
 * where it was on screen, the tapped one scrolls to the top, then it opens. Once it's
 * open its pitches replay in turn ("Opening an at bat should animate each pitch in quick
 * succession, starting after the top of screen animation is completed").
 */
function PlaysAccordion({
	plays, sections, tagged, end, defaultOpen, scoresHidden,
}: { plays: readonly AtBat[];
	sections: Section[];
	tagged: boolean;
	end: RowEnd;
	defaultOpen: number | null;
	scoresHidden: boolean; })
{
	const [open, setOpen] = useState<string | null>(defaultOpen === null ? null : String(defaultOpen));
	// 0 while the old at-bat snaps shut; the open animation otherwise.
	const [duration, setDuration] = useState(OPEN_MS);
	// The at-bat being opened, until its pitches start replaying.
	const pending = useRef<string | null>(null);
	// Which at-bat to replay, and a fresh token each time.
	const [autoplay, setAutoplay] = useState<{ value: string;
		token: number } | null>(null);

	// Waits still pending (a scroll's end, the open animation's fallback), cancelled on unmount.
	const waits = useRef<(() => void)[]>([]);
	useEffect(() => () => waits.current.forEach((cancel) => cancel()), []);
	const later = (run: () => void, ms: number) =>
	{
		const timer = window.setTimeout(run, ms);
		waits.current.push(() => window.clearTimeout(timer));
	};

	const replay = (value: string) =>
	{
		if (pending.current !== value) return;
		pending.current = null;
		setAutoplay((last) => ({
			value,
			token: (last?.token ?? 0) + 1,
		}));
	};

	const choose = (value: string | null) =>
	{
		pending.current = value;
		const item = value === null ? null : document.getElementById(`at-bat-${value}`);
		if (value === null || !item)
		{
			setDuration(OPEN_MS);
			setOpen(value);
			return;
		}
		// 1. Close the open at-bat at once, keeping the tapped one where it was on screen
		//    (the closed one above it would otherwise pull it up).
		const before = item.getBoundingClientRect().top;
		flushSync(() =>
		{
			setDuration(0);
			setOpen(null);
		});
		window.scrollBy(0, item.getBoundingClientRect().top - before);
		// 2. Scroll it to the top. 3. Then open it; its pitches replay once it's open.
		const opened = () =>
		{
			if (pending.current !== value) return;
			setDuration(OPEN_MS);
			setOpen(value);
			// The open animation reports its end (`settled`); this covers reduced motion,
			// where there is no animation to end.
			later(() => replay(value), OPEN_MS + 400);
		};
		if (Math.abs(item.getBoundingClientRect().top) < 2)
		{
			opened();
			return;
		}
		item.scrollIntoView({
			behavior: "smooth",
			block: "start",
		});
		waits.current.push(afterScroll(opened));
	};

	return (
		<Accordion value={open} onChange={choose} variant="separated" transitionDuration={duration}>
			{sections.map((section) => (
				<Fragment key={section.label}>
					{section.label ? <Text fz={11} fw={700} tt="uppercase" mt={8}>{section.label}</Text> : null}
					{section.plays.map((atBat) =>
					{
						const value = String(atBat.about.atBatIndex);
						return (
							<Accordion.Item id={`at-bat-${value}`} key={value} value={value}>
								<Accordion.Control aria-label={atBatLabel(atBat)}>
									{open === value ? <OpenHeader atBat={atBat} /> : <ClosedRow atBat={atBat} tagged={tagged} end={end} />}
								</Accordion.Control>
								<Accordion.Panel onTransitionEnd={() => replay(value)}>
									{/* Only the open at-bat is mounted, so a closed one's replay stops with it. */}
									{open === value ? (
										<AtBatViewer plays={plays} atBat={atBat} autoplay={autoplay?.value === open ? autoplay.token : 0} scoresHidden={scoresHidden} />
									) : null}
								</Accordion.Panel>
							</Accordion.Item>
						);
					})}
				</Fragment>
			))}
		</Accordion>
	);
}
