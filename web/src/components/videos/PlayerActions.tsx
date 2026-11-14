import {
	Button, Group, Menu,
} from "@mantine/core";
import {
	IconCheck, IconCopy, IconDownload, IconExternalLink, IconSettings, IconShare, IconX,
} from "@tabler/icons-react";
import type { VideoQuality } from "@bt/domain";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

/** How long "Copied" (or "Couldn't copy") stays on the copy button, in ms. */
const COPIED_MS = 2000;

/** One small palette button: a quiet text button with its icon, the same in every slot. */
function ActionButton({
	icon, children, ...rest
}: { icon: ReactNode;
	children: ReactNode;
	onClick?: () => void;
	component?: "a";
	href?: string;
	target?: string;
	rel?: string;
	download?: string | boolean; })
{
	return (
		<Button variant="subtle" color="gray" size="compact-sm" c="var(--bt-light)" leftSection={icon} {...rest}>
			{children}
		</Button>
	);
}

/**
 * The quality picker (owner, 2026-11-12: "video player needs a quality selector for the
 * several qualities the api shows"): a menu of `videoQualities`' entries with the playing one
 * checked. With one quality there is nothing to pick, so it draws nothing.
 */
export function QualityPicker({
	qualities, current, onChange,
}: { qualities: readonly VideoQuality[];
	current: VideoQuality;
	onChange: (quality: VideoQuality) => void; })
{
	if (qualities.length < 2) return null;
	return (
		<Menu position="top-end" withinPortal={false}>
			<Menu.Target>
				<Button variant="subtle" color="gray" size="compact-sm" c="var(--bt-light)" leftSection={<IconSettings size={14} />} aria-label={`Quality: ${current.label}`}>
					{current.label}
				</Button>
			</Menu.Target>
			<Menu.Dropdown aria-label="Quality">
				{qualities.map((quality) => (
					<Menu.Item
						key={quality.id}
						onClick={() => onChange(quality)}
						aria-current={quality.id === current.id ? "true" : undefined}
						leftSection={quality.id === current.id ? <IconCheck size={14} /> : <span style={{
							display: "inline-block",
							width: 14,
						}}
						/>}
					>
						{quality.label}
					</Menu.Item>
				))}
			</Menu.Dropdown>
		</Menu>
	);
}

/**
 * The player's palette of clickables (owner, 2026-11-12: "video player needs a palette of
 * helpful clickables (copy link, direct link, download, share)"). BT has no page of its own
 * for a single clip (public playback catalogs are out of scope), so every action works on the
 * clip's own video file: `fileUrl` (`fileQuality`: the MP4 playing, or the same cut's MP4
 * while an HLS stream plays, since a playlist is not something to save, open or send). Only
 * when MLB gave no MP4 of that cut do Copy link, Direct link and Share fall back to the stream.
 *
 * - **Copy link** puts that URL on the clipboard and reads "Copied" for two seconds, or
 *   "Couldn't copy" when the browser has no clipboard or refuses the write.
 * - **Direct link** opens the file in a new tab.
 * - **Download** links the MP4 with `download`; MLB's files are on another origin, where a
 *   browser may open the file instead of saving it, so it opens in a new tab and never leaves
 *   the page. With no MP4 there is no Download.
 * - **Share** opens the device's share sheet with the title and URL where the browser has one
 *   (`navigator.share`), and copies the link where it doesn't, with Copy link's answer.
 */
export function PlayerActions({
	title, url, fileUrl,
}: { title: string;
	/** The URL being played. */
	url: string;
	/** The clip's MP4 (`fileQuality`), or null when MLB gave only a stream of this cut. */
	fileUrl: string | null; })
{
	const link = fileUrl ?? url;
	const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
	useEffect(() =>
	{
		if (copy === "idle") return;
		const timer = window.setTimeout(() => setCopy("idle"), COPIED_MS);
		return () => window.clearTimeout(timer);
	}, [copy]);

	const copyLink = () =>
	{
		// `navigator.clipboard` is missing outside a secure context and in some web views.
		if (!navigator.clipboard)
		{
			setCopy("failed");
			return;
		}
		navigator.clipboard.writeText(link).then(() => setCopy("copied"), () => setCopy("failed"));
	};
	const share = () =>
	{
		if (typeof navigator.share !== "function")
		{
			copyLink();
			return;
		}
		navigator.share({
			title,
			url: link,
		}).catch(() =>
		{
			// The reader closed the share sheet: nothing to do.
		});
	};

	const copyIcon = copy === "copied" ? <IconCheck size={14} /> : copy === "failed" ? <IconX size={14} /> : <IconCopy size={14} />;
	return (
		<Group gap={4} wrap="wrap" role="toolbar" aria-label="Video actions" data-testid="player-actions">
			<ActionButton icon={copyIcon} onClick={copyLink}>
				{copy === "copied" ? "Copied" : copy === "failed" ? "Couldn't copy" : "Copy link"}
			</ActionButton>
			<ActionButton icon={<IconExternalLink size={14} />} component="a" href={link} target="_blank" rel="noopener noreferrer">
				Direct link
			</ActionButton>
			{fileUrl ? (
				<ActionButton icon={<IconDownload size={14} />} component="a" href={fileUrl} download target="_blank" rel="noopener noreferrer">
					Download
				</ActionButton>
			) : null}
			<ActionButton icon={<IconShare size={14} />} onClick={share}>
				Share
			</ActionButton>
		</Group>
	);
}
