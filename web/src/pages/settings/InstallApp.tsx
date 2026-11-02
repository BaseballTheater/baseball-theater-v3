import {
	Anchor, List, Text,
} from "@mantine/core";
import type { InstallOffer } from "../../pwa/install.js";

/**
 * Settings → App's body (S73): S55 A1's install link where the browser can install, or S56
 * A2's Share steps on iPhone/iPad, where Safari has no install API. The page shows the
 * group only when there is an offer (`useInstallOffer`), so it is never shown once installed.
 */
export function InstallApp({ offer }: { offer: NonNullable<InstallOffer> })
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
