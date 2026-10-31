import { ApiRoutes } from "@bt/domain";
import {
	describe, expect, it,
} from "vitest";
import {
	API_ROUTER, STREAMING_ROUTE_EXCEPTIONS, routeTableMismatches,
} from "./api.js";

/**
 * S44: the routes the API dispatches and the `ApiRoutes` contract must be the
 * same set, so a route can't ship outside the typed contract (frame-00 item
 * "do not let a third route land before deciding").
 */
describe("route table", () =>
{
	const declared = Object.keys(ApiRoutes);

	it("dispatches exactly the ApiRoutes keys, apart from named streaming exceptions", () =>
	{
		expect(routeTableMismatches(API_ROUTER, declared, STREAMING_ROUTE_EXCEPTIONS)).toEqual([]);
	});

	it("fails when the router dispatches an undeclared route", () =>
	{
		const router = [...API_ROUTER, {
			route: "GET /api/v1/undeclared",
		}];
		expect(routeTableMismatches(router, declared, STREAMING_ROUTE_EXCEPTIONS)).toEqual([
			"dispatched but not in ApiRoutes: GET /api/v1/undeclared",
		]);
	});

	it("fails when a declared route is not dispatched", () =>
	{
		const router = API_ROUTER.filter((r) => r.route !== "GET /api/v1/schedule");
		expect(routeTableMismatches(router, declared, STREAMING_ROUTE_EXCEPTIONS)).toEqual([
			"in ApiRoutes but not dispatched: GET /api/v1/schedule",
		]);
	});

	it("allows an undeclared route only when it is a named streaming exception", () =>
	{
		const router = [...API_ROUTER, {
			route: "GET /api/v1/live",
		}];
		expect(routeTableMismatches(router, declared, [...STREAMING_ROUTE_EXCEPTIONS, "GET /api/v1/live"])).toEqual([]);
		expect(routeTableMismatches(router, declared, STREAMING_ROUTE_EXCEPTIONS)).not.toEqual([]);
	});
});
