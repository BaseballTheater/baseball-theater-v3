import type {
	GameRowSlot, OpensFirst, VideoPlayerMode,
} from "@bt/domain";
import {
	GAME_ROW_SLOTS, MLB_TEAMS, OPENS_FIRST_ROOMS, VIDEO_PLAYERS,
} from "@bt/domain";
import {
	Anchor, Divider, MultiSelect, Radio, SimpleGrid, Stack, Switch, Text, Title,
} from "@mantine/core";
import type { ReactNode } from "react";
import { roomLabel } from "../components/game/format.js";
import type { LayoutVariant } from "../layout/variant.js";
import { useInstallOffer } from "../pwa/install.js";
import { useSession } from "../session/session.js";
import { AccountData } from "./settings/AccountData.js";
import { InstallApp } from "./settings/InstallApp.js";
import {
	setCollapseNonFavorites, setFavoriteTeams, setGameRowSlot, setHideScores, setOpensFirst, setVideoPlayer, useSettings,
} from "../settings/store.js";

const TEAM_OPTIONS = MLB_TEAMS.map((team) => ({
	value: String(team.id),
	label: team.abbreviation,
}));

/** The Game-Row Slot choices as the Settings frame labels them; the frame's third choice is left out at launch (owner, 2026-10-19). */
const SLOT_LABELS: Readonly<Record<GameRowSlot, string>> = {
	status: "Status",
	roomMenu: "Room Menu",
};

/** The Video Player choices as the Settings frame labels them, Dialog first (S70). */
const PLAYER_LABELS: Readonly<Record<VideoPlayerMode, string>> = {
	dialog: "Dialog",
	stage: "Stage",
};

/** One titled group of the ratified Settings frame (Game List · Game Detail · App · Account). */
function SettingsGroup({ title, children }: { title: string;
	children: ReactNode })
{
	return (
		<Stack gap="xs" component="section" aria-label={title}>
			<Title order={2} size="h4">{title}</Title>
			{children}
		</Stack>
	);
}

/**
 * Settings, as the ratified frames draw it (standings-search-settings, A3):
 * Game List (Favorite Teams, Game-Row Slot, Collapse Non-Favorites, Hide Scores) on the
 * left, Game Detail (Opens First, Video Player) and Account on the right; one column on mobile. Every
 * control is one this story can make work; the Video Player control arrives with
 * the screen that reads it (S70), and the Patreon rows with the
 * Patreon link. Signed-in only (the route guards it), so the session has an
 * account. Download and delete your data sit at the end of Account (A4, S79). The App group
 * (install, S73) sits above Account when the browser can install or on iPhone/iPad.
 */
export function SettingsPage({ variant }: { variant: LayoutVariant })
{
	const settings = useSettings();
	const session = useSession();
	// Settings → App sits above Account only while there is an install offer (S55 A1, S73).
	const install = useInstallOffer();
	const columns = variant === "mobile" ? 1 : 2;

	return (
		<Stack>
			<Title order={1}>Settings</Title>
			<SimpleGrid cols={columns} spacing="xl" data-columns={columns}>
				<Stack gap="xl">
					<SettingsGroup title="Game List">
						<MultiSelect
							label="Favorite Teams"
							data={TEAM_OPTIONS}
							value={settings.favoriteTeamIds.map(String)}
							onChange={(ids) => void setFavoriteTeams(ids.map(Number))}
							searchable
						/>
						<Radio.Group
							label="Game-Row Slot"
							value={settings.gameRowSlot}
							onChange={(slot) => void setGameRowSlot(slot as GameRowSlot)}
						>
							<Stack gap="xs" mt="xs">
								{GAME_ROW_SLOTS.map((slot) => <Radio key={slot} value={slot} label={SLOT_LABELS[slot]} />)}
							</Stack>
						</Radio.Group>
						<Divider my="xs" />
						<Switch
							label="Collapse Non-Favorites"
							labelPosition="left"
							checked={settings.collapseNonFavorites}
							onChange={(event) => void setCollapseNonFavorites(event.currentTarget.checked)}
							styles={{
								body: {
									justifyContent: "space-between",
								},
							}}
						/>
						<Switch
							label="Hide Scores"
							labelPosition="left"
							checked={settings.hideScores}
							onChange={(event) => void setHideScores(event.currentTarget.checked)}
							styles={{
								body: {
									justifyContent: "space-between",
								},
							}}
						/>
					</SettingsGroup>
				</Stack>
				<Stack gap="xl">
					<SettingsGroup title="Game Detail">
						<Radio.Group
							label="Opens First"
							value={settings.opensFirst}
							onChange={(room) => void setOpensFirst(room as OpensFirst)}
						>
							<Stack gap="xs" mt="xs">
								{OPENS_FIRST_ROOMS.map((room) => <Radio key={room} value={room} label={roomLabel(room)} />)}
							</Stack>
						</Radio.Group>
						<Radio.Group
							label="Video Player"
							value={settings.videoPlayer}
							onChange={(mode) => void setVideoPlayer(mode as VideoPlayerMode)}
						>
							<Stack gap="xs" mt="xs">
								{VIDEO_PLAYERS.map((mode) => <Radio key={mode} value={mode} label={PLAYER_LABELS[mode]} />)}
							</Stack>
						</Radio.Group>
					</SettingsGroup>
					{install ? (
						<SettingsGroup title="App">
							<InstallApp offer={install} />
						</SettingsGroup>
					) : null}
					<SettingsGroup title="Account">
						{session.status === "signedIn" && <Text>Signed in as {session.account.email}</Text>}
						{/* A text link, not a button (A3, owner 2026-10-22: "Text link"). */}
						<Anchor
							href="#"
							underline="always"
							c="inherit"
							onClick={(event) =>
							{
								event.preventDefault();
								session.signOut();
							}}
						>
							Sign out
						</Anchor>
						<AccountData variant={variant} />
					</SettingsGroup>
				</Stack>
			</SimpleGrid>
		</Stack>
	);
}
