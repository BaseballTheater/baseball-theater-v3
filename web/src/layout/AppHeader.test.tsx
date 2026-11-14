import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	act, cleanup, render, screen, waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import { createQueryClient } from "../api/queryClient.js";
import type { Session } from "../session/session.js";
import { DEV_SIGN_IN_TOKEN, SessionContext } from "../session/session.js";
import { SessionProvider } from "../session/SessionProvider.js";
import { getSessionToken, setSessionToken } from "../session/token.js";
import { stubMeApi } from "../test/meApi.js";
import { AppHeader } from "./AppHeader.js";

beforeEach(() =>
{
	setSessionToken(null);
	stubMeApi();
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
});

function CurrentPath()
{
	return <output aria-label="path">{useLocation().pathname}</output>;
}

/** The header on `/games/2024-07-04`, under the real session provider. */
function renderHeader(wordmark = true)
{
	render(
		<MantineProvider>
			<QueryClientProvider client={createQueryClient()}>
				<SessionProvider>
					<MemoryRouter initialEntries={["/games/2024-07-04"]}>
						<AppHeader burger wordmark={wordmark} drawerOpened={false} onBurger={() => undefined} />
						<CurrentPath />
					</MemoryRouter>
				</SessionProvider>
			</QueryClientProvider>
		</MantineProvider>,
	);
}

