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

- After changing `apps-script/Code.gs` or `apps-script/Index.html`:
  1. Commit and push (the hook pushes).
  2. Copy the same code into the Apps Script editor and save. (Or use `clasp push` once clasp is set up; see `docs/DEVNOTES.md`.)
  3. **Redeploy the web app:** Deploy → Manage deployments → pencil → Version: *New version* → Deploy.
     Saving the code alone does **not** change what staff see at the `/exec` link.
- If someone edits code directly in the Apps Script editor, copy it back into `apps-script/` and commit, so GitHub never falls behind.

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
