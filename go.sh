#!/usr/bin/env bash

# go.sh
#
# Simple release helper for Node.js projects.
#
# This script:
#   1. Verifies that go.sh is located in the Git repository root.
#   2. Reads the current version from package.json.
#   3. Stages all changes with `git add -A`.
#   4. Creates a commit named:
#
#        Release <version>
#
#   5. Pushes the current branch to its configured remote.
#   6. Automatically sets origin as upstream if none is configured.
#
# Requirements:
#   - Git repository already initialized.
#   - package.json exists in the repository root.
#   - package.json contains a valid "version" field.
#   - Node.js and Git are installed.
#   - Git remote (normally "origin") is already configured.
#
# Usage:
#   chmod +x go.sh     # required only once
#   ./go.sh
#
# Example:
#   package.json version: 3.1.28
#   commit message:       Release 3.1.28


set -euo pipefail


# ------------------------------------------------------------
# Colors
# ------------------------------------------------------------

CYAN='\033[1;36m'
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
RED='\033[1;31m'
NC='\033[0m'


# ------------------------------------------------------------
# Move to the directory containing this script
# ------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"


# ------------------------------------------------------------
# Check required commands
# ------------------------------------------------------------

if ! command -v git >/dev/null 2>&1; then
  printf "${RED}Error: Git is not installed${NC}\n"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  printf "${RED}Error: Node.js is not installed${NC}\n"
  exit 1
fi


# ------------------------------------------------------------
# Verify Git repository
# ------------------------------------------------------------

if ! GIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  printf "${RED}Error: this directory is not inside a Git repository${NC}\n"
  exit 1
fi

GIT_ROOT="$(cd "$GIT_ROOT" && pwd)"

if [ "$SCRIPT_DIR" != "$GIT_ROOT" ]; then
  printf "${RED}Error: go.sh must be located in the Git repository root${NC}\n"
  printf "${YELLOW}Git root: %s${NC}\n" "$GIT_ROOT"
  printf "${YELLOW}go.sh:    %s${NC}\n" "$SCRIPT_DIR"
  exit 1
fi


# ------------------------------------------------------------
# Check package.json
# ------------------------------------------------------------

if [ ! -f "package.json" ]; then
  printf "${RED}Error: package.json not found in repository root${NC}\n"
  exit 1
fi


# ------------------------------------------------------------
# Read version from package.json
# ------------------------------------------------------------

if ! VERSION="$(
  node -e "
    try {
      const fs = require('fs');
      const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

      if (!pkg.version || typeof pkg.version !== 'string') {
        process.exit(1);
      }

      process.stdout.write(pkg.version);
    } catch {
      process.exit(1);
    }
  "
)"; then
  printf "${RED}Error: unable to read version from package.json${NC}\n"
  exit 1
fi

if [ -z "$VERSION" ]; then
  printf "${RED}Error: package.json version is empty${NC}\n"
  exit 1
fi


# ------------------------------------------------------------
# Determine current branch
# ------------------------------------------------------------

BRANCH="$(git branch --show-current)"

if [ -z "$BRANCH" ]; then
  printf "${RED}Error: unable to determine current Git branch${NC}\n"
  printf "${YELLOW}The repository may currently be in detached HEAD state${NC}\n"
  exit 1
fi


# ------------------------------------------------------------
# Release
# ------------------------------------------------------------

printf "\n${CYAN}Preparing Release ${VERSION}${NC}\n"
printf "${CYAN}Branch: ${BRANCH}${NC}\n\n"


# Stage all changes
git add -A


# Commit only when staged changes exist
if git diff --cached --quiet; then
  printf "${YELLOW}No changes to commit${NC}\n"
else
  git commit -m "Release $VERSION"
  printf "\n${GREEN}Commit: Release ${VERSION}${NC}\n"
fi


# ------------------------------------------------------------
# Push
# ------------------------------------------------------------

printf "\n${CYAN}Pushing branch: ${BRANCH}${NC}\n\n"

if git rev-parse \
  --abbrev-ref \
  --symbolic-full-name '@{u}' \
  >/dev/null 2>&1; then

  git push

else

  if ! git remote get-url origin >/dev/null 2>&1; then
    printf "${RED}Error: Git remote \"origin\" is not configured${NC}\n"
    exit 1
  fi

  printf "${YELLOW}No upstream configured; setting origin/${BRANCH}${NC}\n\n"

  git push -u origin "$BRANCH"
fi


# ------------------------------------------------------------
# Done
# ------------------------------------------------------------

printf "\n${GREEN}Release ${VERSION} pushed successfully${NC}\n\n"
