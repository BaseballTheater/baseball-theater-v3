import {
	Anchor, Badge, CloseButton, Group, List, Paper, Stack, Text,
} from "@mantine/core";
import { IconBulb } from "@tabler/icons-react";
import type { InstallOffer } from "../../pwa/install.js";

/**
 * The install tip at the very top of Settings (S73; standings-search-settings A8, ratified
 * 2026-11-02): outside the Settings and Account frames, with a small "Tip" mark and a ✕ that
 * dismisses it for good in this browser (`onDismiss`; `useInstallTipDismissed`). Its body is
 * S55 A1's install link where the browser can install, or S56 A2's Share steps on iPhone/iPad,
 * where Safari has no install API. The page shows it only when there is an offer
 * (`useInstallOffer`), so it is never shown once installed.
 */
export function InstallApp({ offer, onDismiss }: {
	offer: NonNullable<InstallOffer>;
	onDismiss: () => void;
})
{
	return (
		<Paper component="aside" aria-label="Install tip" bg="var(--bt-raised)" radius="md" px="md" py="sm">
			<Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
				<Stack gap={6}>
					<Badge variant="light" color="accent" size="sm" leftSection={<IconBulb size={12} aria-hidden />} style={{
						alignSelf: "flex-start",
					}}>
						Tip
					</Badge>
					<InstallBody offer={offer} />
				</Stack>
				<CloseButton aria-label="Dismiss tip" onClick={onDismiss} />
			</Group>
		</Paper>
	);
}

/** The tip's words: the iOS Share steps, or the line and Install app link. */
function InstallBody({ offer }: { offer: NonNullable<InstallOffer> })
{
	if (offer.kind === "ios")
	{
		return (
			<>
				<Text>Install Baseball Theater from Safari:</Text>
				<List type="ordered" spacing={2}>
					<List.Item>Tap Share</List.Item>
					<List.Item>Choose “Add to Home Screen”</List.Item>
				</List>
			</>
		);
	}
	return (
		<>
			<Text>Open Baseball Theater from your home screen, without the browser bar.</Text>
			{/* A quiet text link, like Account's (S55 A1). */}
			<Anchor component="button" type="button" underline="always" c="inherit" ta="left" onClick={offer.install}>
				Install app
			</Anchor>
		</>
	);
}
