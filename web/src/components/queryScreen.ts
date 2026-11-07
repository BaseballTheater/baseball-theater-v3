/** What a page shows for one query: its data, `ViewState`'s loading treatment, or its error room. */
export type QueryScreen = "data" | "loading" | "error";

/**
 * The one "keep what's on screen" rule (S28; ADR-025) the Scoreboard, Standings and Game pages
 * share: data already loaded stays shown even when a later refetch fails (a retired version's
 * 426 raises the update notice over it, a dropped connection leaves it readable; VISUAL-DESIGN
 * D7). The error room is only for a query that has never had data; with neither data nor an
 * error, it is still loading. Assumes TanStack Query's shape, where `data` keeps the last
 * success while `error` holds the latest failure.
 */
export function queryScreen(query: { data: unknown;
	error: unknown; }): QueryScreen
{
	if (query.data !== undefined && query.data !== null) return "data";
	return query.error ? "error" : "loading";
}
