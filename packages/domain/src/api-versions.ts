/**
 * The BT API's version lifecycle (ADR-015, S28): the one place that says, for each
 * `/api/<version>/` prefix, whether it is served normally, served with a warning, or
 * retired. A version moves supported → deprecated → sunset; it is retired only once the
 * per-version usage log shows no traffic (README "API versions"). Lifecycle is data: tests
 * drive the handler with their own table rather than a real second version.
 */

/** A served version, a warned one (with when it was deprecated and when it will retire), or a retired one. */
export type ApiVersionState =
	| { status: "supported" }
	| { status: "deprecated";
		/** `YYYY-MM-DD` the version was deprecated (the `Deprecation` header). */
		deprecatedOn: string;
		/** `YYYY-MM-DD` it stops being served (the `Sunset` header). */
		sunsetOn: string; }
	| { status: "sunset";
		/** `YYYY-MM-DD` it stopped being served. */
		sunsetOn: string; };

export type ApiVersionTable = Readonly<Record<string, ApiVersionState>>;

/** Every version the API has published. Today only v1, which is current. */
export const API_VERSIONS: ApiVersionTable = {
	v1: {
		status: "supported",
	},
};

/** The version a path asks for: `/api/v1/schedule` → `"v1"`; null outside `/api/<version>/`. */
export function apiVersionOf(pathname: string): string | null
{
	return /^\/api\/(v\d+)(?:\/|$)/.exec(pathname)?.[1] ?? null;
}

/**
 * The headers a deprecated version's answers carry (RFC 9745 `Deprecation: @<epoch seconds>`,
 * RFC 8594 `Sunset: <HTTP-date>`); none for any other state.
 */
export function deprecationHeaders(state: ApiVersionState): Record<string, string>
{
	if (state.status !== "deprecated") return {};
	const deprecated = Date.parse(`${state.deprecatedOn}T00:00:00Z`);
	return {
		Deprecation: `@${Math.floor(deprecated / 1000)}`,
		Sunset: new Date(`${state.sunsetOn}T00:00:00Z`).toUTCString(),
	};
}
