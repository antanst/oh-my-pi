#!/bin/sh
# Update the custom branch from upstream main, rebuild omp, and install it.
#
# Flow: fetch -> fast-forward local main to upstream/main -> rebase custom
# onto main (aborting cleanly on conflict) -> bun install -> build binary ->
# install to ~/.local/bin/omp. The stock binary is backed up once, the first
# time this script runs, and never overwritten afterwards.
#
# Usage: sh scripts/local-update.sh   (run from anywhere inside the repo)

set -u

die() {
	echo "$*" >&2
	exit 1
}

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || die "Not inside a git repository."
cd "$ROOT" || die "Cannot enter repository root."

DIRTY="$(git status --porcelain)" || die "git status failed."
if [ -n "$DIRTY" ]; then
	die "Working tree is dirty — commit or stash first."
fi

START_BRANCH="$(git branch --show-current 2>/dev/null)"

echo "==> Fetching origin and upstream"
git fetch origin || die "git fetch origin failed."
git fetch upstream || die "git fetch upstream failed."

# Fast-forward local main to upstream/main; refuses if local main diverged.
git fetch upstream main:main || die "Could not fast-forward local main to upstream/main — sync your fork first."

if ! git show-ref --verify --quiet refs/heads/custom; then
	die "Branch 'custom' not found — create it first (git checkout -b custom v18.12.6)."
fi

echo "==> Rebasing custom onto main"
git checkout custom || die "Cannot check out custom."
if ! git rebase main; then
	git rebase --abort
	if [ -n "$START_BRANCH" ]; then
		git checkout "$START_BRANCH" 2>/dev/null
	fi
	die "Rebase conflicted — aborted, 'custom' untouched. Resolve against main manually."
fi

# The native addon is not committed; copy the newest installed one if missing.
NATIVE_FOUND=""
for f in packages/natives/native/pi_natives.*.node; do
	if [ -e "$f" ]; then
		NATIVE_FOUND=1
	fi
done
if [ -z "$NATIVE_FOUND" ]; then
	NATIVE_SRC=""
	for f in "$HOME"/.omp/natives/*/pi_natives.linux-x64-modern.node; do
		if [ -e "$f" ]; then
			NATIVE_SRC="$f"
		fi
	done
	if [ -z "$NATIVE_SRC" ]; then
		echo "No native addon found in ~/.omp/natives — the build may fail or miss natives." >&2
	else
		echo "==> Copying native addon: $NATIVE_SRC"
		cp "$NATIVE_SRC" packages/natives/native/ || die "Failed to copy native addon."
	fi
fi

echo "==> bun install"
bun install || die "bun install failed."

echo "==> Building binary"
(cd packages/coding-agent && bun scripts/build-binary.ts) || die "Build failed."

echo "==> Installing"
if [ -f "$HOME/.local/bin/omp" ] && [ ! -f "$HOME/.local/bin/omp.bak-stock" ]; then
	cp "$HOME/.local/bin/omp" "$HOME/.local/bin/omp.bak-stock" || die "Failed to back up stock binary."
fi
cp packages/coding-agent/dist/omp "$HOME/.local/bin/omp.new" || die "Failed to stage new binary."
mv -f "$HOME/.local/bin/omp.new" "$HOME/.local/bin/omp" || die "Failed to install binary."

"$HOME/.local/bin/omp" --version || die "Installed binary failed to run."
echo "Installed. Restart omp to pick it up."
