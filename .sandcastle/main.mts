/// <reference types="node" />

import {
	codex,
	createSandbox,
	type ExecResult,
} from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { execFile, execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const runGh = (args: string[]): string =>
	execFileSync("gh", args, {
		encoding: "utf8",
		env: { ...process.env, GH_PROMPT_DISABLED: "1" },
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();

const getGithubToken = (): string | undefined => {
	if (process.env.GH_TOKEN) {
		return process.env.GH_TOKEN;
	}
	try {
		return runGh(["auth", "token"]);
	} catch {
		return undefined;
	}
};

const githubToken = getGithubToken();
if (!githubToken) {
	throw new Error(
		"Missing GitHub authentication. Run `gh auth login` or set GH_TOKEN locally.",
	);
}

const REPO =
	process.env.GITHUB_REPOSITORY ??
	runGh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);

const LABEL_READY = "ready-for-agent";
const LABEL_IN_PROGRESS = "agent-in-progress";
const LABEL_PR_OPEN = "agent-pr-open";
const LABEL_PRD = "prd";

const ISSUE_LABELS = [
	{
		name: LABEL_PRD,
		color: "5319E7",
		description: "Planning document — not for agent implementation",
	},
	{
		name: LABEL_IN_PROGRESS,
		color: "FBCA04",
		description: "Agent is actively implementing or reviewing",
	},
	{
		name: LABEL_PR_OPEN,
		color: "1D76DB",
		description: "Agent opened a PR; awaiting human review and merge",
	},
] as const;

const ensureIssueLabels = (): void => {
	for (const label of ISSUE_LABELS) {
		try {
			runGh([
				"label",
				"create",
				label.name,
				"--repo",
				REPO,
				"--color",
				label.color,
				"--description",
				label.description,
			]);
		} catch {
			// Label already exists.
		}
	}
};

const extractIssueNumber = (worktreePath: string): number | undefined => {
	try {
		const subject = execFileSync(
			"git",
			["-C", worktreePath, "log", "--format=%s", "-1"],
			{ encoding: "utf8" },
		).trim();
		const match = subject.match(/#(\d+)/);
		return match ? Number.parseInt(match[1], 10) : undefined;
	} catch {
		return undefined;
	}
};

type GhIssue = {
	number: number;
	title: string;
	body: string;
	labels: Array<{ name: string }>;
};

const listReadyIssues = (): GhIssue[] => {
	const raw = runGh([
		"issue",
		"list",
		"--repo",
		REPO,
		"--state",
		"open",
		"--label",
		LABEL_READY,
		"--limit",
		"100",
		"--json",
		"number,title,body,labels",
	]);
	return JSON.parse(raw) as GhIssue[];
};

const isHitlIssue = (issue: GhIssue): boolean =>
	issue.labels.some((label) => label.name.toLowerCase() === "hitl") ||
	/\bHITL\b/i.test(issue.body);

const isPrdIssue = (issue: GhIssue): boolean =>
	issue.labels.some((label) => label.name.toLowerCase() === LABEL_PRD) ||
	/^PRD:/i.test(issue.title);

const getBlockerNumbers = (body: string): number[] => {
	const blockedBySection =
		body.match(/##?\s*Blocked by[\s\S]*?(?=##|$)/i)?.[0] ?? "";
	const numbers = new Set<number>();

	for (const match of blockedBySection.matchAll(
		/(?:#(\d+)|\/issues\/(\d+))/g,
	)) {
		const issueNumber = Number.parseInt(match[1] ?? match[2] ?? "", 10);
		if (!Number.isNaN(issueNumber)) {
			numbers.add(issueNumber);
		}
	}

	return [...numbers];
};

const isIssueOpen = (issueNumber: number): boolean => {
	try {
		return (
			runGh([
				"issue",
				"view",
				String(issueNumber),
				"--repo",
				REPO,
				"--json",
				"state",
				"-q",
				".state",
			]) === "OPEN"
		);
	} catch {
		// Missing blocker reference — do not treat as blocking.
		return false;
	}
};

const hasOpenBlockers = (blockers: number[]): boolean =>
	blockers.some(isIssueOpen);

const isActionableIssue = (issue: GhIssue): boolean =>
	!isPrdIssue(issue) &&
	!isHitlIssue(issue) &&
	!hasOpenBlockers(getBlockerNumbers(issue.body));

/** Pick up to `maxCount` unblocked issues, lowest issue number first. */
const pickNextIssues = (maxCount: number): GhIssue[] => {
	const picked: GhIssue[] = [];
	const pickedNumbers = new Set<number>();

	for (const issue of listReadyIssues().sort(
		(left, right) => left.number - right.number,
	)) {
		if (picked.length >= maxCount) {
			break;
		}
		if (!isActionableIssue(issue)) {
			continue;
		}

		const blockers = getBlockerNumbers(issue.body);
		// Do not run an issue in parallel with an open blocker, including one
		// already selected for this batch (still open until its PR merges).
		if (blockers.some((blocker) => pickedNumbers.has(blocker))) {
			continue;
		}

		picked.push(issue);
		pickedNumbers.add(issue.number);
	}

	return picked;
};

const claimIssue = (issueNumber: number, branch: string): void => {
	runGh([
		"issue",
		"edit",
		String(issueNumber),
		"--repo",
		REPO,
		"--remove-label",
		LABEL_READY,
		"--remove-label",
		LABEL_PR_OPEN,
		"--add-label",
		LABEL_IN_PROGRESS,
	]);
	runGh([
		"issue",
		"comment",
		String(issueNumber),
		"--repo",
		REPO,
		"--body",
		`Sandcastle claimed this issue and is implementing on branch \`${branch}\`.`,
	]);
};

const markIssuePrOpen = (issueNumber: number): void => {
	runGh([
		"issue",
		"edit",
		String(issueNumber),
		"--repo",
		REPO,
		"--remove-label",
		LABEL_READY,
		"--remove-label",
		LABEL_IN_PROGRESS,
		"--add-label",
		LABEL_PR_OPEN,
	]);
};

const releaseIssueToBacklog = (
	issueNumber: number,
	comment: string,
): void => {
	runGh([
		"issue",
		"edit",
		String(issueNumber),
		"--repo",
		REPO,
		"--remove-label",
		LABEL_IN_PROGRESS,
		"--remove-label",
		LABEL_PR_OPEN,
		"--add-label",
		LABEL_READY,
	]);
	runGh([
		"issue",
		"comment",
		String(issueNumber),
		"--repo",
		REPO,
		"--body",
		comment,
	]);
};

ensureIssueLabels();

const SANDBOX_WORKDIR = "/home/agent/workspace";

/** Run a command in the docker sandbox backing the given worktree. */
async function execInSandbox(
	worktreePath: string,
	command: string,
): Promise<ExecResult> {
	const absWorktree = resolve(worktreePath);
	const { stdout: idsRaw } = await execFileAsync("docker", [
		"ps",
		"-q",
		"--filter",
		"name=sandcastle-",
	]);
	const containerIds = idsRaw.trim().split("\n").filter(Boolean);

	for (const containerId of containerIds) {
		const { stdout: mountsRaw } = await execFileAsync("docker", [
			"inspect",
			"-f",
			"{{json .Mounts}}",
			containerId,
		]);
		const mounts = JSON.parse(mountsRaw) as Array<{ Source?: string }>;
		const matchesWorktree = mounts.some(
			(mount) => mount.Source && resolve(mount.Source) === absWorktree,
		);
		if (!matchesWorktree) continue;

		try {
			const { stdout, stderr } = await execFileAsync(
				"docker",
				[
					"exec",
					"-w",
					SANDBOX_WORKDIR,
					containerId,
					"sh",
					"-c",
					command,
				],
				{ maxBuffer: 10 * 1024 * 1024 },
			);
			return { stdout, stderr, exitCode: 0 };
		} catch (error: unknown) {
			const execError = error as {
				stdout?: unknown;
				stderr?: unknown;
				code?: unknown;
			};
			return {
				stdout: String(execError.stdout ?? ""),
				stderr: String(execError.stderr ?? ""),
				exitCode:
					typeof execError.code === "number" ? execError.code : 1,
			};
		}
	}

	throw new Error(
		`No sandcastle container found for worktree: ${absWorktree}`,
	);
}

const IMAGE_NAME = "sandcastle:claim-check";

// Implement → review → verify → publish (up to PARALLEL_RUNS issues at once).
// Run: npm run agent:run  (builds the Docker image first via preagent:run)

const PARALLEL_RUNS = 2;

const sandboxProvider = docker({
	imageName: IMAGE_NAME,
	env: { GH_TOKEN: githubToken },
	mounts: [
		{
			hostPath: "~/.codex",
			sandboxPath: "/home/agent/.codex",
		},
	],
});

const hooks = {
	sandbox: {
		onSandboxReady: [
			{ command: "codex login status", timeoutMs: 15_000 },
			{ command: "gh auth setup-git", timeoutMs: 30_000 },
			{ command: "uv sync --all-extras", timeoutMs: 300_000 },
		],
	},
};

const agent = codex("gpt-5.4");

type ClaimedIssue = { issue: GhIssue; branch: string };

async function processIssue({ issue, branch }: ClaimedIssue): Promise<void> {
	console.log(`Starting pipeline for issue #${issue.number} on ${branch}`);

	await using sandbox = await createSandbox({
		branch,
		sandbox: sandboxProvider,
		hooks,
	});

	const implement = await sandbox.run({
		name: "implementer",
		maxIterations: 1,
		agent,
		promptFile: "./.sandcastle/implement-prompt.md",
		promptArgs: {
			ISSUE_NUMBER: String(issue.number),
			ISSUE_TITLE: issue.title,
		},
	});

	if (!implement.commits.length) {
		releaseIssueToBacklog(
			issue.number,
			"Sandcastle implementer made no commits (blocked or could not finish). Returned issue to `ready-for-agent`.",
		);
		console.log(
			`Implementer made no commits — released issue #${issue.number}.`,
		);
		return;
	}

	console.log(
		`Issue #${issue.number}: implementation complete (${implement.commits.length} commit(s))`,
	);

	await sandbox.run({
		name: "reviewer",
		maxIterations: 1,
		agent,
		promptFile: "./.sandcastle/review-prompt.md",
		promptArgs: { BRANCH: branch },
	});

	console.log(`Issue #${issue.number}: review complete.`);

	const verify = await execInSandbox(
		sandbox.worktreePath,
		"uv run pytest && uv run ruff check .",
	);
	if (verify.exitCode !== 0) {
		console.error(
			`Issue #${issue.number}: verification failed — skipping publish.`,
		);
		console.error(verify.stdout);
		console.error(verify.stderr);

		const issueNumber =
			extractIssueNumber(sandbox.worktreePath) ?? issue.number;
		releaseIssueToBacklog(
			issueNumber,
			"Sandcastle verification failed after review (`pytest` / `ruff`). Returned issue to `ready-for-agent` for retry.",
		);
		console.log(`Released issue #${issueNumber} back to ${LABEL_READY}.`);
		return;
	}

	await sandbox.run({
		name: "publisher",
		maxIterations: 1,
		agent,
		promptFile: "./.sandcastle/publish-prompt.md",
		promptArgs: { BRANCH: branch },
	});

	markIssuePrOpen(issue.number);
	console.log(
		`Issue #${issue.number}: publish complete (labeled ${LABEL_PR_OPEN}).`,
	);
}

const issues = pickNextIssues(PARALLEL_RUNS);
if (issues.length === 0) {
	console.log("No actionable issues in the backlog. Stopping.");
} else {
	console.log(
		`\nClaiming ${issues.length} issue(s) for parallel processing:\n`,
	);

	const claimed: ClaimedIssue[] = issues.map((issue, index) => {
		const branch = `agent/issue-${issue.number}-${Date.now()}-${index}`;
		claimIssue(issue.number, branch);
		console.log(`  #${issue.number}: ${issue.title} → ${branch}`);
		return { issue, branch };
	});

	const settled = await Promise.allSettled(
		claimed.map((entry) => processIssue(entry)),
	);

	for (const [entry, outcome] of settled.map((result, index) => [
		claimed[index],
		result,
	] as const)) {
		if (outcome.status === "rejected" && entry !== undefined) {
			const { issue, branch } = entry;
			console.error(
				`Issue #${issue.number} (${branch}) failed: ${outcome.reason}`,
			);
			releaseIssueToBacklog(
				issue.number,
				`Sandcastle pipeline failed unexpectedly. Returned issue to \`${LABEL_READY}\` for retry.`,
			);
		}
	}
}

console.log("\nAll done.");
