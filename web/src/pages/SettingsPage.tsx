import type {
	GameRowSlot, OpensFirst, VideoPlayerMode,
} from "@bt/domain";
import {
	GAME_ROW_SLOTS, MLB_TEAMS, OPENS_FIRST_ROOMS, VIDEO_PLAYERS,
} from "@bt/domain";
import {
	Anchor, Divider, MultiSelect, Paper, Radio, SimpleGrid, Stack, Switch, Text, Title,
} from "@mantine/core";
import type { ReactNode } from "react";
import { roomLabel } from "../components/game/format.js";
import type { LayoutVariant } from "../layout/variant.js";
import { useInstallOffer, useInstallTipDismissed } from "../pwa/install.js";
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

/** One titled section inside a frame (Game List, Game Detail): a smaller heading than the frame's, so the two read as distinct parts of Settings (A8). */
function SettingsGroup({ title, children }: { title: string;
	children: ReactNode })
{
	return (
		<Stack gap="xs" component="section" aria-label={title}>
			<Title order={2} size="h5" c="dimmed" tt="uppercase" fw={600}>{title}</Title>
			{children}
		</Stack>
	);
}

/**
 * One of A8's two bordered frames, Settings or Account (standings-search-settings A8: "frames
 * around them for visual separation"). The Settings frame's heading is the page's h1, since
 * the frames now carry the page's titles; Account's is an h2, beside the Settings sections.
 */
function SettingsFrame({
	title, level, children,
}: { title: string;
	level: 1 | 2;
	children: ReactNode })
{
	return (
		<Paper component="section" aria-label={title} withBorder radius="md" p="lg">
			<Stack gap="lg">
				<Title order={level} size="h3">{title}</Title>
				{children}
			</Stack>
		</Paper>
	);
}

/**
 * Settings, as the ratified frames draw it (standings-search-settings, A3) and A8 lays it out
 * (ratified 2026-11-02): the install tip at the very top, outside both frames, while there is
 * an install offer (S73; the browser's prompt, or the Share steps on iPhone/iPad) and until it
 * is dismissed in this browser; then two bordered frames side by side on medium and desktop,
 * **Settings** (Game List, then Game Detail, as distinct sections) and **Account**; on mobile
 * one column: tip, Settings, Account. Every control is one this story can make work; the
 * Video Player control arrives with the screen that reads it (S70), and the Patreon rows with
 * the Patreon link. Signed-in only (the route guards it), so the session has an account.
 * Download and delete your data sit at the end of Account (A4, S79).
 */
export function SettingsPage({ variant }: { variant: LayoutVariant })
{
	const settings = useSettings();
	const session = useSession();
	// The install tip shows only while there is an install offer (S55 A1, S73) and it isn't dismissed (A8).
	const install = useInstallOffer();
	const [tipDismissed, dismissTip] = useInstallTipDismissed();
	const columns = variant === "mobile" ? 1 : 2;

	return (
		<Stack>
			{install && !tipDismissed ? <InstallApp offer={install} onDismiss={dismissTip} /> : null}
			<SimpleGrid cols={columns} spacing="lg" data-columns={columns} style={{
				alignItems: "start",
			}}>
				<SettingsFrame title="Settings" level={1}>
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
					<Divider />
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
				</SettingsFrame>
				<SettingsFrame title="Account" level={2}>
					<Stack gap="xs">
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
					</Stack>
				</SettingsFrame>
			</SimpleGrid>
		</Stack>
	);
}
