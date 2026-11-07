import { MantineProvider } from "@mantine/core";
import {
	cleanup, render, screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import type { Notice } from "./NoticeSlot.js";
import { NoticeSlot } from "./NoticeSlot.js";

afterEach(cleanup);

function renderSlot(notice: Notice | null)
{
	render(
		<MantineProvider>
			<NoticeSlot notice={notice} />
		</MantineProvider>,
	);
}

describe("NoticeSlot (S60; shell-scoreboard A6)", () =>
{
	it("floats the reload notice at the bottom: message on top, then Snooze and Update Now, right-aligned, and no ✕", async () =>
	{
		const onUpdate = vi.fn();
		const onSnooze = vi.fn();
		renderSlot({
			id: "update",
			message: "An update to Baseball Theater is ready.",
			update: {
				onUpdate,
				onSnooze,
			},
		});
		const float = screen.getByTestId("notice-float");
		expect(float.style.position).toBe("fixed");
		expect(float.style.bottom).toContain("safe-area-inset-bottom");
		expect(screen.queryByTestId("notice-slot")).toBeNull();
		expect(screen.getByRole("status")).toHaveTextContent("An update to Baseball Theater is ready.");
		// Snooze first, so Update Now sits at the far right (A6's interpretation).
		expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Snooze", "Update Now"]);
		expect(screen.queryByRole("button", {
			name: "Dismiss",
		})).toBeNull();
		await userEvent.click(screen.getByRole("button", {
			name: "Update Now",
		}));
		expect(onUpdate).toHaveBeenCalledOnce();
		await userEvent.click(screen.getByRole("button", {
			name: "Snooze",
		}));
		expect(onSnooze).toHaveBeenCalledOnce();
	});

	it("renders a message-only banner under the header with no buttons (the offline marker)", () =>
	{
		renderSlot({
			id: "offline",
			message: "You're offline. Scores as of 7:42 PM — 18 min ago.",
		});
		expect(screen.getByTestId("notice-slot")).toBeInTheDocument();
		expect(screen.getByRole("status")).toHaveTextContent("You're offline.");
		expect(screen.queryByRole("button")).toBeNull();
	});

	it("renders nothing without a notice", () =>
	{
		renderSlot(null);
		expect(screen.queryByTestId("notice-slot")).toBeNull();
		expect(screen.queryByTestId("notice-float")).toBeNull();
	});
});
