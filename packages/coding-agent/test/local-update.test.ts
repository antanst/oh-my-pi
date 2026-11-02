import { afterEach, describe, expect, it } from "bun:test";
import { $ } from "bun";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vcs from "@oh-my-pi/pi-natives/vcs";
import { removeWithRetries } from "@oh-my-pi/pi-utils";

const updater = path.resolve(import.meta.dir, "../../../scripts/local-update.sh");
const bundle = "packages/stats/src/embedded-client.generated.txt";
const roots: string[] = [];

interface Fixture {
	root: string;
	work: string;
	upstream: string;
	origin: string;
	home: string;
	env: Record<string, string | undefined>;
}

/** Run fixture-only Git operations not exposed by the native repository adapter. */
async function git(fixture: Fixture, cwd: string, ...args: string[]): Promise<void> {
	await $`git ${args}`.cwd(cwd).env(fixture.env).quiet();
}

/** Commit fixture content through the shared VCS adapter. */
async function commit(cwd: string, file: string, content: string): Promise<string> {
	await Bun.write(path.join(cwd, file), content);
	const repo = vcs.requireGit(cwd);
	await repo.stageFiles([file]);
	return repo.commitCreate(`Update ${file}`, {});
}

/** Set local identity and disable host-specific commit behavior. */
async function configure(cwd: string): Promise<void> {
	const repo = vcs.requireGit(cwd);
	for (const [key, value] of Object.entries({
		"user.name": "Updater Test",
		"user.email": "updater@example.test",
		"commit.gpgsign": "false",
		"core.hooksPath": "/dev/null",
		"core.autocrlf": "false",
	})) {
		await repo.configSet(key, value);
	}
}

/** Create local remotes and an isolated installation, replacing only the build producer. */
async function fixture(): Promise<Fixture> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-local-update-"));
	roots.push(root);
	const work = path.join(root, "work");
	const upstream = path.join(root, "upstream");
	const origin = path.join(root, "origin.git");
	const home = path.join(root, "home");
	const bin = path.join(root, "bin");
	const env = {
		...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
		HOME: home,
		XDG_CONFIG_HOME: path.join(home, ".config"),
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_SYSTEM: "/dev/null",
		GIT_TERMINAL_PROMPT: "0",
		GIT_EDITOR: "true",
		PATH: `${bin}:${process.env.PATH}`,
		CROSS_TARGET: "",
		BUILD_MODE: "success",
		FIXTURE_ROOT: root,
		FIXTURE_REPO: work,
	};
	const result = { root, work, upstream, origin, home, env };
	await fs.mkdir(upstream);
	await git(result, upstream, "init", "-q", "-b", "main");
	await configure(upstream);
	await Bun.write(path.join(upstream, bundle), "checked-in stats\n");
	await Bun.write(path.join(upstream, "packages/coding-agent/package.json"), '{"version":"1.0.0"}\n');
	await vcs.requireGit(upstream).stageFiles([bundle, "packages/coding-agent/package.json"]);
	await vcs.requireGit(upstream).commitCreate("Initial release", {});
	await git(result, root, "clone", "--bare", upstream, origin);
	await git(result, root, "clone", "--origin", "upstream", upstream, work);
	await configure(work);
	await vcs.requireGit(work).remoteAdd("origin", origin);
	await git(result, work, "checkout", "-b", "custom");
	await commit(work, "custom.txt", "local custom commit\n");
	await Bun.write(path.join(home, ".local/bin/omp"), '#!/bin/sh\nprintf "omp/0.0.0\\n"\n');
	await fs.chmod(path.join(home, ".local/bin/omp"), 0o755);
	await Bun.write(
		path.join(bin, "bun"),
		`#!/bin/sh
case "$*" in
install|"run build:native") exit 0 ;;
scripts/build-binary.ts) ;;
*) exit 99 ;;
esac
printf 'generated stats\n' > "$FIXTURE_REPO/${bundle}"
case "$BUILD_MODE" in
fail) exit 23 ;;
wait)
	: > "$FIXTURE_ROOT/build-ready"
	while [ ! -f "$FIXTURE_ROOT/build-release" ]; do sleep 0.01; done
	;;
esac
mkdir -p dist
output=dist/omp
if [ -n "\${CROSS_TARGET:-}" ]; then output="dist/omp-$CROSS_TARGET"; fi
printf '#!/bin/sh\nprintf "omp/1.0.0\\\\n"\n' > "$output"
chmod +x "$output"
`,
	);
	await fs.chmod(path.join(bin, "bun"), 0o755);
	return result;
}

/** Start the real dash updater without inheriting terminal or installation state. */
function start(fixture: Fixture, args = ["--non-interactive"], input = "") {
	return Bun.spawn(["dash", updater, ...args], {
		cwd: fixture.work,
		env: fixture.env,
		stdin: new Blob([input]),
		stdout: "pipe",
		stderr: "pipe",
	});
}

/** Collect diagnostics with the exit status so failed expectations remain actionable. */
async function finish(proc: Bun.Subprocess<Blob, "pipe", "pipe">) {
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}

/** Wait for the fake producer to change the bundle before delivering a signal. */
async function waitForBuild(fixture: Fixture): Promise<void> {
	const deadline = Date.now() + 5_000;
	while (!(await Bun.file(path.join(fixture.root, "build-ready")).exists())) {
		if (Date.now() >= deadline) throw new Error("Updater did not reach the binary build");
		// The external dash producer uses the real filesystem, not Bun's timer clock.
		await Bun.sleep(10);
	}
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => removeWithRetries(root)));
});

