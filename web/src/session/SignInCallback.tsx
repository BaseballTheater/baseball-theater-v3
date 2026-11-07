import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ViewState } from "../components/ViewState.js";
import { useSession } from "./session.js";

/**
 * Where Logto sends the browser back after its hosted sign-in (S116, `SIGN_IN_CALLBACK_PATH`).
 * It draws nothing new: the app's loading state while the ID token goes to BT once
 * (`Session.finishSignIn`), then back to the page the sign-in started from. A sign-in that
 * fails (a refused token, a stale callback) lands on `/`, signed out, where "Sign in" starts over.
 */
export function SignInCallback()
{
	const session = useSession();
	const navigate = useNavigate();
	const { finishSignIn } = session;

	useEffect(() =>
	{
		let current = true;
		finishSignIn(location.href).then((returnTo) =>
		{
			if (current) void navigate(returnTo, {
				replace: true,
			});
		}, () =>
		{
			if (current) void navigate("/", {
				replace: true,
			});
		});
		return () =>
		{
			current = false;
		};
	}, [finishSignIn, navigate]);

	return <ViewState kind="loading" />;
}
