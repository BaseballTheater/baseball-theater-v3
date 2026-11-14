import {
	Box, Stack, Text,
} from "@mantine/core";
import { Link, useLocation } from "react-router-dom";
import { DevSessionControl } from "../session/DevSessionControl.js";
import { useSession } from "../session/session.js";
import { NAV, activeSection } from "./nav.js";
import { VERSION_LINE } from "./version.js";
import { HomeLink } from "./Wordmark.js";

/**
 * The 240px nav rail (S31 `nav-rail`): wordmark (the link home), sections with the active one
 * filled Primary and marked `aria-current`, and the build's version line at its
 * foot with no label (S56 A2). The desktop host shows it beside the page; on
 * mobile and medium it is the drawer's content, and `onNavigate` closes the drawer.
 *
 * Values from the Figma `nav-rail` (Active=Scoreboard, 163:919; S83): 24px
 * padding, 32px from the wordmark to the list, items 8px apart, each 44px tall
 * with an 8px radius and 12px / 16px padding; a 4×20 marker (2px radius) 12px
 * before the label, Primary Light on the active item and transparent on the
 * others, so every label sits at the same inset; labels 15px Light, the active
 * one SemiBold; the active item filled Primary (`color/brand/primary`, #CE0F0F);
 * the version line 11px Light. An item that isn't active takes the Light wash on hover
 * (`.bt-hover`); the active one is already filled.
 */
export function NavRail({ onNavigate }: { onNavigate?: () => void })
{
	const { pathname } = useLocation();
	const signedIn = useSession().status === "signedIn";
	const active = activeSection(pathname);

	return (
		<Stack h="100%" justify="space-between" p={24} gap="md">
			<Stack gap={32}>
				<Box>
					<HomeLink onClick={onNavigate} />
				</Box>
				<Stack gap={8} component="ul" m={0} p={0} style={{
					listStyle: "none",
				}}>
					{NAV.filter((item) => signedIn || !item.signedInOnly).map((item) =>
					{
						const isActive = item.to === active;
						return (
							<li key={item.to}>
								<Box
									component={Link}
									to={item.to}
									onClick={onNavigate}
									aria-current={isActive ? "page" : undefined}
									data-active={isActive || undefined}
									className={isActive ? undefined : "bt-hover"}
									style={{
										display: "flex",
										alignItems: "center",
										gap: 12,
										height: 44,
										padding: "12px 16px",
										borderRadius: 8,
										background: isActive ? "var(--bt-primary)" : "transparent",
									}}
								>
									<Box
										data-testid="nav-marker"
										aria-hidden
										style={{
											width: 4,
											height: 20,
											borderRadius: 2,
											flexShrink: 0,
											background: isActive ? "var(--bt-primary-light)" : "transparent",
										}}
									/>
									<Text component="span" fz={15} fw={isActive ? 600 : 400} c="var(--bt-light)">
										{item.label}
									</Text>
								</Box>
							</li>
						);
					})}
				</Stack>
			</Stack>
			<Stack gap="xs" align="flex-start">
				<DevSessionControl />
				<Text fz={11} c="var(--bt-light)" data-testid="version-line">
					{VERSION_LINE}
				</Text>
			</Stack>
		</Stack>
	);
}
