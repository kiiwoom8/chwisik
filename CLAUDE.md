# CLAUDE.md — 직원 취식 목록 (chwisik)

Instructions for Claude (and any other agent or person) working in this repo.

## Git rules — read first

1. **Always work on `main` and push to `main`.** No feature branches, no PRs, unless the owner asks for one.
2. **Every change is committed and pushed right away.** A change that only exists locally is not done.
   - The repo ships a `post-commit` hook (`.githooks/post-commit`) that pushes `main` to `origin` after every commit.
   - After cloning, run `scripts/setup-hooks.sh` once so the hook is active.
   - If the hook could not push (offline, auth), run `git push origin main` yourself before finishing.
3. **Before starting work, sync:** `git pull --rebase origin main`.
4. **Never commit secrets.** The BGF password lives only in the Apps Script project's Script Properties (`BGF_PW`), never in code, docs, or commit messages. If a secret is committed by mistake, tell the owner so the password can be changed.

## Code ↔ Apps Script ↔ GitHub

GitHub (`apps-script/`) is the source of truth for the code.
The live copy runs in Google Apps Script, bound to the spreadsheet **직원 취식 목록**.

- **Auto-deploy is on.** Every push to `main` that touches `apps-script/` runs `.github/workflows/deploy.yml`:
  syntax check → `clasp push` → `clasp deploy` onto the existing web app deployment.
  The staff `/exec` link stays the same and serves the new version a minute later.
  So: commit + push = live. Check the run in the repo's **Actions** tab; a red run means nothing went live.
- `apps-script/appsscript.json` is the manifest (timezone, web app access = anyone). Keep `webapp.access` as `ANYONE_ANONYMOUS` or staff lose access.
- Do not edit code in the Apps Script editor. The next push from GitHub overwrites it. If someone did, run `clasp pull` (or copy it) into `apps-script/` and commit first.
- Commits that should not deploy (docs only) don't need anything: the workflow only runs when `apps-script/` or the deploy config changes.

## Where things are

- `apps-script/Code.gs`: server. BGF login + nightly 폐기 import, sheet setup, web app API.
- `apps-script/Index.html`: the staff page (one-tap 취식 / 폐기, monthly totals).
- `docs/DEVNOTES.md`: architecture, BGF protocol notes, data model, operations, troubleshooting.
- `docs/ROADMAP.md`: future plans (worker app, etc.).

## Conventions

- UI text is Korean. Write it plainly, the way staff talk.
- 취식 records the **full name** (김성휘). 폐기 records the **first name only** (성휘).
- Keep the staff page working on a phone at ~360px width, with no login.
- Check JS syntax before pushing: `node --check` on Code.gs (copied to a `.js` file) and on the `<script>` block of Index.html.
