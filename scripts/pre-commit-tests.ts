/**
 * The Husky pre-commit test gate: a commit is refused unless the tests touched by its staged
 * files pass.
 *
 * "Touched" is Vitest's own import graph, not a separate build system. Workspace packages
 * export their TypeScript source (`"import": "./src/index.ts"`), so `vitest related` in a
 * package follows imports across package boundaries: a change to `packages/domain` reaches
 * the `functions` and `web` tests that import it, and a change to a `web` component runs only
 * the `web` tests that import it.
 *
 * Assumptions, and what falls back to a package's whole suite instead:
 * - Each package runs from its own folder (`pnpm exec`), so tools a package installs (e.g.
 *   `oasdiff` in `functions`) are on PATH, as under `pnpm test`.
 * - Only packages the change can reach run: the changed package plus its workspace dependents
 *   (read from each package.json's `@bt/*` dependencies).
 * - Files read from disk, not imported, are invisible to the graph: anything under `fixtures/`
 *   runs all of `functions`' tests. A package's own package.json or vitest config runs its
 *   whole suite; the root lockfile, package.json, tsconfig or vitest config runs every suite.
 * - The repo-tooling suites outside the workspace packages run whole when a file they test is
 *   staged: the backlog tool's (`pnpm test:backlog`) for scripts/backlog-vault/, scripts/audit.sh,
 *   the backlog notes and the ledger (one of its tests reads the real AUDIT.md), and the tools
 *   suite (`pnpm test:tools`) for tools/. Both take a few seconds.
 * - Coverage thresholds and the workerd suite (`functions/vitest.workers.config.ts`) are left to
 *   `pnpm verify` and CI, to keep a commit fast.
 * - It tests the working tree, so unstaged edits to a staged file are tested too.
 *
 * `BT_SKIP_PRECOMMIT_TESTS=1` skips it (for a commit that must land red on purpose, say so in it).
 */

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");

/** Workspace packages with tests, by folder. */
const packageDirs = ["packages/domain", "packages/mlb-api", "packages/ports", "functions", "web"];

/** Root files whose change can alter how any test resolves or runs. */
const runEverything = /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig[^/]*\.json|vitest\.config\.ts)$/;

