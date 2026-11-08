#!/bin/sh
# Turn on this repo's git hooks (auto-push to main after every commit).
cd "$(git rev-parse --show-toplevel)" || exit 1
chmod +x .githooks/*
git config core.hooksPath .githooks
git config pull.rebase true
echo "Hooks enabled: commits on main are pushed to origin automatically."
