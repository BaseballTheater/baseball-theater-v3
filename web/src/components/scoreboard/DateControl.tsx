import {
	ActionIcon, Group, Text,
} from "@mantine/core";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { addDays } from "@bt/domain";
import { formatDate } from "../../format/datetime.js";

/**
 * The scoreboard's date control (S31; S66): ‹ `SEP 21, 2026` › on a hairline bar
 * under the header, edge to edge. Previous and next are links to the day before and
 * after (`/games/<date ± 1>`), so the day lives in the URL and back / forward work.
 * The step is `addDays` from `packages/domain`; the label is `formatDate`.
 */
export function DateControl({ date }: { date: string })
{
	return (
		<Group
			component="nav"
			aria-label="Date"
			data-testid="date-control"
			justify="space-between"
			wrap="nowrap"
			px="md"
			py={8}
			mx="calc(var(--mantine-spacing-md) * -1)"
			mt="calc(var(--mantine-spacing-md) * -1)"
			style={{
				borderBottom: "1px solid var(--bt-hairline)",
			}}
		>
			<ActionIcon component={Link} to={`/games/${addDays(date, -1)}`} aria-label="Previous day" variant="subtle" color="gray">
				<IconChevronLeft size={20} />
			</ActionIcon>
			<Text size="sm" fw={700} tt="uppercase">{formatDate(date)}</Text>
			<ActionIcon component={Link} to={`/games/${addDays(date, 1)}`} aria-label="Next day" variant="subtle" color="gray">
				<IconChevronRight size={20} />
			</ActionIcon>
		</Group>
	);
}
