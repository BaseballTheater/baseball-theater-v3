import {
	Anchor, Box, Stack, Text,
} from "@mantine/core";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
	gamePhase, probableLine, roomsForPhase, slotOccupant,
} from "@bt/domain";
import type { GameRowSlot as GameRowSlotSetting } from "@bt/domain";
import { BaseDiamond } from "../game/BaseDiamond.js";
import { BsoPips } from "../game/BsoPips.js";
import { roomLabel, shortPlayerName } from "../game/format.js";
import type { ScoreboardGame } from "./ScoreboardModule.js";

/** A muted, one-line slot row (`W: C. Rodón`, `AB: M. Machado`), cut with an ellipsis when long. */
function Line({ children }: { children: ReactNode })
{
	return <Text fz={11} fw={700} c="var(--bt-muted)" lh={1.4} truncate>{children}</Text>;
}

/** Final: the pitchers of record, W / L / S, each only when MLB named one. */
function PitchersOfRecord({ game }: { game: ScoreboardGame })
{
	const decisions = game.decisions;
	const rows = [
		["W", decisions?.winner],
		["L", decisions?.loser],
		["S", decisions?.save],
	] as const;
	return (
		<Stack gap={2} data-testid="slot-pitchers">
			{rows.map(([letter, player]) => (player ? <Line key={letter}>{letter}: {shortPlayerName(player.fullName)}</Line> : null))}
		</Stack>
	);
}

/** Live: the bases and the count, then who is batting and pitching. */
function Count({ game }: { game: ScoreboardGame })
{
	const live = game.live ?? null;
	return (
		<Stack gap={4} data-testid="slot-count">
			<BaseDiamond live={live} />
			<BsoPips balls={live?.balls ?? null} strikes={live?.strikes ?? null} outs={live?.outs ?? null} gap={6} />
			{live?.batterName ? <Line>AB: {shortPlayerName(live.batterName)}</Line> : null}
			{live?.pitcherName ? <Line>P: {shortPlayerName(live.pitcherName)}</Line> : null}
		</Stack>
	);
}

/** Before first pitch: each side's probable starter and season line, away first. */
function Probables({ game }: { game: ScoreboardGame })
{
	const sides = [game.probablePitchers?.away, game.probablePitchers?.home];
	return (
		<Stack gap={6} data-testid="slot-probables">
			{sides.map((pitcher, i) => (
				<Box key={i === 0 ? "away" : "home"} style={{
					minWidth: 0,
				}}
				>
					<Text fz={12} fw={700} lh={1.3} truncate>{pitcher ? shortPlayerName(pitcher.fullName) : "TBD"}</Text>
					{pitcher && probableLine(pitcher) ? <Text fz={11} lh={1.3}>{probableLine(pitcher)}</Text> : null}
				</Box>
			))}
		</Stack>
	);
}

/**
 * Room menu: a link per room the game offers in its phase (R14a). The scoreboard
 * doesn't know whether MLB has published a recap, so a final lists Recap; without
 * one the game page opens its default room instead (`resolveRoom`).
 */
function RoomMenu({ game }: { game: ScoreboardGame })
{
	const rooms = roomsForPhase(gamePhase(game.status.codedGameState), true);
	return (
		<Stack gap={4} component="nav" aria-label="Rooms" data-testid="slot-room-menu">
			{rooms.map((room) => (
				<Anchor key={room} component={Link} to={`/game/${game.gamePk}/${room}`} fz={12} c="inherit" underline="always">
					{roomLabel(room)}
				</Anchor>
			))}
		</Stack>
	);
}

/**
 * The right-hand slot of a scoreboard module (S67; shell-scoreboard `Modular Block`):
 * an outlined box whose occupant `slotOccupant` picks from the user's Game-Row Slot
 * setting and the game's phase. Status (the default) is pitchers of record on a final,
 * the count on a live game and the probables before first pitch; Room Menu links into
 * the game's rooms. Win probability is left out at launch (owner, 2026-10-19).
 */
export function GameRowSlot({ game, setting }: { game: ScoreboardGame;
	setting: GameRowSlotSetting; })
{
	const occupant = slotOccupant(setting, gamePhase(game.status.codedGameState));
	return (
		<Box
			data-testid="game-row-slot"
			data-occupant={occupant}
			w={104}
			p={10}
			style={{
				flexShrink: 0,
				alignSelf: "center",
				border: "1px solid var(--bt-light)",
				borderRadius: 8,
				minWidth: 0,
			}}
		>
			{occupant === "pitchersOfRecord" ? <PitchersOfRecord game={game} /> : null}
			{occupant === "count" ? <Count game={game} /> : null}
			{occupant === "probables" ? <Probables game={game} /> : null}
			{occupant === "roomMenu" ? <RoomMenu game={game} /> : null}
		</Box>
	);
}
