/**
 * The 30 MLB clubs as the Stats API names them (team `id`, `abbreviation`, `teamName` and `name`,
 * checked against the committed fixtures on 2026-10-24: Arizona is `AZ`, the
 * Athletics `ATH`). The one list the Favorite Teams dropdown (S6) and anything
 * else that offers every team reads; team colors (S61) key off the same `id`.
 */
export interface MlbTeam
{
	id: number;
	abbreviation: string;
	/** The club name without its city, as the Stats API's `teamName`. */
	name: string;
	/**
	 * The city and club, as the Stats API's team `name` ("Chicago Cubs"; the Athletics are
	 * just "Athletics" since their move). The Favorite Teams dropdown lists teams by it, while
	 * the chosen ones read `name` (owner, 2026-11-12: "the favorite team setting should use the
	 * city team name long form in the dropdown (Chicago Cubs) but the team name only in the
	 * selected list (Cubs)").
	 */
	fullName: string;
}

export const MLB_TEAMS: readonly MlbTeam[] = [
	{
		id: 109,
		abbreviation: "AZ",
		name: "D-backs",
		fullName: "Arizona Diamondbacks",
	},
	{
		id: 144,
		abbreviation: "ATL",
		name: "Braves",
		fullName: "Atlanta Braves",
	},
	{
		id: 110,
		abbreviation: "BAL",
		name: "Orioles",
		fullName: "Baltimore Orioles",
	},
	{
		id: 111,
		abbreviation: "BOS",
		name: "Red Sox",
		fullName: "Boston Red Sox",
	},
	{
		id: 112,
		abbreviation: "CHC",
		name: "Cubs",
		fullName: "Chicago Cubs",
	},
	{
		id: 145,
		abbreviation: "CWS",
		name: "White Sox",
		fullName: "Chicago White Sox",
	},
	{
		id: 113,
		abbreviation: "CIN",
		name: "Reds",
		fullName: "Cincinnati Reds",
	},
	{
		id: 114,
		abbreviation: "CLE",
		name: "Guardians",
		fullName: "Cleveland Guardians",
	},
	{
		id: 115,
		abbreviation: "COL",
		name: "Rockies",
		fullName: "Colorado Rockies",
	},
	{
		id: 116,
		abbreviation: "DET",
		name: "Tigers",
		fullName: "Detroit Tigers",
	},
	{
		id: 117,
		abbreviation: "HOU",
		name: "Astros",
		fullName: "Houston Astros",
	},
	{
		id: 118,
		abbreviation: "KC",
		name: "Royals",
		fullName: "Kansas City Royals",
	},
	{
		id: 108,
		abbreviation: "LAA",
		name: "Angels",
		fullName: "Los Angeles Angels",
	},
	{
		id: 119,
		abbreviation: "LAD",
		name: "Dodgers",
		fullName: "Los Angeles Dodgers",
	},
	{
		id: 146,
		abbreviation: "MIA",
		name: "Marlins",
		fullName: "Miami Marlins",
	},
	{
		id: 158,
		abbreviation: "MIL",
		name: "Brewers",
		fullName: "Milwaukee Brewers",
	},
	{
		id: 142,
		abbreviation: "MIN",
		name: "Twins",
		fullName: "Minnesota Twins",
	},
	{
		id: 121,
		abbreviation: "NYM",
		name: "Mets",
		fullName: "New York Mets",
	},
	{
		id: 147,
		abbreviation: "NYY",
		name: "Yankees",
		fullName: "New York Yankees",
	},
	{
		id: 133,
		abbreviation: "ATH",
		name: "Athletics",
		fullName: "Athletics",
	},
	{
		id: 143,
		abbreviation: "PHI",
		name: "Phillies",
		fullName: "Philadelphia Phillies",
	},
	{
		id: 134,
		abbreviation: "PIT",
		name: "Pirates",
		fullName: "Pittsburgh Pirates",
	},
	{
		id: 135,
		abbreviation: "SD",
		name: "Padres",
		fullName: "San Diego Padres",
	},
	{
		id: 137,
		abbreviation: "SF",
		name: "Giants",
		fullName: "San Francisco Giants",
	},
	{
		id: 136,
		abbreviation: "SEA",
		name: "Mariners",
		fullName: "Seattle Mariners",
	},
	{
		id: 138,
		abbreviation: "STL",
		name: "Cardinals",
		fullName: "St. Louis Cardinals",
	},
	{
		id: 139,
		abbreviation: "TB",
		name: "Rays",
		fullName: "Tampa Bay Rays",
	},
	{
		id: 140,
		abbreviation: "TEX",
		name: "Rangers",
		fullName: "Texas Rangers",
	},
	{
		id: 141,
		abbreviation: "TOR",
		name: "Blue Jays",
		fullName: "Toronto Blue Jays",
	},
	{
		id: 120,
		abbreviation: "WSH",
		name: "Nationals",
		fullName: "Washington Nationals",
	},
];