/** Repo-tooling suites outside the workspace packages: run whole, from the repo root, when a staged file matches. */
const toolingSuites = [
	{
		label: "scripts/backlog-vault",
		config: "scripts/backlog-vault/vitest.config.ts",
		// The tool itself, the ledger writer, the backlog notes and docs it builds from, and the CI workflow (law P11's test).
		triggers: [
			/^scripts\/(backlog-vault\/|audit\.sh$|lib\/)/,
			/^docs\/v3\/(backlog\/|AUDIT\.md$|audit\.jsonl$|BACKLOG\.md$|FEATURES\.md$|INTENT\.md$)/,
			/^\.github\/workflows\//,
		],
	},
	{
		label: "tools",
		config: "tools/vitest.config.js",
		triggers: [/^tools\//],
	},
];

/**
 * Git exports these to hooks, pointing at this repo's index and directory. Tests that make
 * their own temporary repos (the backlog tool's) would then read and write this repo's index,
 * so each suite runs without them, as it does under `pnpm verify`.
 */
const hookGitVariables = ["GIT_INDEX_FILE", "GIT_DIR", "GIT_WORK_TREE", "GIT_PREFIX", "GIT_OBJECT_DIRECTORY", "GIT_COMMON_DIR", "GIT_ALTERNATE_OBJECT_DIRECTORIES"];

/** Files Vitest can place in its import graph. */
const graphFile = /\.(ts|tsx|js|jsx|mjs|cjs|json)$/;

interface WorkspacePackage
{
	dir: string;
	name: string;
	deps: string[];
}

function readPackages(): WorkspacePackage[]
{
	return packageDirs.map((dir) =>
	{
		const json = JSON.parse(readFileSync(join(repoRoot, dir, "package.json"), "utf8")) as {
			name: string;
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};
		const deps = Object.keys({
			...json.dependencies,
			...json.devDependencies,
		}).filter((name) => name.startsWith("@bt/"));
		return {
			dir,
			name: json.name,
			deps,
		};
	});
}

/** The package a file belongs to, or undefined for a file outside every package. */
function owner(file: string, packages: WorkspacePackage[]): WorkspacePackage | undefined
{
	return packages.find((pkg) => file.startsWith(`${pkg.dir}/`));
}

/** `pkg` plus every package that depends on it, transitively. */
function withDependents(pkg: WorkspacePackage, packages: WorkspacePackage[]): Set<WorkspacePackage>
{
	const reached = new Set([pkg]);
	let grew = true;
	while (grew)
	{
		grew = false;
		for (const candidate of packages)
		{
			if (!reached.has(candidate) && candidate.deps.some((dep) => [...reached].some((r) => r.name === dep)))
			{
				reached.add(candidate);
				grew = true;
			}
		}
	}
	return reached;
}

function main(): number
{
	if (process.env.BT_SKIP_PRECOMMIT_TESTS === "1")
	{
		console.log("pre-commit tests: skipped (BT_SKIP_PRECOMMIT_TESTS=1)");
		return 0;
	}

	const staged = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
		cwd: repoRoot,
		encoding: "utf8",
	}).split("\n").filter(Boolean);

	const packages = readPackages();
	const full = new Set<WorkspacePackage>();
	const related = new Map<WorkspacePackage, string[]>();

	for (const file of staged)
	{
		if (runEverything.test(file))
		{
			packages.forEach((pkg) => full.add(pkg));
			continue;
		}
		if (file.startsWith("fixtures/"))
		{
			packages.filter((pkg) => pkg.dir === "functions").forEach((pkg) => full.add(pkg));
			continue;
		}
		const pkg = owner(file, packages);
		if (!pkg)
		{
			continue;
		}
		const local = file.slice(pkg.dir.length + 1);
		if (local === "package.json" || local.startsWith("vitest.config"))
		{
			full.add(pkg);
			continue;
		}
		if (!graphFile.test(file))
		{
			continue;
		}
		for (const reached of withDependents(pkg, packages))
		{
			related.set(reached, [...related.get(reached) ?? [], resolve(repoRoot, file)]);
		}
	}

	const runs: { label: string;
		cwd: string;
		mode: string;
		args: string[] }[] = packages.flatMap((pkg) =>
	{
		const cwd = join(repoRoot, pkg.dir);
		if (full.has(pkg))
		{
			return [{
				label: pkg.dir,
				cwd,
				mode: "full suite",
				args: ["vitest", "run"],
			}];
		}
		const files = related.get(pkg);
		return files ? [{
			label: pkg.dir,
			cwd,
			mode: "related",
			args: ["vitest", "related", "--run", "--passWithNoTests", ...files],
		}] : [];
	});
	for (const suite of toolingSuites)
	{
		if (staged.some((file) => suite.triggers.some((t) => t.test(file)) || runEverything.test(file)))
		{
			runs.push({
				label: suite.label,
				cwd: repoRoot,
				mode: "full suite",
				args: ["vitest", "run", "--config", suite.config],
			});
		}
	}

	if (runs.length === 0)
	{
		console.log("pre-commit tests: no staged file reaches a test");
		return 0;
	}

	for (const {
		label, cwd, mode, args,
	} of runs)
	{
		console.log(`pre-commit tests: ${label} (${mode})`);
		const env = {
			...process.env,
		};
		hookGitVariables.forEach((name) => delete env[name]);
		const result = spawnSync("pnpm", ["exec", ...args], {
			cwd,
			env,
			stdio: "inherit",
		});
		if (result.status !== 0)
		{
			console.error(`\npre-commit tests failed in ${label}; commit refused. Fix them, or BT_SKIP_PRECOMMIT_TESTS=1 to land red on purpose.`);
			return result.status ?? 1;
		}
	}
	return 0;
}

process.exit(main());
