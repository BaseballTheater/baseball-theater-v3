import { Box, Drawer } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { AppHeader } from "./AppHeader.js";
import { NavRail } from "./NavRail.js";
import type { Notice } from "./NoticeSlot.js";
import { NoticeSlot } from "./NoticeSlot.js";
import type { LayoutVariant } from "./variant.js";
import { useLayoutVariant } from "./variant.js";

/** The nav rail's width at every pairing it shows (S31 `nav-rail`), in px — not Mantine's scaled rem. */
const RAIL_WIDTH = 240;

/**
 * The one layout host (ADR-014 rule 8; S60). It is the only reader of the
 * viewport: it settles the pairing once and hands `variant` to the page through
 * `children`, so no page or room asks the viewport itself.
 *
 * - **mobile / medium:** the app header with the burger, which opens the nav
 *   rail as a drawer from the left over the page (S56 A2); following a link closes it.
 * - **desktop:** the 240px rail beside the page; the header has no burger and no wordmark,
 *   since the rail's wordmark is right beside it (owner, 2026-11-12).
 * - **game routes** (`/game/:pk`) draw the game top bar in place of the app
 *   header; on desktop the rail stays.
 *
 * The notice slot sits directly under the header (S31 `shell-notice-*`); the reload notice
 * floats fixed at the bottom of the screen instead (shell-scoreboard A6), which `NoticeSlot`
 * decides. The notice's owner (update prompt, offline marker) passes it in.
 */
export function AppShellLayout({ children, notice = null }: {
	children: (variant: LayoutVariant) => ReactNode;
	notice?: Notice | null;
})
{
	const variant = useLayoutVariant();
	const [opened, { toggle, close }] = useDisclosure();
	const { pathname } = useLocation();
	const desktop = variant === "desktop";
	const gameRoute = pathname.startsWith("/game/");

	return (
		<Box style={{
			display: "flex",
			minHeight: "100vh",
		}}>
			{desktop ? (
				<Box
					component="nav"
					aria-label="Main"
					style={{
						width: RAIL_WIDTH,
						flexShrink: 0,
						position: "sticky",
						top: 0,
						height: "100vh",
						borderRight: "1px solid var(--mantine-color-dark-4)",
					}}
				>
					<NavRail />
				</Box>
			) : (
				<Drawer
					opened={opened}
					onClose={close}
					size={RAIL_WIDTH}
					padding={0}
					withCloseButton={false}
					title={null}
					aria-label="Navigation"
					styles={{
						body: {
							height: "100%",
						},
					}}
				>
					<nav aria-label="Main" style={{
						height: "100%",
					}}>
						<NavRail onNavigate={close} />
					</nav>
				</Drawer>
			)}
			<Box style={{
				flex: 1,
				minWidth: 0,
				display: "flex",
				flexDirection: "column",
			}}>
				{gameRoute ? null : <AppHeader burger={!desktop} wordmark={!desktop} drawerOpened={opened} onBurger={toggle} />}
				<NoticeSlot notice={notice} />
				<Box component="main" px="md" pb="md" pt={gameRoute ? 0 : "md"} style={{
					flex: 1,
				}}>
					{children(variant)}
				</Box>
			</Box>
		</Box>
	);
}
