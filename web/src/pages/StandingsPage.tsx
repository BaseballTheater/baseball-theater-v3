import { Stack, Title } from "@mantine/core";
import { useSearchParams } from "react-router-dom";
import { useStandings } from "../api/standings.js";
import { ViewState } from "../components/ViewState.js";
import { DivisionTable } from "../components/standings/DivisionTable.js";
import { FooterMeta } from "../layout/FooterMeta.js";

/**
 * Standings (S4; standings-search-settings `standings-mobile` / `-medium` / `-desktop`):
 * the page title, then one `DivisionTable` per division, AL East, Central, West then the
 * NL's, in one column at every pairing (it widens with the host; the team column takes the
 * width). The day is `?date=` when the URL names one, else the server's today. Loading,
 * empty and error are `ViewState`'s generic treatment (VISUAL-DESIGN §6).
 */
export function StandingsPage()
{
	const [params] = useSearchParams();
	const {
		data: standings, error, refetch,
	} = useStandings(params.get("date") ?? undefined);

	let body;
	// As the scoreboard: a failed refetch keeps the tables already shown (S28).
	if (error && !standings)
	{
		body = <ViewState kind="error" title="Couldn't load standings" onRetry={() => void refetch()} />;
	}
	else if (!standings)
	{
		body = <ViewState kind="loading" />;
	}
	else if (standings.divisions.length === 0)
	{
		body = <ViewState kind="empty" message="No standings for this date." />;
	}
	else
	{
		body = (
			<>
				{standings.divisions.map((division) => <DivisionTable key={division.divisionId ?? division.name} division={division} />)}
				<FooterMeta fetchedAt={standings.fetchedAt} />
			</>
		);
	}

	return (
		<Stack gap="xl">
			<Title order={1}>Standings</Title>
			{body}
		</Stack>
	);
}
