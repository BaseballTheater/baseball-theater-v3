import { useEffect } from "react";
import { useSession } from "../session/session.js";
import { hydrateSettings, resetSettings } from "./store.js";

/**
 * Ties the settings store to the session (ADR-027): signed in, it reads the
 * account's settings; signed out, it puts the house defaults back. It runs
 * again when the signed-in account changes without the status changing (a
 * sign-in as someone else, S120), and the store resets before reading the new
 * account's. Renders nothing; mounted once inside `SessionProvider`.
 */
export function SettingsSync(): null
{
	const session = useSession();
	const { status } = session;
	const uid = session.status === "signedIn" ? session.account.uid : null;
	useEffect(() =>
	{
		if (uid !== null) hydrateSettings(uid).catch(() => undefined);
		if (status === "signedOut") resetSettings();
	}, [status, uid]);
	return null;
}
