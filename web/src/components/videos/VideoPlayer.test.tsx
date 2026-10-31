/**
 * S70: the one video player and its dialog — the MLBAM disclaimer, closing on ✕ and Esc,
 * Space to play and pause, and the link to the clip's game.
 */
import { MantineProvider } from "@mantine/core";
import {
	cleanup, fireEvent, render, screen, waitFor, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import { PlayerDialog } from "./PlayerDialog.js";
import type { Video } from "./VideoCard.js";
import { VideoPlayer } from "./VideoPlayer.js";

const VIDEO: Video = {
	id: "conine-hr",
	playId: null,
	title: "Griffin Conine's two-run homer",
	blurb: null,
	duration: "00:00:48",
	imageUrl: null,
	playbackUrl: "https://example.test/clip.mp4",
};

/** jsdom has no media playback: play / pause flip `paused` and fire the events a browser would. */
beforeEach(() =>
{
	let paused = true;
	vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockImplementation(() => paused);
	vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement)
	{
		paused = false;
		this.dispatchEvent(new Event("play"));
		return Promise.resolve();
	});
	vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement)
	{
		paused = true;
		this.dispatchEvent(new Event("pause"));
	});
});

afterEach(() =>
{
	cleanup();
	vi.restoreAllMocks();
});

function wrap(node: React.ReactNode)
{
	return render(
		<MantineProvider>
			<MemoryRouter>{node}</MemoryRouter>
		</MantineProvider>,
	);
}

describe("VideoPlayer", () =>
{
	it("disclaimer: shows the MLBAM disclaimer verbatim under the clip, with the title and the time", () =>
	{
		wrap(<VideoPlayer video={VIDEO} />);
		expect(screen.getByText("Disclaimer:")).toBeInTheDocument();
		expect(screen.getByText("This video is provided by MLBAM and MLB.com and has no affiliation with or connection to Baseball Theater. It has been displayed on your device via a public API provided by Major League Baseball.")).toBeInTheDocument();
		expect(screen.getByText(VIDEO.title)).toBeInTheDocument();
		expect(screen.getByText("0:00 / 0:00")).toBeInTheDocument();
	});

	it("plays inline: iOS Safari keeps the clip in the page instead of taking it fullscreen", () =>
	{
		wrap(<VideoPlayer video={VIDEO} autoPlay />);
		const video = screen.getByTestId("video-player").querySelector("video");
		expect(video).toHaveAttribute("playsinline");
		expect(video).toHaveAttribute("webkit-playsinline");
	});

	it("Space plays and pauses, but not while typing in a field", async () =>
	{
		const user = userEvent.setup();
		wrap(<><input aria-label="Search videos" /><VideoPlayer video={VIDEO} /></>);
		await user.keyboard(" ");
		expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
		await waitFor(() => expect(screen.getByRole("button", {
			name: "Pause",
		})).toBeInTheDocument());
		await user.keyboard(" ");
		expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
		await user.click(screen.getByRole("textbox", {
			name: "Search videos",
		}));
		await user.keyboard(" ");
		expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
	});
});

describe("VideoPlayer controls", () =>
{
	it("the play control and the clip itself toggle playback, and the bar and clock follow the clip's time", async () =>
	{
		const user = userEvent.setup();
		wrap(<VideoPlayer video={VIDEO} />);
		const clip = screen.getByTestId("video-player").querySelector("video")!;
		Object.defineProperty(clip, "duration", {
			value: 48,
		});
		Object.defineProperty(clip, "currentTime", {
			value: 12,
		});
		fireEvent.loadedMetadata(clip);
		fireEvent.timeUpdate(clip);
		expect(screen.getByText("0:12 / 0:48")).toBeInTheDocument();
		expect(screen.getByRole("progressbar", {
			name: "Progress",
		})).toHaveAttribute("aria-valuenow", "12");
		await user.click(screen.getByRole("button", {
			name: "Play",
		}));
		expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
		await user.click(clip);
		expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
	});

	it("a clip without a source or still still renders, and Space on a button is left to the button", async () =>
	{
		const user = userEvent.setup();
		wrap(<VideoPlayer video={{
			...VIDEO,
			playbackUrl: null,
		}}
		/>);
		screen.getByRole("button", {
			name: "Play",
		}).focus();
		await user.keyboard(" ");
		// The focused button's own Space press plays once; the player's listener adds nothing.
		expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
	});
});

describe("PlayerDialog", () =>
{
	it("closes on ✕ and on Esc", async () =>
	{
		const user = userEvent.setup();
		const onClose = vi.fn();
		wrap(<PlayerDialog video={VIDEO} onClose={onClose} />);
		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByTestId("video-player")).toBeInTheDocument();
		await user.click(within(dialog).getByRole("button", {
			name: "Close video",
		}));
		expect(onClose).toHaveBeenCalledTimes(1);
		await user.keyboard("{Escape}");
		expect(onClose).toHaveBeenCalledTimes(2);
	});

	it("floats with no card: Close is a labeled button in the overlay, and a press on the empty overlay closes, but not one on the player", async () =>
	{
		const user = userEvent.setup();
		const onClose = vi.fn();
		wrap(<PlayerDialog video={VIDEO} onClose={onClose} />);
		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByRole("button", {
			name: "Close video",
		})).toHaveTextContent("Close");
		await user.click(within(dialog).getByText(VIDEO.title));
		expect(onClose).not.toHaveBeenCalled();
		await user.click(within(dialog).getByTestId("player-backdrop"));
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("game link: shown when the clip carries its game and plays elsewhere (Search, the digest); absent from that game's own page or without a game", async () =>
	{
		const game = {
			gamePk: 823823,
			label: "CHC @ MIA, Sep 5",
		};
		const { unmount } = wrap(<PlayerDialog video={VIDEO} onClose={() => undefined} game={game} />);
		const link = await screen.findByRole("link", {
			name: "Go to game: CHC @ MIA, Sep 5 →",
		});
		expect(link).toHaveAttribute("href", "/game/823823");
		unmount();

		const own = wrap(<PlayerDialog video={VIDEO} onClose={() => undefined} game={game} fromGamePk={823823} />);
		await screen.findByRole("dialog");
		expect(screen.queryByRole("link")).toBeNull();
		own.unmount();

		wrap(<PlayerDialog video={VIDEO} onClose={() => undefined} />);
		await screen.findByRole("dialog");
		expect(screen.queryByRole("link")).toBeNull();
	});
});
