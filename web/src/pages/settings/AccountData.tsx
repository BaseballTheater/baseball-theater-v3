import { ACCOUNT_DELETION_PHRASE } from "@bt/domain";
import {
	Anchor, Button, Group, Modal, Paper, Stack, Text, TextInput,
} from "@mantine/core";
import { useState } from "react";
import {
	deleteAccount, fetchDownloadFile, requestDownload,
} from "../../api/client.js";
import { useCurrentDownload, useWriteCurrentDownload } from "../../api/download.js";
import { formatDate, formatTime } from "../../format/datetime.js";
import type { LayoutVariant } from "../../layout/variant.js";
import { useSession } from "../../session/session.js";

/**
 * Download and delete your data, in Settings' Account group, as
 * standings-search-settings A4 draws them (S79; ADR-028). The two are separate
 * (owner, 2026-10-27: "Deleting and downloading aren't connected."). Every date
 * shown is the server's; nothing here works out 14 days or 24 hours (ADR-025).
 */

const RED = "var(--bt-primary-light)";

/** A text link that acts (A3's "Sign out" style); disabled while its request runs. */
function ActionLink({
	children, onClick, disabled = false, color = "inherit",
}: {
	children: string;
	onClick: () => void;
	disabled?: boolean;
	color?: string;
})
{
	return (
		<Anchor component="button" type="button" underline="always" fw={500} c={color} ta="left" disabled={disabled} onClick={onClick} style={disabled ? {
			opacity: 0.5,
		} : undefined}>
			{children}
		</Anchor>
	);
}

/** A4's red error lines: what failed, then the recovery hint (Primary Light, red text on Dark). */
function ErrorLines({ title }: { title: string })
{
	return (
		<Stack gap={2} role="alert">
			<Text size="sm" fw={600} c={RED}>{title}</Text>
			<Text size="sm" c={RED}>Check your connection and try again.</Text>
		</Stack>
	);
}

/**
 * Saves the stored download as a JSON file. The file is fetched with the session
 * (a plain link would carry none) and handed to the browser as a blob.
 */
async function saveDownloadFile(downloadId: string): Promise<void>
{
	const file = await fetchDownloadFile(downloadId);
	const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], {
		type: "application/json",
	}));
	const link = document.createElement("a");
	link.href = url;
	link.download = `baseball-theater-data-${file.id}.json`;
	link.click();
	URL.revokeObjectURL(url);
}

type DownloadState =
	| { kind: "idle" }
	| { kind: "requesting" }
	| { kind: "limit";
		nextAllowedAt: string; }
	| { kind: "failed" };

/** The download part of A4: the way in, the stored download with its expiry, the 24-hour refusal, a failed request. */
function DownloadData()
{
	const { data: current, isPending } = useCurrentDownload();
	const writeCurrent = useWriteCurrentDownload();
	const [state, setState] = useState<DownloadState>({
		kind: "idle",
	});

	async function request()
	{
		setState({
			kind: "requesting",
		});
		try
		{
			const result = await requestDownload();
			if (result.kind === "limit")
			{
				setState(result);
				return;
			}
			writeCurrent(result.download);
			setState({
				kind: "idle",
			});
		}
		catch
		{
			setState({
				kind: "failed",
			});
		}
	}

	async function save(downloadId: string)
	{
		try
		{
			await saveDownloadFile(downloadId);
		}
		catch
		{
			setState({
				kind: "failed",
			});
		}
	}

	const requesting = state.kind === "requesting";
	return (
		<Stack gap="xs" data-testid="download-data">
			{current ? (
				<>
					{/* Every account has an email (owner, 2026-10-28; S82), so the emailed clause always holds. */}
					<Text>Your data download is ready. It&apos;s kept until {formatDate(current.expiresAt)}, and we emailed you the link too.</Text>
					<ActionLink onClick={() => void save(current.id)}>Download your data (JSON)</ActionLink>
					<ActionLink disabled={requesting} onClick={() => void request()}>Request a new download</ActionLink>
				</>
			) : (
				<ActionLink disabled={requesting || isPending} onClick={() => void request()}>Download your data</ActionLink>
			)}
			{state.kind === "limit" ? (
				<Text c={RED}>
					You&apos;ve requested two downloads in the last 24 hours. You can request another at {formatTime(state.nextAllowedAt)}.
				</Text>
			) : null}
			{state.kind === "failed" ? <ErrorLines title="Couldn't request your download" /> : null}
		</Stack>
	);
}

