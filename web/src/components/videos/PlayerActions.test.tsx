/**
 * The player's quality picker and action palette (owner, 2026-11-12: "video player needs a
 * quality selector for the several qualities the api shows" and "a palette of helpful
 * clickables (copy link, direct link, download, share)"), on the renditions MLB lists for a
 * 2026 clip (`fixtures/raw/content-823823.json`).
 */
import { MantineProvider } from "@mantine/core";
import {
	act, cleanup, fireEvent, render, screen, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import type { Video } from "./VideoCard.js";
import { VideoPlayer } from "./VideoPlayer.js";

const BASE = "https://mlb-cuts-diamond.mlb.com/FORGE/2026/2026-09/05/68e1ef46-6669f6b0-5b1ac736-csvm-diamondgcp-asset";
const HLS = `${BASE}.m3u8`;
const MP4 = `${BASE}_1280x720_59_4000K.mp4`;
const HIGH = `${BASE}_1280x720_59_16000K.mp4`;

const VIDEO: Video = {
	id: "conforto-hr",
	playId: null,
	title: "Michael Conforto hits Cubs' 200th home run (14)",
	blurb: null,
	duration: "00:00:30",
	imageUrl: null,
	playbackUrl: MP4,
	renditions: [{
		name: "hlsCloud",
		url: HLS,
	}, {
		name: "mp4Avc",
		url: MP4,
	}, {
		name: "highBit",
		url: HIGH,
	}],
};

let paused = true;

beforeEach(() =>
{
	paused = true;
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
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

function renderPlayer(video: Video = VIDEO, autoPlay = false)
{
	render(
		<MantineProvider>
			<MemoryRouter>
				<VideoPlayer video={video} autoPlay={autoPlay} />
			</MemoryRouter>
		</MantineProvider>,
	);
	return screen.getByTestId("video-player").querySelector("video")!;
}

/** Stubs whether this browser can play HLS in a plain `<video>`. */
function hlsSupport(supported: boolean)
{
	vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockImplementation((type) => (supported && type === "application/vnd.apple.mpegurl" ? "maybe" : ""));
}

describe("quality picker", () =>
{
	it("starts on the standard MP4 and lists the MP4 qualities MLB gives, sharpest first; no HLS where the browser can't play it", async () =>
	{
		hlsSupport(false);
		const video = renderPlayer();
		expect(video).toHaveAttribute("src", MP4);
		await userEvent.click(screen.getByRole("button", {
			name: "Quality: Standard · 720p, 4 Mbps",
		}));
		const items = await screen.findAllByRole("menuitem");
		expect(items.map((item) => item.textContent)).toEqual(["High · 720p, 16 Mbps", "Standard · 720p, 4 Mbps"]);
		expect(items[1]).toHaveAttribute("aria-current", "true");
	});

	it("offers the HLS stream too where the browser plays it", async () =>
	{
		hlsSupport(true);
		renderPlayer();
		await userEvent.click(screen.getByRole("button", {
			name: /^Quality:/,
		}));
		expect((await screen.findAllByRole("menuitem")).map((item) => item.textContent)).toEqual(["High · 720p, 16 Mbps", "Standard · 720p, 4 Mbps", "Auto (HLS)"]);
	});

	it("choosing a quality plays that file from the same moment, still playing", async () =>
	{
		hlsSupport(false);
		const video = renderPlayer();
		await userEvent.click(screen.getByRole("button", {
			name: "Play",
		}));
		video.currentTime = 12;
		await userEvent.click(screen.getByRole("button", {
			name: /^Quality:/,
		}));
		await userEvent.click(await screen.findByRole("menuitem", {
			name: "High · 720p, 16 Mbps",
		}));
		expect(video).toHaveAttribute("src", HIGH);
		paused = true;
		const play = vi.mocked(HTMLMediaElement.prototype.play);
		play.mockClear();
		fireEvent(video, new Event("loadedmetadata"));
		expect(video.currentTime).toBe(12);
		expect(play).toHaveBeenCalledTimes(1);
		// The actions follow the quality being played.
		expect(screen.getByRole("link", {
			name: "Direct link",
		})).toHaveAttribute("href", HIGH);
	});

	/** Opens the quality picker and chooses High, then returns `play`'s spy, cleared. */
	async function chooseHigh(video: HTMLVideoElement)
	{
		await userEvent.click(screen.getByRole("button", {
			name: /^Quality:/,
		}));
		await userEvent.click(await screen.findByRole("menuitem", {
			name: "High · 720p, 16 Mbps",
		}));
		expect(video).toHaveAttribute("src", HIGH);
		const play = vi.mocked(HTMLMediaElement.prototype.play);
		play.mockClear();
		return play;
	}

	it("a paused clip stays paused after a quality switch, and the reload doesn't autoplay", async () =>
	{
		hlsSupport(false);
		const video = renderPlayer(VIDEO, true);
		expect(video.autoplay).toBe(true);
		// The clip had started, then the reader paused it at 0:12.
		fireEvent(video, new Event("play"));
		fireEvent(video, new Event("pause"));
		video.currentTime = 12;
		const play = await chooseHigh(video);
		expect(video.autoplay).toBe(false);
		fireEvent(video, new Event("loadedmetadata"));
		expect(video.currentTime).toBe(12);
		expect(play).not.toHaveBeenCalled();
	});

	it("an autoplaying clip switched before it started still plays", async () =>
	{
		hlsSupport(false);
		const video = renderPlayer(VIDEO, true);
		const play = await chooseHigh(video);
		fireEvent(video, new Event("loadedmetadata"));
		expect(play).toHaveBeenCalledTimes(1);
	});

	it("a press on Play while the new quality loads isn't undone when it loads", async () =>
	{
		hlsSupport(false);
		const video = renderPlayer();
		video.currentTime = 12;
		const play = await chooseHigh(video);
		await userEvent.click(screen.getByRole("button", {
			name: "Play",
		}));
		// The press itself plays the element, which also starts a load the browser may not have begun.
		expect(play).toHaveBeenCalledTimes(1);
		const pause = vi.mocked(HTMLMediaElement.prototype.pause);
		pause.mockClear();
		fireEvent(video, new Event("loadedmetadata"));
		expect(pause).not.toHaveBeenCalled();
		expect(screen.getByRole("button", {
			name: "Pause",
		})).toBeInTheDocument();
	});

	it("a pause while the new quality loads keeps the clip paused when it loads", async () =>
	{
		hlsSupport(false);
		const video = renderPlayer();
		await userEvent.click(screen.getByRole("button", {
			name: "Play",
		}));
		const play = await chooseHigh(video);
		fireEvent(video, new Event("pause"));
		fireEvent(video, new Event("loadedmetadata"));
		expect(play).not.toHaveBeenCalled();
	});

	it("Pause pressed while a playing clip's new quality loads keeps it paused when it loads", async () =>
	{
		hlsSupport(false);
		const video = renderPlayer();
		await userEvent.click(screen.getByRole("button", {
			name: "Play",
		}));
		const play = await chooseHigh(video);
		// The reload leaves the element paused without a pause event, so the button still says Pause.
		paused = true;
		await userEvent.click(screen.getByRole("button", {
			name: "Pause",
		}));
		expect(play).not.toHaveBeenCalled();
		expect(screen.getByRole("button", {
			name: "Play",
		})).toBeInTheDocument();
		fireEvent(video, new Event("loadedmetadata"));
		expect(play).not.toHaveBeenCalled();
	});

	it("Play then Pause during one reload leaves the clip paused", async () =>
	{
		hlsSupport(false);
		const video = renderPlayer();
		await chooseHigh(video);
		await userEvent.click(screen.getByRole("button", {
			name: "Play",
		}));
		await userEvent.click(screen.getByRole("button", {
			name: "Pause",
		}));
		expect(video.paused).toBe(true);
		const play = vi.mocked(HTMLMediaElement.prototype.play);
		play.mockClear();
		fireEvent(video, new Event("loadedmetadata"));
		expect(play).not.toHaveBeenCalled();
		expect(screen.getByRole("button", {
			name: "Play",
		})).toBeInTheDocument();
	});

	it("an autoplaying clip switched before it starts shows Pause, and a press then pauses it", async () =>
	{
		hlsSupport(false);
		const video = renderPlayer(VIDEO, true);
		const play = await chooseHigh(video);
		await userEvent.click(screen.getByRole("button", {
			name: "Pause",
		}));
		fireEvent(video, new Event("loadedmetadata"));
		expect(play).not.toHaveBeenCalled();
	});

	it("two quick switches keep the first switch's place", async () =>
	{
		hlsSupport(false);
		const video = renderPlayer();
		video.currentTime = 12;
		await chooseHigh(video);
		video.currentTime = 0;
		await userEvent.click(screen.getByRole("button", {
			name: /^Quality:/,
		}));
		await userEvent.click(await screen.findByRole("menuitem", {
			name: "Standard · 720p, 4 Mbps",
		}));
		fireEvent(video, new Event("loadedmetadata"));
		expect(video.currentTime).toBe(12);
	});

	it("a clip with one quality (recorded before renditions were kept) has no picker", () =>
	{
		renderPlayer({
			...VIDEO,
			renditions: undefined,
		});
		expect(screen.queryByRole("button", {
			name: /^Quality:/,
		})).toBeNull();
		expect(screen.getByTestId("player-actions")).toBeInTheDocument();
	});
});

describe("action palette", () =>
{
	it("Copy link puts the playing file's URL on the clipboard and says Copied, then goes back", async () =>
	{
		const writeText = vi.fn(() => Promise.resolve());
		vi.stubGlobal("navigator", {
			...navigator,
			clipboard: {
				writeText,
			},
		});
		renderPlayer();
		vi.useFakeTimers();
		await act(async () =>
		{
			fireEvent.click(screen.getByRole("button", {
				name: "Copy link",
			}));
		});
		expect(writeText).toHaveBeenCalledWith(MP4);
		expect(screen.getByRole("button", {
			name: "Copied",
		})).toBeInTheDocument();
		act(() =>
		{
			vi.advanceTimersByTime(2000);
		});
		expect(screen.getByRole("button", {
			name: "Copy link",
		})).toBeInTheDocument();
	});

	it("Direct link opens the file in a new tab; Download links the MP4 to save, also off the page", () =>
	{
		renderPlayer();
		const palette = within(screen.getByRole("toolbar", {
			name: "Video actions",
		}));
		const direct = palette.getByRole("link", {
			name: "Direct link",
		});
		expect(direct).toHaveAttribute("href", MP4);
		expect(direct).toHaveAttribute("target", "_blank");
		expect(direct).toHaveAttribute("rel", "noopener noreferrer");
		const download = palette.getByRole("link", {
			name: "Download",
		});
		expect(download).toHaveAttribute("href", MP4);
		expect(download).toHaveAttribute("download");
		expect(download).toHaveAttribute("target", "_blank");
	});

	it("playing the HLS stream, Download saves the MP4 MLB also gives; a stream-only clip has no Download", () =>
	{
		hlsSupport(true);
		renderPlayer({
			...VIDEO,
			playbackUrl: HLS,
			renditions: [{
				name: "hlsCloud",
				url: HLS,
			}, {
				name: "mp4Avc",
				url: MP4,
			}],
		});
		expect(screen.getByRole("link", {
			name: "Download",
		})).toHaveAttribute("href", MP4);
		cleanup();
		renderPlayer({
			...VIDEO,
			playbackUrl: HLS,
			renditions: [{
				name: "hlsCloud",
				url: HLS,
			}],
		});
		expect(screen.queryByRole("link", {
			name: "Download",
		})).toBeNull();
	});

	it("Share opens the device's share sheet with the title and URL; without one it copies the link", async () =>
	{
		const share = vi.fn(() => Promise.resolve());
		const writeText = vi.fn(() => Promise.resolve());
		vi.stubGlobal("navigator", {
			...navigator,
			share,
			clipboard: {
				writeText,
			},
		});
		renderPlayer();
		await userEvent.click(screen.getByRole("button", {
			name: "Share",
		}));
		expect(share).toHaveBeenCalledWith({
			title: VIDEO.title,
			url: MP4,
		});
		expect(writeText).not.toHaveBeenCalled();
		cleanup();

		vi.stubGlobal("navigator", {
			...navigator,
			share: undefined,
			clipboard: {
				writeText,
			},
		});
		renderPlayer();
		await userEvent.click(screen.getByRole("button", {
			name: "Share",
		}));
		expect(writeText).toHaveBeenCalledWith(MP4);
		expect(await screen.findByRole("button", {
			name: "Copied",
		})).toBeInTheDocument();
	});

	it("playing an HLS stream, Copy link, Direct link and Share all use the MP4 of the same cut, not the playlist", async () =>
	{
		hlsSupport(true);
		const share = vi.fn(() => Promise.resolve());
		const writeText = vi.fn(() => Promise.resolve());
		vi.stubGlobal("navigator", {
			...navigator,
			share,
			clipboard: {
				writeText,
			},
		});
		const video = renderPlayer({
			...VIDEO,
			playbackUrl: HLS,
		});
		expect(video).toHaveAttribute("src", HLS);
		expect(screen.getByRole("link", {
			name: "Direct link",
		})).toHaveAttribute("href", HIGH);
		await userEvent.click(screen.getByRole("button", {
			name: "Copy link",
		}));
		expect(writeText).toHaveBeenCalledWith(HIGH);
		await userEvent.click(screen.getByRole("button", {
			name: "Share",
		}));
		expect(share).toHaveBeenCalledWith({
			title: VIDEO.title,
			url: HIGH,
		});
		cleanup();

		// A portrait stream gives the portrait MP4, never the landscape one.
		renderPlayer({
			...VIDEO,
			playbackUrl: "https://darkroom-clips.mlb.com/b.m3u8",
			renditions: [{
				name: "mp4Avc",
				url: "https://darkroom-clips.mlb.com/a.mp4",
			}, {
				name: "portrait_hlsCloud",
				url: "https://darkroom-clips.mlb.com/b.m3u8",
			}, {
				name: "portrait_mp4Avc",
				url: "https://darkroom-clips.mlb.com/b.mp4",
			}],
		});
		expect(screen.getByRole("link", {
			name: "Direct link",
		})).toHaveAttribute("href", "https://darkroom-clips.mlb.com/b.mp4");
		cleanup();

		// With no MP4 at all, the stream is all there is.
		renderPlayer({
			...VIDEO,
			playbackUrl: HLS,
			renditions: [{
				name: "hlsCloud",
				url: HLS,
			}],
		});
		expect(screen.getByRole("link", {
			name: "Direct link",
		})).toHaveAttribute("href", HLS);
	});

	it("Copy link says \"Couldn't copy\" when the browser has no clipboard, or refuses the write", async () =>
	{
		vi.stubGlobal("navigator", {
			...navigator,
			clipboard: undefined,
		});
		renderPlayer();
		await userEvent.click(screen.getByRole("button", {
			name: "Copy link",
		}));
		expect(await screen.findByRole("button", {
			name: "Couldn't copy",
		})).toBeInTheDocument();
		cleanup();

		vi.stubGlobal("navigator", {
			...navigator,
			clipboard: {
				writeText: vi.fn(() => Promise.reject(new Error("NotAllowedError"))),
			},
		});
		renderPlayer();
		await userEvent.click(screen.getByRole("button", {
			name: "Copy link",
		}));
		expect(await screen.findByRole("button", {
			name: "Couldn't copy",
		})).toBeInTheDocument();
	});

	it("Share without a share sheet or a clipboard says \"Couldn't copy\"", async () =>
	{
		vi.stubGlobal("navigator", {
			...navigator,
			share: undefined,
			clipboard: undefined,
		});
		renderPlayer();
		await userEvent.click(screen.getByRole("button", {
			name: "Share",
		}));
		expect(await screen.findByRole("button", {
			name: "Couldn't copy",
		})).toBeInTheDocument();
	});
});
