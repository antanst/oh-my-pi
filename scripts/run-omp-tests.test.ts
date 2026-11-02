import { expect, test } from "bun:test";
import { $ } from "bun";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");
const runner = path.join(repoRoot, "scripts-local/run-omp-tests.sh");

test("preserves a failed suite's exit code and stops later suites from another directory", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp test runner-"));
	try {
		const bun = path.join(root, "bun");
		const laterSuite = path.join(root, "later-suite");
		await Bun.write(
			bun,
			`#!/bin/sh
[ "$PWD" = "$EXPECTED_ROOT" ] || exit 99
case "$*" in
"run test") exit 37 ;;
*) : > "$LATER_SUITE" ;;
esac
`,
		);
		await fs.chmod(bun, 0o755);
		const result = await $`sh ${runner}`
			.cwd(root)
			.env({ ...process.env, PATH: `${root}:${process.env.PATH}`, EXPECTED_ROOT: repoRoot, LATER_SUITE: laterSuite })
			.quiet()
			.nothrow();
		expect(result.exitCode).toBe(37);
		expect(await Bun.file(laterSuite).exists()).toBe(false);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});