type DeleteState = "idle" | "deleting" | "failed" | "reauth";

/**
 * A4's delete dialog: the typed phrase, the warning while a download lasts, the
 * re-sign-in prompt for a stale session, and a failed deletion with "Try again"
 * and the support message every time (owner, 2026-10-28). On success the account
 * is signed out — which clears personal browser keys and account queries — and
 * `/settings` shows A5's deleted page once (S86, S87).
 */
function DeleteAccountDialog({
	opened, onClose, variant,
}: {
	opened: boolean;
	onClose: () => void;
	variant: LayoutVariant;
})
{
	const session = useSession();
	const { data: current } = useCurrentDownload();
	const [phrase, setPhrase] = useState("");
	const [state, setState] = useState<DeleteState>("idle");

	async function submit()
	{
		setState("deleting");
		try
		{
			if (await deleteAccount(phrase) === "reauth_required")
			{
				setState("reauth");
				return;
			}
			// Signed out on /settings, the route asks the server once and shows A5's
			// deleted page (S87's cookie; routes.tsx).
			onClose();
			session.signOut();
		}
		catch
		{
			setState("failed");
		}
	}

	const reauth = state === "reauth";
	return (
		<Modal
			opened={opened}
			onClose={onClose}
			centered
			size={variant === "mobile" ? "100%" : 440}
			radius="lg"
			title={<Text fz={20} fw={600}>{reauth ? "Sign in again to delete" : "Delete your account"}</Text>}
		>
			{reauth ? (
				<Stack gap="md">
					<Text>Deleting your account needs a recent sign-in. Sign in again, then come back here to finish.</Text>
					<Group justify="flex-end" gap="lg">
						<ActionLink onClick={onClose}>Cancel</ActionLink>
						<Button color="primary" onClick={() => void session.signIn()}>Sign in again</Button>
					</Group>
				</Stack>
			) : (
				<Stack gap="md">
					<Text>This deletes your Baseball Theater account and everything we keep about you, right away. It can&apos;t be undone.</Text>
					{current ? (
						<Paper bg="var(--bt-raised-current)" p="sm" radius="md">
							<Stack gap={6}>
								<Text>Your data download, kept until {formatDate(current.expiresAt)}, is deleted with your account.</Text>
								<ActionLink onClick={() => void saveDownloadFile(current.id)}>Download your data first</ActionLink>
							</Stack>
						</Paper>
					) : null}
					<Text>
						Type <Text span fw={600}>{ACCOUNT_DELETION_PHRASE}</Text> to confirm.
					</Text>
					<TextInput
						aria-label="Confirmation phrase"
						placeholder={ACCOUNT_DELETION_PHRASE}
						value={phrase}
						onChange={(event) => setPhrase(event.currentTarget.value)}
						autoComplete="off"
					/>
					{state === "failed" ? <ErrorLines title="Couldn't finish deleting your account" /> : null}
					<Group justify="flex-end" gap="lg">
						<ActionLink onClick={onClose}>Cancel</ActionLink>
						<Button color="primary" disabled={phrase !== ACCOUNT_DELETION_PHRASE || state === "deleting"} onClick={() => void submit()}>
							{state === "failed" ? "Try again" : "Delete account"}
						</Button>
					</Group>
					{state === "failed" ? (
						<Text size="sm">
							If this keeps happening, email <Anchor href="mailto:support@baseball.theater" underline="always" fw={500} c="inherit">support@baseball.theater</Anchor>.
						</Text>
					) : null}
				</Stack>
			)}
		</Modal>
	);
}

/** The ways in to downloading and to deletion, below the Account group's other rows (A4). Signed in only. */
export function AccountData({ variant }: { variant: LayoutVariant })
{
	const session = useSession();
	const [deleting, setDeleting] = useState(false);
	if (session.status !== "signedIn") return null;
	return (
		<>
			<DownloadData />
			<ActionLink color={RED} onClick={() => setDeleting(true)}>Delete account</ActionLink>
			<DeleteAccountDialog opened={deleting} onClose={() => setDeleting(false)} variant={variant} />
		</>
	);
}
