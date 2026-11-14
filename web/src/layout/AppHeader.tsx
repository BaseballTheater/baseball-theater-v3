import {
	ActionIcon, Burger, Group, Loader, Menu, Text, UnstyledButton,
} from "@mantine/core";
import {
	IconLogout, IconSettings, IconUser,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "../session/session.js";
import { HomeLink } from "./Wordmark.js";

/**
 * The signed-out "Sign in" (S56 A2): it calls `signIn()` — BT has no sign-in screen of its
 * own; Logto's provides it (owner, 2026-10-22).
 *
 * Pressing it shows at once that it was heard (owner, 2026-11-12: "clicking sign in gives no
 * feedback"): it reads "Signing in…" with a spinner and stops taking presses while Logto's
 * SDK loads and the redirect starts. It stays that way only while the page is leaving for
 * Logto (`signIn()` answers true). It goes back to "Sign in" when the start fails, when
 * `signIn()` answers false (a production build without Logto, or a local dev sign-in), and
 * when the reader comes Back from Logto to this very page out of the back/forward cache
 * (`pageshow` with `persisted`), where React's state is restored as it was left. Its state
 * lives here, not in `AccountControl`, so signing in unmounts it and a later sign-out starts
 * a fresh one.
 *
 * Values from the Figma `header-mobile` (signed out, 543:8106; S83): "Sign in"
 * 14px Regular Light, 8px before a 24px account icon.
 */
function SignInButton({ signIn }: { signIn: () => Promise<boolean> })
{
	const [pending, setPending] = useState(false);
	useEffect(() =>
	{
		function onPageShow(event: PageTransitionEvent): void
		{
			if (event.persisted) setPending(false);
		}
		window.addEventListener("pageshow", onPageShow);
		return () => window.removeEventListener("pageshow", onPageShow);
	}, []);
	return (
		<UnstyledButton
			className="bt-hover"
			disabled={pending}
			aria-busy={pending || undefined}
			// The padding holds the hover wash off the text; the negative margin keeps the ratified layout where it was.
			px={8}
			py={4}
			mx={-8}
			my={-4}
			style={{
				borderRadius: 8,
			}}
			onClick={() =>
			{
				setPending(true);
				signIn().then((leaving) =>
				{
					if (!leaving) setPending(false);
				}, () => setPending(false));
			}}
		>
			<Group gap={8} wrap="nowrap">
				<Text fz={14} c="var(--bt-light)">
					{pending ? "Signing in…" : "Sign in"}
				</Text>
				{pending ? <Loader size={20} color="var(--bt-light)" aria-hidden /> : <IconUser size={24} aria-hidden />}
			</Group>
		</UnstyledButton>
	);
}

/**
 * The account control at the header's right (S56 A2). Signed in, the icon opens a menu
 * with **Settings** and **Sign out** (owner, 2026-11-12: "the user icon should provide a
 * menu on click that offers: Settings, Sign Out"). Signed out, `SignInButton`. While the
 * session loads it draws nothing, so it doesn't flash.
 */
function AccountControl()
{
	const session = useSession();
	if (session.status === "loading") return null;
	if (session.status === "signedIn")
	{
		return (
			<Menu position="bottom-end" width={180}>
				<Menu.Target>
					<ActionIcon aria-label="Account" variant="subtle" color="gray" size="lg">
						<IconUser size={24} />
					</ActionIcon>
				</Menu.Target>
				<Menu.Dropdown>
					<Menu.Item component={Link} to="/settings" leftSection={<IconSettings size={16} />}>
						Settings
					</Menu.Item>
					<Menu.Item leftSection={<IconLogout size={16} />} onClick={session.signOut}>
						Sign out
					</Menu.Item>
				</Menu.Dropdown>
			</Menu>
		);
	}
	return <SignInButton signIn={session.signIn} />;
}

/**
 * The app header (S31 `header-mobile`; S56 A2 desktop): burger · wordmark ·
 * account. The burger opens the nav drawer on mobile and medium; desktop has
 * no burger because the rail is the navigation. Desktop has no wordmark here either:
 * the rail's sits just left of it (owner, 2026-11-12: "the site logo appears in the top
 * bar and the menu top bar on desktop. The rightmost one should go away on desktop").
 * The wordmark links home, `/` (owner, 2026-11-12: "clicking the logo should go to the
 * home page"). Game routes draw the game top bar instead of this header.
 */
export function AppHeader({
	burger, wordmark, drawerOpened, onBurger,
}: {
	burger: boolean;
	/** Whether the header shows the wordmark: not on desktop, where the rail shows it. */
	wordmark: boolean;
	drawerOpened: boolean;
	onBurger: () => void;
})
{
	return (
		<Group
			component="header"
			h={56}
			px="md"
			justify="space-between"
			wrap="nowrap"
			style={{
				borderBottom: "1px solid var(--mantine-color-dark-4)",
				flexShrink: 0,
			}}
		>
			<Group gap="md" wrap="nowrap">
				{burger ? <Burger opened={drawerOpened} onClick={onBurger} size="sm" aria-label="Open navigation" /> : null}
				{wordmark ? <HomeLink /> : null}
			</Group>
			<AccountControl />
		</Group>
	);
}
