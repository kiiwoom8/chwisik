# CLAUDE.md — 직원 취식 목록 (chwisik)

Instructions for Claude (and any other agent or person) working in this repo.

## Git rules — read first

1. **Always work on `main` and push to `main`.** No feature branches, no PRs, unless the owner asks for one.
2. **Every change is committed and pushed right away.** A change that only exists locally is not done.
   - The repo ships a `post-commit` hook (`.githooks/post-commit`) that pushes `main` to `origin` after every commit.
   - After cloning, run `scripts/setup-hooks.sh` once so the hook is active.
   - If the hook could not push (offline, auth), run `git push origin main` yourself before finishing.
3. **Before starting work, sync:** `git pull --rebase origin main`.
4. **Update the docs in the same commit as every change.** A change is not done until the docs match it:
   - `docs/HISTORY.md`: always add an entry (what changed and why; decisions; anything not verified).
   - `docs/DEVNOTES.md`: whenever behavior, sheets/columns, Script Properties, BGF calls, API/row shapes, menu or operations change. Bump its "Last updated" line.
   - `docs/CODEMAP.md`: whenever functions are added, renamed, removed or change role.
   - `docs/ROADMAP.md`: strike through items that got done; add new ideas the owner mentions.
   - `README.md` / this file: when the overview, layout or rules change.
5. **Never commit secrets.** The BGF password lives only in the Apps Script project's Script Properties (`BGF_PW`), never in code, docs, or commit messages. If a secret is committed by mistake, tell the owner so the password can be changed.

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

Start with `docs/DEVNOTES.md`, then `docs/CODEMAP.md` for the code you are about to touch.

- `apps-script/Code.gs`: server. BGF login + nightly and live import (폐기 and 저회전상품철수), 출근일지, passwords, sheet setup, web app API.
- `apps-script/Index.html`: the staff page (one-tap 취식 / 폐기, 저회전, 취소, 출근일지, monthly totals).
- `docs/DEVNOTES.md`: what it does, live resources, sheets and columns, Script Properties, BGF protocol, API shapes, page behavior, operations, gotchas.
- `docs/CODEMAP.md`: function-by-function map of both files, data flows, recipes for common changes.
- `docs/HISTORY.md`: every change with commit id and reason.
- `docs/ROADMAP.md`: future plans (worker app, etc.).

## Conventions

- UI text is Korean. Write it plainly, the way staff talk.
- 취식 records the **full name** (김성휘). 폐기 records the **first name only** (성휘).
- 저회전 lines (폐기목록 column S = `저회전`) can be 취식 only, never 폐기, and don't count as 미등록.
- Code.gs functions without a trailing `_` are public (callable from the /exec link): check the caller in every new one.
- Never type the BGF password anywhere; BGF's static form scripts (`/websrc/deploy/GJ/*.xfdl.js`) can be read without logging in.
- Keep the staff page working on a phone at ~360px width, with no login.
- Check JS syntax before pushing: `node --check` on Code.gs (copied to a `.js` file) and on the `<script>` block of Index.html.
