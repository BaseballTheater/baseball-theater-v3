import type { ReactNode } from "react";
import { lazy, Suspense } from "react";
import {
	Navigate, Route, Routes,
} from "react-router-dom";
import { ViewState } from "./components/ViewState.js";
import { ScoreboardPage } from "./pages/ScoreboardPage.js";
import type { LayoutVariant } from "./layout/variant.js";
import { useAccountDeleted } from "./api/accountDeleted.js";
import { useScoreboardDefaultDate } from "./api/scoreboardDate.js";
import { DeletedAccountPage } from "./pages/settings/DeletedAccountPage.js";
import { useSession } from "./session/session.js";
import { SignInCallback } from "./session/SignInCallback.js";
import { SIGN_IN_CALLBACK_PATH } from "@bt/domain";

/**
 * Signed out on `/settings`: if this browser's account was just deleted, A5's
 * page, once; otherwise off to the scoreboard. The server alone knows (S87's
 * `HttpOnly` cookie), so the page stays empty while it is asked (S79).
 */
function SignedOutSettings()
{
	const { data: deleted, isPending } = useAccountDeleted();
	if (isPending) return null;
	return deleted ? <DeletedAccountPage /> : <Navigate to="/games" replace />;
}

/**
 * Settings are signed-in only (ADR-027). Signed out, the route shows the
 * deleted-account page once after a deletion and otherwise sends you to the
 * scoreboard. While the session is still loading it renders nothing, so a
 * signed-in reload isn't bounced away before the session arrives.
 */
function SignedInOnly({ children }: { children: ReactNode })
{
	const session = useSession();
	if (session.status === "loading") return null;
	if (session.status === "signedOut") return <SignedOutSettings />;
	return children;
}

/**
 * `/` and `/games` open the day the server names (S111): today in season, the last final
 * in the off-season. The URL then names the day, so it can be shared and stepped from.
 */
function DefaultDay()
{
	const date = useScoreboardDefaultDate();
	return date ? <Navigate to={`/games/${date}`} replace /> : <ViewState kind="loading" />;
}

/*
 * Every page past the scoreboard loads on demand, as its own JS chunk (S110; owner,
 * 2026-11-02: "Lazy loading would be better, with chunked JS files."): the first download
 * holds the shell and the scoreboard, the landing page, and stays inside ADR-026's entry
 * budget as the other pages grow. The pages keep named exports; `lazy` takes a default.
 */
const GamePage = lazy(() => import("./pages/GamePage.js").then((m) => ({
	default: m.GamePage,
})));
const StandingsPage = lazy(() => import("./pages/StandingsPage.js").then((m) => ({
	default: m.StandingsPage,
})));
const SearchPage = lazy(() => import("./pages/SearchPage.js").then((m) => ({
	default: m.SearchPage,
})));
const SettingsPage = lazy(() => import("./pages/SettingsPage.js").then((m) => ({
	default: m.SettingsPage,
})));

/**
 * The routes, each page given the pairing the layout host settled (S60). While a page's
 * chunk arrives, the page area shows ViewState's loading treatment (S110), the one every
 * page uses while its data loads, so there is no extra screen.
 */
export function AppRoutes({ variant }: { variant: LayoutVariant })
{
	return (
		<Suspense fallback={<ViewState kind="loading" />}>
			<Routes>
				<Route path="/" element={<DefaultDay />} />
				<Route path="/games" element={<DefaultDay />} />
				<Route path="/games/:date" element={<ScoreboardPage variant={variant} />} />
				<Route path="/game/:gamePk" element={<GamePage variant={variant} />} />
				<Route path="/game/:gamePk/:tab" element={<GamePage variant={variant} />} />
				<Route path="/standings" element={<StandingsPage />} />
				<Route path="/search" element={<SearchPage />} />
				<Route path="/settings" element={<SignedInOnly><SettingsPage variant={variant} /></SignedInOnly>} />
				<Route path={SIGN_IN_CALLBACK_PATH} element={<SignInCallback />} />
			</Routes>
		</Suspense>
	);
}