describe("local updater safety", () => {
	it.each([false, true])("preserves exact pre-existing bundle edits (staged: %s)", async staged => {
		const f = await fixture();
		const content = "user stats\n\u0000keep these bytes\r\n";
		await Bun.write(path.join(f.work, bundle), content);
		if (staged) await vcs.requireGit(f.work).stageFiles([bundle]);
		const before = await vcs.requireGit(f.work).statusPorcelain({});
		const result = await finish(start(f));
		expect(result.exitCode).not.toBe(0);
		expect(await Bun.file(path.join(f.work, bundle)).text()).toBe(content);
		expect(await vcs.requireGit(f.work).statusPorcelain({})).toBe(before);
		expect(await Bun.file(path.join(f.home, ".local/bin/omp.bak-stock")).exists()).toBe(false);
	});

	it.each([false, true])(
		"uses the advertised upstream object despite conflicting tags (annotated: %s)",
		async annotated => {
			const f = await fixture();
			await git(f, f.upstream, "tag", "v1.9.0");
			const release = await commit(f.upstream, "official.txt", "official release\n");
			await git(f, f.upstream, "tag", ...(annotated ? ["-a", "-m", "Official release"] : []), "v1.10.0");
			await commit(f.upstream, "unreleased.txt", "not released\n");
			await git(f, f.upstream, "tag", "v999.0.0-rc.1");
			await git(f, f.origin, "tag", "v900.0.0");
			await git(f, f.work, "tag", "v800.0.0");
			await git(f, f.work, "tag", "v1.10.0");
			const repo = vcs.requireGit(f.work);
			const conflict = await repo.resolveRef("refs/tags/v1.10.0");
			const result = await finish(start(f));
			expect(result).toMatchObject({ exitCode: 0 });
			expect(await repo.resolveRef("HEAD^")).toBe(release);
			expect(await repo.resolveRef("refs/tags/v1.10.0")).toBe(conflict);
			expect(await Bun.file(path.join(f.work, "custom.txt")).text()).toBe("local custom commit\n");
			expect(await Bun.file(path.join(f.work, "unreleased.txt")).exists()).toBe(false);
		},
	);

	it("installs a fresh local binary despite CROSS_TARGET and a stale dist/omp", async () => {
		const f = await fixture();
		f.env.CROSS_TARGET = "windows-arm64";
		const stale = '#!/bin/sh\nprintf "omp/stale\\n"\n';
		await Bun.write(path.join(f.work, "packages/coding-agent/dist/omp"), stale);
		await fs.chmod(path.join(f.work, "packages/coding-agent/dist/omp"), 0o755);
		const stock = await Bun.file(path.join(f.home, ".local/bin/omp")).text();
		const result = await finish(start(f));
		expect(result).toMatchObject({ exitCode: 0 });
		expect(await Bun.file(path.join(f.home, ".local/bin/omp")).text()).not.toBe(stale);
		expect(await Bun.file(path.join(f.home, ".local/bin/omp.bak-stock")).text()).toBe(stock);
		expect(result.stdout).toContain("omp/1.0.0");
		expect(await Bun.file(path.join(f.work, bundle)).text()).toBe("checked-in stats\n");
	});

	it("restores generated stats after a failed build without installing", async () => {
		const f = await fixture();
		f.env.BUILD_MODE = "fail";
		const installed = await Bun.file(path.join(f.home, ".local/bin/omp")).text();
		const result = await finish(start(f));
		expect(result.exitCode).not.toBe(0);
		expect(await Bun.file(path.join(f.work, bundle)).text()).toBe("checked-in stats\n");
		expect(await Bun.file(path.join(f.home, ".local/bin/omp")).text()).toBe(installed);
	});

	it.each(["SIGHUP", "SIGINT", "SIGTERM"] as const)(
		"restores generated stats and fails on %s",
		async signal => {
			const f = await fixture();
			f.env.BUILD_MODE = "wait";
			const installed = await Bun.file(path.join(f.home, ".local/bin/omp")).text();
			const proc = start(f);
			const result = finish(proc);
			try {
				await waitForBuild(f);
				expect(await Bun.file(path.join(f.work, bundle)).text()).toBe("generated stats\n");
				proc.kill(signal);
			} finally {
				await Bun.write(path.join(f.root, "build-release"), "");
				await result;
			}
			expect((await result).exitCode).not.toBe(0);
			expect(await Bun.file(path.join(f.work, bundle)).text()).toBe("checked-in stats\n");
			expect(await Bun.file(path.join(f.home, ".local/bin/omp")).text()).toBe(installed);
		},
		15_000,
	);

	it("keeps the version-only skip and lets --force rebuild", async () => {
		const f = await fixture();
		const installed = '#!/bin/sh\nprintf "omp/1.0.0\\n"\n# existing installation\n';
		await Bun.write(path.join(f.home, ".local/bin/omp"), installed);
		await Bun.write(path.join(f.work, "packages/natives/native/pi_natives.test.node"), "addon");
		f.env.BUILD_MODE = "fail";
		expect(await finish(start(f))).toMatchObject({ exitCode: 0 });
		expect(await Bun.file(path.join(f.home, ".local/bin/omp")).text()).toBe(installed);
		f.env.BUILD_MODE = "success";
		expect(await finish(start(f, ["--non-interactive", "--force"]))).toMatchObject({ exitCode: 0 });
		expect(await Bun.file(path.join(f.home, ".local/bin/omp")).text()).not.toBe(installed);
	});

	it("allows an interactive decline without rebasing", async () => {
		const f = await fixture();
		await commit(f.upstream, "official.txt", "new release\n");
		await git(f, f.upstream, "tag", "v2.0.0");
		const before = await vcs.requireGit(f.work).headSha();
		expect(await finish(start(f, [], "n\n"))).toMatchObject({ exitCode: 0 });
		expect(await vcs.requireGit(f.work).headSha()).toBe(before);
	});
});
