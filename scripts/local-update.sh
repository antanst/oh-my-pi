#!/bin/sh
# Update the custom branch from the newest upstream release tag, rebuild omp,
# and install it.
#
# Flow: fetch (including tags) -> pick the newest vX.Y.Z tag -> checkout
# custom -> rebase onto that tag unless custom already contains it (asked
# when interactive; aborting cleanly on conflict) -> skip everything when
# the installed omp already matches this version -> bun install -> build
# to ~/.local/bin/omp. The stock binary is backed up once, the first
# time this script runs, and never overwritten afterwards.
#
# Usage: sh scripts/local-update.sh [--non-interactive] [--force]
#        (run from anywhere inside the repo)

set -u

NON_INTERACTIVE=0
FORCE=0
for arg in "$@"; do
	case "$arg" in
	--non-interactive) NON_INTERACTIVE=1 ;;
	--force) FORCE=1 ;;
	*)
		echo "Usage: sh scripts/local-update.sh [--non-interactive] [--force]" >&2
		exit 1
		;;
	esac
done

die() {
	echo "$*" >&2
	exit 1
}

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || die "Not inside a git repository."
cd "$ROOT" || die "Cannot enter repository root."

# The binary build populates the embedded stats bundle; restore the checked-in
# empty state on every exit so the next run is never flagged dirty.
trap 'git checkout -- packages/stats/src/embedded-client.generated.txt 2>/dev/null' EXIT

DIRTY="$(git status --porcelain --untracked-files=no)" || die "git status failed."
if [ -n "$DIRTY" ]; then
	die "Working tree is dirty — commit or stash first."
fi

START_BRANCH="$(git branch --show-current 2>/dev/null)"

echo "==> Fetching origin and upstream (with tags)"
git fetch origin || die "git fetch origin failed."
git fetch --tags upstream || die "git fetch upstream failed."

# Newest release tag; anything not matching vX.Y.Z exactly is ignored.
TAG="$(git tag -l --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1)"

if ! git show-ref --verify --quiet refs/heads/custom; then
	die "Branch 'custom' not found — create it first (git checkout -b custom v18.12.6)."
fi

echo "==> Checking out custom"
git checkout custom || die "Cannot check out custom."

# Rebase only when the newest release tag is not already contained.
REBASE=0
DECLINED=0
if [ -n "$TAG" ] && ! git merge-base --is-ancestor "$TAG" custom; then
	REBASE=1
fi

if [ "$REBASE" -eq 1 ] && [ "$NON_INTERACTIVE" -eq 0 ]; then
	printf "Newer release tag available: %s\nRebase custom onto it? [Y/n] " "$TAG"
	ANSWER=""
	read -r ANSWER
	case "$ANSWER" in
	n*|N*) REBASE=0; DECLINED=1 ;;
	esac
fi

if [ "$REBASE" -eq 1 ]; then
	echo "==> Rebasing custom onto $TAG"
	if ! git rebase "$TAG"; then
		git rebase --abort
		if [ -n "$START_BRANCH" ]; then
			git checkout "$START_BRANCH" 2>/dev/null
		fi
		die "Rebase conflicted — aborted, 'custom' untouched. Resolve against $TAG manually."
	fi
elif [ "$DECLINED" -eq 1 ]; then
	echo "==> Declined — skipping rebase."
elif [ -n "$TAG" ]; then
	echo "==> custom already contains $TAG — no rebase."
else
	echo "No release tags found — skipping rebase." >&2
fi

# The native addon is not committed; copy the newest installed one if missing.
NATIVE_FOUND=""
for f in packages/natives/native/pi_natives.*.node; do
	if [ -e "$f" ]; then
		NATIVE_FOUND=1
	fi
done

# Skip the whole build when the installed binary already matches this version.
# shortcut: the version is package.json-level — local source commits that do
# not bump it are not rebuilt; bump the version or rebuild manually for those.
TREE_VERSION="$(grep -m1 '"version"' packages/coding-agent/package.json | sed 's/[^0-9.]//g')"
INSTALLED_VERSION="$("$HOME/.local/bin/omp" --version 2>/dev/null)"
SKIP=0
if [ "$REBASE" -eq 0 ] && [ -n "$NATIVE_FOUND" ] && [ "$INSTALLED_VERSION" = "omp/$TREE_VERSION" ]; then
	SKIP=1
fi
if [ "$SKIP" -eq 1 ] && [ "$FORCE" -eq 1 ]; then
	echo "==> --force: rebuilding despite matching version."
	SKIP=0
fi
if [ "$SKIP" -eq 1 ]; then
	echo "==> Already built $INSTALLED_VERSION — nothing to do."
	exit 0
fi

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
