/**
 * Which database a connection string really names (S122 AC 1): the host and database pg
 * connects to, read the way pg reads them, so a query parameter can't make a hosted database
 * look local. Nothing here connects anywhere.
 */
import {
	describe, expect, it,
} from "vitest";
import {
	databaseTarget, isLocalDbHost, localConnectionString,
} from "./local.js";

describe("databaseTarget (S122 AC 1)", () =>
{
	it("production: a ?host= parameter is where pg connects, so it is the host", () =>
	{
		expect(databaseTarget("postgres://u:p@localhost/neondb?host=ep-prod-123.us-east-2.aws.neon.tech&sslmode=require")).toEqual({
			host: "ep-prod-123.us-east-2.aws.neon.tech",
			name: "neondb",
		});
		expect(databaseTarget("postgres://u:p@ep-dev-1-pooler.us-east-2.aws.neon.tech/db?host=ep-prod-123.us-east-2.aws.neon.tech").host).toBe("ep-prod-123.us-east-2.aws.neon.tech");
	});

	it("production: hostaddr is kept, so the guard can refuse a string libpq tools would send elsewhere", () =>
	{
		expect(databaseTarget("postgres://u:p@localhost/db?hostaddr=1.2.3.4")).toEqual({
			host: "localhost",
			name: "db",
			hostaddr: "1.2.3.4",
		});
	});

	it("production: certificate file parameters are never read from disk", () =>
	{
		expect(databaseTarget("postgres://u:p@localhost/db?sslrootcert=/nonexistent&sslcert=/nope&sslkey=/nope")).toEqual({
			host: "localhost",
			name: "db",
		});
	});

	it("names: the database defaults to the user name, as pg's does; no host is an empty host", () =>
	{
		expect(databaseTarget("postgres://bt:pw@[::1]:5432")).toEqual({
			host: "::1",
			name: "bt",
		});
		expect(databaseTarget("postgres://bt:pw@/bt").host).toBe("");
	});
});

describe("localConnectionString (S51, S122)", () =>
{
	it("is wrangler.jsonc's local Hyperdrive string, and its host is local", () =>
	{
		const local = localConnectionString();
		expect(local).toMatch(/^postgres(ql)?:\/\//);
		expect(isLocalDbHost(databaseTarget(local).host)).toBe(true);
	});
});
