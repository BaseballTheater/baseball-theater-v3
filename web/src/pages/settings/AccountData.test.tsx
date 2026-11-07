/**
 * Download and delete your data (S79), against standings-search-settings A4: the
 * ways in, the stored download and its refusals, the delete dialog with its
 * phrase, warning, re-sign-in and failure states, and what follows a deletion.
 * The API is a stubbed `fetch` answering the way the server does (S77, S80).
 */
import type { AccountSettings } from "@bt/domain";
import { ACCOUNT_DELETION_PHRASE, DEFAULT_SETTINGS } from "@bt/domain";
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import {
	act, cleanup, render, screen, waitFor, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import { createQueryClient } from "../../api/queryClient.js";
import { AppShellLayout } from "../../layout/AppShellLayout.js";
import type { LayoutVariant } from "../../layout/variant.js";
import { AppRoutes } from "../../routes.js";
import type { Session } from "../../session/session.js";
import { DEV_SIGN_IN_TOKEN, SessionContext } from "../../session/session.js";
import { SessionProvider } from "../../session/SessionProvider.js";
import { getSessionToken, setSessionToken } from "../../session/token.js";
import { readStored } from "../../storage/storage.js";
import { jsonResponse } from "../../test/jsonResponse.js";
import { DEV_ACCOUNT } from "../../test/meApi.js";
import { AccountData } from "./AccountData.js";

const DOWNLOAD = {
	id: "dl-1",
	expiresAt: "2026-11-11T12:00:00.000Z",
};

interface Api
{
	current?: typeof DOWNLOAD | null;
	request?: "ready" | "limit" | "fail" | "pending";
	del?: "ok" | "reauth" | "fail" | "pending";
	/** The server's deletion cookie (S87): the first signed-out /me answers account_deleted. */
	deletedOnce?: boolean;
}

/** The server as S77/S80 answer it, recording each request. */
function stubApi(api: Api = {}): { calls: { method: string;
	path: string;
	body: unknown;
	auth: boolean; }[]; }
{
	const calls: { method: string;
		path: string;
		body: unknown;
		auth: boolean; }[] = [];
	let current = api.current ?? null;
	let deletedPending = api.deletedOnce ?? false;
	vi.stubGlobal("fetch", vi.fn(async (request: Request) =>
	{
		const { pathname } = new URL(request.url);
		const body = request.method === "POST" ? await request.clone().text().then((t) => (t ? JSON.parse(t) as unknown : null)) : null;
		const auth = request.headers.has("Authorization");
		calls.push({
			method: request.method,
			path: pathname,
			body,
			auth,
		});
		if (pathname === "/api/v1/me" && !auth)
		{
			const answer = deletedPending ? "account_deleted" : "unauthorized";
			deletedPending = false;
			return jsonResponse({
				error: answer,
			}, 401);
		}
		if (pathname === "/api/v1/me") return jsonResponse(DEV_ACCOUNT);
		if (pathname === "/api/v1/me/settings") return jsonResponse(DEFAULT_SETTINGS satisfies AccountSettings);
		if (pathname === "/api/v1/me/download" && request.method === "GET") return current ? jsonResponse(current) : jsonResponse({
			error: "not_found",
		}, 404);
		if (pathname === "/api/v1/me/download")
		{
			if (api.request === "pending") return new Promise<Response>(() => undefined);
			if (api.request === "limit") return jsonResponse({
				error: "download_limit",
				nextAllowedAt: "2026-10-28T15:15:00.000Z",
			}, 429);
			if (api.request === "fail") return jsonResponse({
				error: "unavailable",
			}, 503);
			current = DOWNLOAD;
			return jsonResponse(DOWNLOAD);
		}
		if (pathname === `/api/v1/me/download/${DOWNLOAD.id}`) return jsonResponse({
			...DOWNLOAD,
			stores: {
				"BT database: users": [],
			},
		});
		if (pathname === "/api/v1/me/delete")
		{
			if (api.del === "pending") return new Promise<Response>(() => undefined);
			if (api.del === "reauth") return jsonResponse({
				error: "reauth_required",
			}, 403);
			if (api.del === "fail") return jsonResponse({
				error: "unavailable",
			}, 500);
			return jsonResponse({
				deleted: true,
			});
		}
		return new Promise<Response>(() => undefined);
	}));
	return {
		calls,
	};
}

/** A signed-in session whose sign-in and sign-out are spies. */
function signedIn(): Session
{
	return {
		status: "signedIn",
		account: DEV_ACCOUNT as never,
		signIn: vi.fn(() => Promise.resolve()),
		finishSignIn: vi.fn(() => Promise.resolve("/")),
		signOut: vi.fn(),
	};
}

function renderData(variant: LayoutVariant = "mobile", session: Session = signedIn()): { session: Session;
	client: QueryClient; }
{
	const client = createQueryClient();
	render(
		<MantineProvider>
			<QueryClientProvider client={client}>
				<SessionContext.Provider value={session}>
					<MemoryRouter>
						<AccountData variant={variant} />
					</MemoryRouter>
				</SessionContext.Provider>
			</QueryClientProvider>
		</MantineProvider>,
	);
	return {
		session,
		client,
	};
}

function link(name: string | RegExp): HTMLElement
{
	return screen.getByRole("button", {
		name,
	});
}

async function openDelete(): Promise<HTMLElement>
{
	await userEvent.click(await screen.findByRole("button", {
		name: "Delete account",
	}));
	return screen.findByRole("dialog");
}

beforeEach(() =>
{
	URL.createObjectURL = vi.fn(() => "blob:test");
	URL.revokeObjectURL = vi.fn();
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	setSessionToken(null);
});

describe("Account ways in (A4 settings-data-*)", () =>
{
	for (const variant of ["mobile", "desktop"] as const)
	{
		it(`ways in: Download your data and Delete account at ${variant}`, async () =>
		{
			stubApi();
			renderData(variant);
			expect(await screen.findByRole("button", {
				name: "Download your data",
			})).toBeInTheDocument();
			expect(link("Delete account")).toBeInTheDocument();
		});
	}

	it("ways in: signed out, neither shows", () =>
	{
		stubApi();
		renderData("mobile", {
			status: "signedOut",
			signIn: vi.fn(),
			finishSignIn: vi.fn(),
			signOut: vi.fn(),
		});
		expect(screen.queryByRole("button", {
			name: "Delete account",
		})).toBeNull();
	});
});

describe("download (A4 settings-download-*)", () =>
{
	it("download: requesting shows the stored download with its expiry, the emailed clause and its link", async () =>
	{
		const { calls } = stubApi({
			request: "ready",
		});
		renderData();
		await userEvent.click(await screen.findByRole("button", {
			name: "Download your data",
		}));
		expect(await screen.findByText(/Your data download is ready\. It's kept until Nov 1[01], 2026, and we emailed you the link too\./)).toBeInTheDocument();
		expect(calls.some((c) => c.method === "POST" && c.path === "/api/v1/me/download")).toBe(true);

		await userEvent.click(link("Download your data (JSON)"));
		await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledOnce());
		expect(calls.some((c) => c.path === `/api/v1/me/download/${DOWNLOAD.id}`)).toBe(true);
	});

	it("download: the link is disabled while the request is in flight", async () =>
	{
		stubApi({
			request: "pending",
		});
		renderData();
		const request = await screen.findByRole("button", {
			name: "Download your data",
		});
		await waitFor(() => expect(request).toBeEnabled());
		await userEvent.click(request);
		expect(request).toBeDisabled();
	});

	it("download: a request refused by the 24-hour limit shows when the next is allowed", async () =>
	{
		stubApi({
			current: DOWNLOAD,
			request: "limit",
		});
		renderData();
		await userEvent.click(await screen.findByRole("button", {
			name: "Request a new download",
		}));
		expect(await screen.findByText(/You've requested two downloads in the last 24 hours\. You can request another at \d{1,2}:15\s?[AP]M\./)).toBeInTheDocument();
	});

	it("download: a failed request shows the red error lines", async () =>
	{
		stubApi({
			request: "fail",
		});
		renderData();
		await userEvent.click(await screen.findByRole("button", {
			name: "Download your data",
		}));
		const alert = await screen.findByRole("alert");
		expect(alert).toHaveTextContent("Couldn't request your download");
		expect(alert).toHaveTextContent("Check your connection and try again.");
	});
});

describe("delete dialog (A4 settings-delete-*)", () =>
{
	it("delete dialog: Delete account stays unavailable until the phrase matches, then sends only the phrase", async () =>
	{
		const { calls } = stubApi({
			del: "pending",
		});
		renderData();
		const dialog = within(await openDelete());
		const remove = dialog.getByRole("button", {
			name: "Delete account",
		});
		expect(remove).toBeDisabled();
		await userEvent.type(dialog.getByLabelText("Confirmation phrase"), "delete my accoun");
		expect(remove).toBeDisabled();
		await userEvent.type(dialog.getByLabelText("Confirmation phrase"), "t");
		expect(remove).toBeEnabled();
		await userEvent.click(remove);
		// In flight: unavailable until the server answers.
		expect(remove).toBeDisabled();
		const sent = calls.find((c) => c.path === "/api/v1/me/delete");
		expect(sent?.body).toEqual({
			phrase: ACCOUNT_DELETION_PHRASE,
		});
		// No download first: nothing requested one.
		expect(calls.some((c) => c.method === "POST" && c.path === "/api/v1/me/download")).toBe(false);
	});

	it("delete dialog: while a download lasts, its warning's Download your data first saves the file and keeps the dialog open", async () =>
	{
		stubApi({
			current: DOWNLOAD,
		});
		renderData();
		const dialog = within(await openDelete());
		expect(await dialog.findByText(/Your data download, kept until Nov 1[01], 2026, is deleted with your account\./)).toBeInTheDocument();
		await userEvent.click(dialog.getByRole("button", {
			name: "Download your data first",
		}));
		await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledOnce());
		expect(screen.getByRole("dialog")).toBeInTheDocument();
	});

	it("delete dialog: 440px wide at desktop", async () =>
	{
		stubApi();
		renderData("desktop");
		const dialog = await openDelete();
		const root = dialog.closest("[style*='--modal-size']") as HTMLElement | null;
		expect(root?.getAttribute("style") ?? "").toMatch(/--modal-size:\s*(calc\(27\.5rem|440px)/);
	});
});

describe("re-sign-in (A4 settings-delete-reauth-mobile)", () =>
{
	it("re-sign-in: a reauth_required refusal shows the prompt, whose button calls signIn()", async () =>
	{
		stubApi({
			del: "reauth",
		});
		const { session } = renderData();
		const dialog = within(await openDelete());
		await userEvent.type(dialog.getByLabelText("Confirmation phrase"), ACCOUNT_DELETION_PHRASE);
		await userEvent.click(dialog.getByRole("button", {
			name: "Delete account",
		}));
		expect(await screen.findByText("Sign in again to delete")).toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", {
			name: "Sign in again",
		}));
		expect(session.signIn).toHaveBeenCalledOnce();
	});
});

describe("failed deletion (A4 settings-delete-failed-mobile)", () =>
{
	it("failed deletion: Try again resends, and the support message shows on every failure", async () =>
	{
		const { calls } = stubApi({
			del: "fail",
		});
		renderData();
		const dialog = within(await openDelete());
		await userEvent.type(dialog.getByLabelText("Confirmation phrase"), ACCOUNT_DELETION_PHRASE);
		await userEvent.click(dialog.getByRole("button", {
			name: "Delete account",
		}));
		expect(await dialog.findByRole("alert")).toHaveTextContent("Couldn't finish deleting your account");
		expect(dialog.getByRole("link", {
			name: "support@baseball.theater",
		})).toHaveAttribute("href", "mailto:support@baseball.theater");

		await userEvent.click(dialog.getByRole("button", {
			name: "Try again",
		}));
		await waitFor(() => expect(calls.filter((c) => c.path === "/api/v1/me/delete")).toHaveLength(2));
		expect(await dialog.findByRole("link", {
			name: "support@baseball.theater",
		})).toBeInTheDocument();
	});
});

describe("after deletion (A5 settings-deleted-*)", () =>
{
	function Path(): ReactNode
	{
		return <output aria-label="path">{useLocation().pathname}</output>;
	}

	it("after deletion: signed out, personal keys and account queries gone, and /settings shows A5's page", async () =>
	{
		const { calls } = stubApi({
			del: "ok",
			deletedOnce: true,
		});
		setSessionToken(DEV_SIGN_IN_TOKEN);
		const client = createQueryClient();
		render(
			<MantineProvider>
				<QueryClientProvider client={client}>
					<SessionProvider>
						<MemoryRouter initialEntries={["/settings"]}>
							<AppShellLayout>{(variant) => <AppRoutes variant={variant} />}</AppShellLayout>
							<Path />
						</MemoryRouter>
					</SessionProvider>
				</QueryClientProvider>
			</MantineProvider>,
		);
		const dialog = within(await openDelete());
		await userEvent.type(dialog.getByLabelText("Confirmation phrase"), ACCOUNT_DELETION_PHRASE);
		await act(async () =>
		{
			await userEvent.click(dialog.getByRole("button", {
				name: "Delete account",
			}));
		});

		expect(await screen.findByText("Your account and your data are deleted.")).toBeInTheDocument();
		expect(screen.getByLabelText("path")).toHaveTextContent(/^\/settings$/);
		// No dismiss, no action on the page.
		expect(within(screen.getByRole("main")).queryByRole("button")).toBeNull();
		expect(getSessionToken()).toBeNull();
		expect(readStored("bt.session")).toBeNull();
		expect(client.getQueryCache().findAll({
			queryKey: ["account"],
		})).toHaveLength(0);
		// The signed-out /me asked once, with no session.
		expect(calls.filter((c) => c.path === "/api/v1/me" && !c.auth)).toHaveLength(1);
	});
});
