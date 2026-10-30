import type { Room } from "@bt/domain";

/** `live` → `Live`: the tab label for a room. The rooms themselves come from `@bt/domain` (ADR-025). */
export function roomLabel(room: Room): string
{
	return room[0]!.toUpperCase() + room.slice(1);
}

/**
 * `Pete Crow-Armstrong` → `P. Crow-Armstrong`: the Box batting table's player name
 * (game-rooms Box frames, "G. Torres"). A one-word name is left as it is.
 */
export function shortPlayerName(fullName: string): string
{
	const [first, ...rest] = fullName.split(" ");
	return first && rest.length > 0 ? `${first[0]}. ${rest.join(" ")}` : fullName;
}

/** The Game info lines the Box frames draw, in their order (game-rooms DESIGN, S33). */
const GAME_INFO_LABELS = ["Venue", "First pitch", "Weather", "Wind", "T", "Att"] as const;

/**
 * MLB's boxscore info lines as the Box room shows them: the drawn labels in the
 * drawn order, each value without MLB's closing period (`loanDepot park.`).
 */
export function gameInfoLines(info: readonly { label: string;
	value: string; }[]): { label: string;
	value: string; }[]
{
	return GAME_INFO_LABELS.flatMap((label) =>
	{
		const line = info.find((l) => l.label === label);
		return line ? [{
			label,
			value: line.value.replace(/\.$/, ""),
		}] : [];
	});
}

/** `1` → `1 Out`, `2` → `2 Outs` (the Live status, S3); `null` before there is a count. */
export function outsLabel(outs: number | null): string | null
{
	if (outs === null) return null;
	return `${outs} ${outs === 1 ? "Out" : "Outs"}`;
}
