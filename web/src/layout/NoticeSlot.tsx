import {
	Button, Group, Paper, Text,
} from "@mantine/core";

/**
 * An app-level notice (S31 `notice-banner`, 438:2959), in one of two places:
 *
 * - **The "reload to update" notice** (S28's retired version, S73's waiting worker) has
 *   `update`: shell-scoreboard A6 (ratified 2026-11-02) floats it in a box fixed at the
 *   bottom of the screen, its message on top and two right-aligned buttons underneath,
 *   Snooze then Update Now. A6 repealed its ✕ and `Reload` link and its place under the header.
 * - **A marker** with no actions (S74's offline marker) stays in the slot under the header
 *   and holds until its owner clears it.
 *
 * What Snooze remembers is the notice owner's business (`useUpdateNotice`), not the slot's.
 */
export interface Notice
{
	/** Identifies this notice (a React key, and what tests and captures tell apart). */
	id: string;
	message: string;
	/** A6's two buttons: Update Now moves to the new version; Snooze hides the notice for an hour. */
	update?: {
		onUpdate: () => void;
		onSnooze: () => void;
	};
}

/**
 * The notice itself: the message, then (for the reload notice) Snooze as the secondary button
 * and Update Now as the primary one, right-aligned so Update Now sits at the far right (A6's
 * interpretation). The one notice component (ADR-025): every notice in the app draws through it.
 */
export function NoticeBanner({ notice }: { notice: Notice })
{
	return (
		<Paper role="status" bg="var(--bt-raised)" radius="md" px="md" py="sm" withBorder shadow={notice.update ? "md" : undefined}>
			<Text size="sm">{notice.message}</Text>
			{notice.update ? (
				<Group justify="flex-end" gap="xs" mt="sm" wrap="nowrap">
					<Button size="xs" variant="default" onClick={notice.update.onSnooze}>Snooze</Button>
					<Button size="xs" onClick={notice.update.onUpdate}>Update Now</Button>
				</Group>
			) : null}
		</Paper>
	);
}

/**
 * Where the shell draws its one notice (S31 `notice-slot`; A6). A reload notice floats fixed
 * at the bottom right, clear of the home indicator when installed (`env(safe-area-inset-bottom)`
 * is 0 in a browser tab), as wide as the screen's gutters allow on mobile and at most 420px
 * otherwise. Its z-index (150) is above the page, Plays' sticky inning sidebar included, and
 * below Mantine's modals and drawers (200), so the video player's scrim covers it. Any other
 * notice sits in the slot directly under the header.
 */
export function NoticeSlot({ notice }: { notice: Notice | null })
{
	if (!notice) return null;
	if (notice.update)
	{
		return (
			<div data-testid="notice-float" style={{
				position: "fixed",
				right: 16,
				bottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
				zIndex: 150,
				width: "min(420px, calc(100vw - 32px))",
			}}>
				<NoticeBanner notice={notice} />
			</div>
		);
	}
	return (
		<div data-testid="notice-slot" style={{
			padding: "12px 16px 0",
		}}>
			<NoticeBanner notice={notice} />
		</div>
	);
}
