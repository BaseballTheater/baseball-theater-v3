/**
 * S116 AC 3: the callback route draws the app's loading state, finishes the sign-in once and
 * returns to where it started; a failed one lands on `/`.
 */
import { MantineProvider } from "@mantine/core";
import {
	cleanup, render, screen, waitFor,
} from "@testing-library/react";
import {
	MemoryRouter, Route, Routes, useLocation,
} from "react-router-dom";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import type { Session } from "./session.js";
import { SessionContext } from "./session.js";
import { SignInCallback } from "./SignInCallback.js";

function CurrentPath()
{
	return <output aria-label="path">{useLocation().pathname}</output>;
}

function renderCallback(finishSignIn: Session["finishSignIn"])
{
	const session: Session = {
		status: "signedOut",
		signIn: vi.fn(),
		finishSignIn,
		signOut: vi.fn(),
	};
	render(
		<MantineProvider>
			<SessionContext.Provider value={session}>
				<MemoryRouter initialEntries={["/sign-in/callback?code=c"]}>
					<Routes>
						<Route path="/sign-in/callback" element={<SignInCallback />} />
						<Route path="*" element={<CurrentPath />} />
					</Routes>
				</MemoryRouter>
			</SessionContext.Provider>
		</MantineProvider>,
	);
}

afterEach(cleanup);

describe("SignInCallback (S116)", () =>
{
	it("S116 AC 3: shows the loading state, hands off the callback and returns to where sign-in started", async () =>
	{
		let finish: (path: string) => void = () => undefined;
		const finishSignIn = vi.fn(() => new Promise<string>((resolve) =>
		{
			finish = resolve;
		}));
		renderCallback(finishSignIn);
		expect(screen.getByLabelText("Loading")).toBeTruthy();
		expect(finishSignIn).toHaveBeenCalledWith(location.href);
		finish("/settings");
		await waitFor(() => expect(screen.getByLabelText("path").textContent).toBe("/settings"));
	});

	it("S116 AC 3: a sign-in that fails lands on /, signed out", async () =>
	{
		renderCallback(vi.fn(async () =>
		{
			throw new Error("sign_in_refused");
		}));
		await waitFor(() => expect(screen.getByLabelText("path").textContent).toBe("/"));
	});
});
