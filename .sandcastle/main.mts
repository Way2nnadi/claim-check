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

const AGENT_LABELS = [
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

const ensureAgentLabels = (): void => {
	for (const label of AGENT_LABELS) {
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

ensureAgentLabels();

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

// Implement → review → verify → publish loop (one issue per iteration).
// Run: npm run sandcastle
// Build image first: npm run sandcastle:build

const MAX_ITERATIONS = 2;

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

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
	console.log(`\n=== Iteration ${iteration}/${MAX_ITERATIONS} ===\n`);

	const branch = `agent/issue-${Date.now()}`;

	await using sandbox = await createSandbox({
		branch,
		sandbox: sandboxProvider,
		hooks,
	});

	// Phase 1: Implement
	const implement = await sandbox.run({
		name: "implementer",
		maxIterations: 1,
		agent,
		promptFile: "./.sandcastle/implement-prompt.md",
	});

	if (!implement.commits.length) {
		console.log(
			"Implementer made no commits — backlog empty or blocked. Stopping.",
		);
		break;
	}

	console.log(
		`Implementation complete on ${branch} (${implement.commits.length} commit(s))`,
	);

	// Phase 2: Review
	await sandbox.run({
		name: "reviewer",
		maxIterations: 1,
		agent,
		promptFile: "./.sandcastle/review-prompt.md",
		promptArgs: { BRANCH: branch },
	});

	console.log("Review complete.");

	// Hard gate: tests must pass before publish
	const verify = await execInSandbox(
		sandbox.worktreePath,
		"uv run pytest && uv run ruff check .",
	);
	if (verify.exitCode !== 0) {
		console.error(
			"Verification failed after review — skipping publish for this iteration.",
		);
		console.error(verify.stdout);
		console.error(verify.stderr);

		const issueNumber = extractIssueNumber(sandbox.worktreePath);
		if (issueNumber !== undefined) {
			releaseIssueToBacklog(
				issueNumber,
				"Sandcastle verification failed after review (`pytest` / `ruff`). Returned issue to `ready-for-agent` for retry.",
			);
			console.log(
				`Released issue #${issueNumber} back to ${LABEL_READY}.`,
			);
		}

		continue;
	}

	// Phase 3: Publish
	await sandbox.run({
		name: "publisher",
		maxIterations: 1,
		agent,
		promptFile: "./.sandcastle/publish-prompt.md",
		promptArgs: { BRANCH: branch },
	});

	console.log("Publish complete.");
}

console.log("\nAll done.");