describe("AppHeader Figma values (S83)", () =>
{
	it("Figma: signed out, 'Sign in' is 14px Light beside the account icon", async () =>
	{
		renderHeader();
		const signIn = await screen.findByText("Sign in");
		expect(signIn.style.fontSize).toMatch(/14px|calc\(0\.875rem/);
		expect(signIn.style.color).toBe("var(--bt-light)");
	});
});

describe("AppHeader wordmark (owner, 2026-11-12)", () =>
{
	it("the wordmark links home, to /", async () =>
	{
		renderHeader();
		const home = screen.getByRole("link", {
			name: "Baseball Theater home",
		});
		expect(home).toHaveAttribute("href", "/");
		await userEvent.click(home);
		expect(screen.getByLabelText("path")).toHaveTextContent(/^\/$/);
	});

	it("without `wordmark` (desktop, where the rail shows it) the header draws none", () =>
	{
		renderHeader(false);
		expect(screen.queryByRole("img", {
			name: "Baseball Theater",
		})).toBeNull();
	});
});

describe("AppHeader sign-in feedback (owner, 2026-11-12: \"clicking sign in gives no feedback\")", () =>
{
	/** A session whose `signIn` waits on the returned promise's resolvers, as Logto's SDK load and redirect do. */
	function renderWithSignIn(signIn: Session["signIn"])
	{
		const session: Session = {
			status: "signedOut",
			signIn,
			finishSignIn: () => Promise.resolve("/"),
			signOut: () => undefined,
		};
		render(
			<MantineProvider>
				<SessionContext.Provider value={session}>
					<MemoryRouter>
						<AppHeader burger wordmark drawerOpened={false} onBurger={() => undefined} />
					</MemoryRouter>
				</SessionContext.Provider>
			</MantineProvider>,
		);
	}

	it("pressing Sign in turns it into a disabled, busy \"Signing in…\" with a spinner while sign-in starts", async () =>
	{
		const signIn = vi.fn(() => new Promise<boolean>(() => undefined));
		renderWithSignIn(signIn);
		await userEvent.click(screen.getByRole("button", {
			name: "Sign in",
		}));
		const pending = screen.getByRole("button", {
			name: "Signing in…",
		});
		expect(pending).toBeDisabled();
		expect(pending).toHaveAttribute("aria-busy", "true");
		expect(pending.querySelector(".mantine-Loader-root")).not.toBeNull();
		await userEvent.click(pending);
		expect(signIn).toHaveBeenCalledTimes(1);
	});

	it("a sign-in leaving for Logto keeps \"Signing in…\" until the page goes", async () =>
	{
		renderWithSignIn(async () => true);
		await userEvent.click(screen.getByRole("button", {
			name: "Sign in",
		}));
		await Promise.resolve();
		expect(screen.getByRole("button", {
			name: "Signing in…",
		})).toBeDisabled();
	});

	it("a sign-in that ends without leaving the page (no Logto in this build, or the dev sign-in) puts the button back", async () =>
	{
		renderWithSignIn(async () => false);
		await userEvent.click(screen.getByRole("button", {
			name: "Sign in",
		}));
		expect(await screen.findByRole("button", {
			name: "Sign in",
		})).toBeEnabled();
	});

	it("coming Back from Logto out of the back/forward cache puts the button back", async () =>
	{
		renderWithSignIn(() => new Promise<boolean>(() => undefined));
		await userEvent.click(screen.getByRole("button", {
			name: "Sign in",
		}));
		expect(screen.getByRole("button", {
			name: "Signing in…",
		})).toBeDisabled();
		act(() =>
		{
			window.dispatchEvent(Object.assign(new Event("pageshow"), {
				persisted: true,
			}));
		});
		expect(screen.getByRole("button", {
			name: "Sign in",
		})).toBeEnabled();
	});

	it("signed in while a sign-in was still pending, then signed out: a fresh, enabled \"Sign in\"", async () =>
	{
		const signIn = vi.fn(() => new Promise<boolean>(() => undefined));
		let setStatus: (status: "signedIn" | "signedOut") => void = () => undefined;
		function Host()
		{
			const [status, set] = useState<"signedIn" | "signedOut">("signedOut");
			setStatus = set;
			const session = (status === "signedIn" ? {
				status,
				account: {} as never,
				signIn,
				finishSignIn: () => Promise.resolve("/"),
				signOut: () => set("signedOut"),
			} : {
				status,
				signIn,
				finishSignIn: () => Promise.resolve("/"),
				signOut: () => undefined,
			}) satisfies Session;
			return (
				<SessionContext.Provider value={session}>
					<MemoryRouter>
						<AppHeader burger wordmark drawerOpened={false} onBurger={() => undefined} />
					</MemoryRouter>
				</SessionContext.Provider>
			);
		}
		render(
			<MantineProvider>
				<Host />
			</MantineProvider>,
		);
		await userEvent.click(screen.getByRole("button", {
			name: "Sign in",
		}));
		act(() => setStatus("signedIn"));
		await userEvent.click(screen.getByRole("button", {
			name: "Account",
		}));
		await userEvent.click(await screen.findByRole("menuitem", {
			name: "Sign out",
		}));
		expect(await screen.findByRole("button", {
			name: "Sign in",
		})).toBeEnabled();
		expect(screen.queryByText("Signing in…")).toBeNull();
	});

	it("a sign-in that fails to start puts the button back", async () =>
	{
		renderWithSignIn(() => Promise.reject(new Error("Logto unreachable")));
		await userEvent.click(screen.getByRole("button", {
			name: "Sign in",
		}));
		expect(await screen.findByRole("button", {
			name: "Sign in",
		})).toBeEnabled();
	});
});

describe("AppHeader account menu (owner, 2026-11-12: \"Settings, Sign Out\")", () =>
{
	it("signed in, the account icon opens a menu with Settings and Sign out", async () =>
	{
		setSessionToken(DEV_SIGN_IN_TOKEN);
		renderHeader();
		await userEvent.click(await screen.findByRole("button", {
			name: "Account",
		}));
		const settings = await screen.findByRole("menuitem", {
			name: "Settings",
		});
		expect(settings).toHaveAttribute("href", "/settings");
		expect(screen.getByRole("menuitem", {
			name: "Sign out",
		})).toBeInTheDocument();
		await userEvent.click(settings);
		expect(screen.getByLabelText("path")).toHaveTextContent(/^\/settings$/);
	});

	it("Sign out in the menu ends the session: the header offers Sign in again", async () =>
	{
		setSessionToken(DEV_SIGN_IN_TOKEN);
		renderHeader();
		await userEvent.click(await screen.findByRole("button", {
			name: "Account",
		}));
		await userEvent.click(await screen.findByRole("menuitem", {
			name: "Sign out",
		}));
		expect(await screen.findByRole("button", {
			name: "Sign in",
		})).toBeInTheDocument();
		await waitFor(() => expect(getSessionToken()).toBeNull());
	});
});
