/**
 * Which filter pills fit in a row (S69; owner, 2026-10-30: "If all the filters can fit in
 * the left side of that area, show them all. If not, show as many as possible with the
 * last item being a Filters button"). Pixel layout, not BT data, so it lives beside the
 * row rather than in packages/domain.
 *
 * `widths` are the pills in order, `more` the Filters button, `available` the row's width
 * and `gap` the space between items. Returns the indexes to show, in order: all of them
 * when they fit on their own; else, walking in order, every pill that still fits with
 * the Filters button reserved at the end — so a short pill after a long one can still
 * show. A row not laid out yet (`available` 0, as in jsdom) shows all.
 */
export function fittingFilters(widths: readonly number[], more: number, available: number, gap: number): number[]
{
	const all = widths.map((_, index) => index);
	const total = widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(widths.length - 1, 0);
	if (available <= 0 || total <= available) return all;
	let used = more;
	return all.filter((index) =>
	{
		const width = widths[index]!;
		if (used + gap + width > available) return false;
		used += gap + width;
		return true;
	});
}
