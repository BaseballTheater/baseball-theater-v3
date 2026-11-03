import type { PitchEvent } from "@bt/domain";
import {
	breakInches, pitchCallLabel, zoneLabel,
} from "@bt/domain";
import {
	Box, Group, SimpleGrid, Stack, Text, UnstyledButton,
} from "@mantine/core";
import type { KeyboardEvent } from "react";
import type { LayoutVariant } from "../../layout/variant.js";
import { pitchDotColor, speedLabel } from "./utils.js";

/** The detail of one pitch as label / value pairs; a value MLB didn't send reads "—". */
function pitchDetail(pitch: PitchEvent): { label: string;
	value: string }[]
{
	const data = pitch.pitchData;
	const breaks = breakInches(data?.breaks);
	const spin = data?.breaks?.spinRate;
	return [
		{
			label: "Spin rate",
			value: spin != null ? `${spin.toLocaleString("en-US", {
				maximumFractionDigits: 0,
			})} RPM` : "—",
		},
		{
			label: "Break (H / V)",
			value: breaks ? `${breaks.horizontal} in / ${breaks.vertical} in` : "—",
		},
		{
			label: "Release point",
			value: data?.extension != null ? `${data.extension.toFixed(1)} ft` : "—",
		},
		{
			label: "Zone location",
			value: zoneLabel(data?.zone) ?? "—",
		},
	];
}

/**
 * The pitch sequence (S64; game-rooms Live frames, `230:2021`): pitches newest first,
 * the selected one expanded with its spin, break, release, zone and result, the rest
 * collapsed to type, speed and call. The one pitch-list component: Live renders it for
 * the current at-bat and Plays (S41) inside each expanded at-bat. Selection belongs to
 * the room, so a zone dot and a row select the same pitch. Rows are buttons; Up / Down
 * move the selection. Mobile lists the detail as rows; medium / desktop as a
 * four-column grid (`variant` from the layout host). Each call is `pitchCallLabel`'s, so
 * with Hide Scores on an in-play pitch reads "IN PLAY" rather than say runs scored (S75).
 */
export function PitchSequence({
	pitches, selectedPitchNumber, onSelectPitch, variant, scoresHidden = false,
}: { pitches: readonly PitchEvent[];
	selectedPitchNumber: number | null;
	onSelectPitch: (pitchNumber: number) => void;
	variant: LayoutVariant;
	/** Hide Scores for this game (`useScoresHidden`, asked by the room). */
	scoresHidden?: boolean; })
{
	const callOf = (pitch: PitchEvent) => pitchCallLabel(pitch, scoresHidden);
	const newestFirst = [...pitches].reverse();

	function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number)
	{
		const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
		const next = newestFirst[index + step];
		if (step === 0 || !next) return;
		event.preventDefault();
		onSelectPitch(next.pitchNumber);
		const list = event.currentTarget.closest("[data-pitch-sequence]");
		list?.querySelector<HTMLButtonElement>(`[data-pitch="${next.pitchNumber}"]`)?.focus();
	}

	return (
		<Stack gap={8} data-pitch-sequence aria-label="Pitch sequence" role="list">
			{newestFirst.map((pitch, index) =>
			{
				const open = pitch.pitchNumber === selectedPitchNumber;
				const detail = pitchDetail(pitch);
				return (
					<Box
						key={pitch.playId || pitch.pitchNumber}
						role="listitem"
						data-testid="pitch-row"
						data-expanded={open}
						style={{
							border: "1px solid var(--bt-hairline)",
							borderRadius: 8,
							background: open ? "var(--bt-raised)" : undefined,
						}}
					>
						<UnstyledButton
							data-pitch={pitch.pitchNumber}
							aria-expanded={open}
							onClick={() => onSelectPitch(pitch.pitchNumber)}
							onKeyDown={(event) => onKeyDown(event, index)}
							w="100%"
							px={14}
							py={10}
						>
							<Group justify="space-between" wrap="nowrap">
								<Group gap={10} wrap="nowrap">
									<Box w={12} h={12} style={{
										borderRadius: "50%",
										background: pitchDotColor(pitch),
										flexShrink: 0,
									}}
									/>
									<Text fz={14} fw={700}>
										{pitch.pitchNumber} · {pitch.details.typeDescription ?? pitch.details.type ?? "Pitch"}
									</Text>
								</Group>
								<Group gap={12} wrap="nowrap">
									{pitch.pitchData ? <Text fz={13} c="var(--bt-muted)">{speedLabel(pitch.pitchData.startSpeed)}</Text> : null}
									<Text fz={13} fw={700}>{callOf(pitch)}</Text>
								</Group>
							</Group>
						</UnstyledButton>
						{open ? (
							<Box px={14} pb={12} data-testid="pitch-detail">
								{variant === "mobile" ? (
									<Stack gap={6}>
										{[...detail, {
											label: "Result",
											value: callOf(pitch),
										}].map((row) => (
											<Group key={row.label} justify="space-between">
												<Text fz={13} c="var(--bt-muted)">{row.label}</Text>
												<Text fz={13} fw={700}>{row.value}</Text>
											</Group>
										))}
									</Stack>
								) : (
									<SimpleGrid cols={4} spacing={12} data-testid="pitch-detail-grid" pt={8} style={{
										borderTop: "1px solid var(--bt-hairline)",
									}}
									>
										{detail.map((row) => (
											<Box key={row.label}>
												<Text fz={11} c="var(--bt-muted)" tt="uppercase">{row.label}</Text>
												<Text fz={14} fw={700}>{row.value}</Text>
											</Box>
										))}
									</SimpleGrid>
								)}
							</Box>
						) : null}
					</Box>
				);
			})}
		</Stack>
	);
}
