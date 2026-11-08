/**
 * Pure upstream → BT mapper for standings.
 *
 * MLB reports every games-back and elimination figure as a string and uses
 * `"-"` for "not applicable" rather than `0` or `null`. Normalizing that here
 * keeps the sentinel out of the UI entirely.
 */
import type {
	StandingsDivision,
	StandingsSnapshot,
	StandingsTeamRecord,
} from "@bt/domain";
import type {
	StandingsRecordEntry,
	StandingsRecordGroup,
	StandingsResponse,
} from "@bt/mlb-api";

/** MLB's "not applicable" dash, normalized to `null`. */
export function normalizeDash(value: string | undefined): string | null
{
	if (value === undefined || value === "-") return null;
	return value;
}

function toRank(value: string | undefined): number | null
{
	if (value === undefined) return null;
	const parsed = Number.parseInt(value, 10);
	return Number.isNaN(parsed) ? null : parsed;
}

export function mapStandingsTeam(entry: StandingsRecordEntry): StandingsTeamRecord
{
	return {
		teamId: entry.team?.id ?? 0,
		name: entry.team?.name ?? "",
		abbreviation: entry.team?.abbreviation ?? null,
		wins: entry.wins ?? entry.leagueRecord?.wins ?? 0,
		losses: entry.losses ?? entry.leagueRecord?.losses ?? 0,
		pct: entry.winningPercentage ?? entry.leagueRecord?.pct ?? null,
		gamesBack: normalizeDash(entry.gamesBack),
		divisionRank: toRank(entry.divisionRank),
		streak: entry.streak?.streakCode ?? null,
		runsScored: entry.runsScored ?? null,
		runsAllowed: entry.runsAllowed ?? null,
		runDifferential: entry.runDifferential ?? null,
		divisionLeader: entry.divisionLeader ?? false,
		clinched: entry.clinched ?? false,
		eliminationNumber: normalizeDash(entry.eliminationNumber),
	};
}

export function mapStandingsDivision(group: StandingsRecordGroup): StandingsDivision
{
	const rows = group.teamRecords ?? [];
	const teams = rows.map(mapStandingsTeam);
	teams.sort((a, b) => (a.divisionRank ?? Infinity) - (b.divisionRank ?? Infinity));
	// The group's own division ref is unnamed; the readable name is on each row.
	const named = rows.find((row) => row.team?.division?.name);
	return {
		divisionId: group.division?.id ?? null,
		name: named?.team?.division?.name ?? null,
		leagueId: group.league?.id ?? null,
		teams,
	};
}

/**
 * The order every table lists its divisions in (S128): the regular season's, AL East, Central,
 * West, then NL East, Central, West. MLB's spring table comes West first, and the ids are not in
 * this order (West is 200, East 201, Central 202), so it is a fixed list, not a sort by id.
 */
const DIVISION_ORDER: readonly number[] = [201, 202, 200, 204, 205, 203];

/** A division's place in `DIVISION_ORDER`; one MLB doesn't list there keeps its place after them. */
function divisionPlace(division: StandingsDivision): number
{
	const place = division.divisionId === null ? -1 : DIVISION_ORDER.indexOf(division.divisionId);
	return place === -1 ? DIVISION_ORDER.length : place;
}

export function mapStandings(
	response: StandingsResponse,
	date: string,
	fetchedAt = new Date().toISOString(),
): StandingsSnapshot
{
	const divisions = (response.records ?? []).map(mapStandingsDivision);
	// A stable sort, so divisions outside the list keep MLB's order among themselves.
	divisions.sort((a, b) => divisionPlace(a) - divisionPlace(b));
	return {
		date,
		divisions,
		fetchedAt,
		windowMode: "cache",
	};
}
