/**
 * S70: the Video Player setting picks the host — the dialog by default and for signed-out
 * readers, the stage when chosen — and a change moves the player without a reload.
 */
import type { AccountSettings } from "@bt/domain";
import { MantineProvider } from "@mantine/core";
import {
	act, cleanup, render, screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { resetSettings, setVideoPlayer } from "../../settings/store.js";
import { jsonResponse } from "../../test/jsonResponse.js";
import { PlayerHost } from "./PlayerHost.js";
import type { Video } from "./VideoCard.js";

const clip = (id: string): Video => ({
	id,
	playId: null,
	title: `Clip ${id}`,
	blurb: null,
	duration: "00:00:20",
	imageUrl: null,
	playbackUrl: null,
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	resetSettings();
});

function renderHost(video: Video | null)
{
	return render(
		<MantineProvider>
			<MemoryRouter>
				<PlayerHost video={video} first={clip("first")} onClose={() => undefined} />
			</MemoryRouter>
		</MantineProvider>,
	);
}

describe("PlayerHost", () =>
{
	it("signed out: the house defaults play a chosen clip in the dialog, and nothing shows until one is chosen", async () =>
	{
		resetSettings();
		const { rerender } = renderHost(null);
		expect(screen.queryByTestId("video-player")).toBeNull();
		rerender(
			<MantineProvider>
				<MemoryRouter>
					<PlayerHost video={clip("chosen")} first={clip("first")} onClose={() => undefined} />
				</MemoryRouter>
			</MantineProvider>,
		);
		expect(await screen.findByRole("dialog")).toHaveTextContent("Clip chosen");
	});

	it("host: choosing Stage moves the player out of the dialog onto the stage without a reload, showing the first clip until one is chosen", async () =>
	{
		vi.stubGlobal("fetch", vi.fn(async (request: Request) => jsonResponse(await request.json() as AccountSettings)));
		renderHost(null);
		expect(screen.queryByTestId("video-player")).toBeNull();
		await act(() => setVideoPlayer("stage"));
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(screen.getByRole("region", {
			name: "Video player",
		})).toHaveTextContent("Clip first");
	});

	it("host: on the stage with no clips at all, nothing renders", async () =>
	{
		vi.stubGlobal("fetch", vi.fn(async (request: Request) => jsonResponse(await request.json() as AccountSettings)));
		await act(() => setVideoPlayer("stage"));
		render(
			<MantineProvider>
				<PlayerHost video={null} first={undefined} onClose={() => undefined} />
			</MantineProvider>,
		);
		expect(screen.queryByTestId("video-player")).toBeNull();
	});
});
