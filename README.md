# 직원 취식 목록 (chwisik)

Staff meal (취식) and waste (폐기) tracker for CU store 25377.

- Every night around 00:01, yesterday's 폐기 slips are pulled from the BGF 점포시스템 into a Google Sheet automatically.
- Staff open one link on their phone (no login), pick their name once, and tap **취식** or **폐기** on each item.
- Monthly totals per person are shown in the app and in the sheet.

**Staff link:** https://script.google.com/macros/s/AKfycbzmsekRKq8HY5jqog-Dpb80yJqv-n3H4fZMItLZPISuM39M6RVyr3qOtqtz864YwlRKpw/exec

| Folder | Contents |
|---|---|
| `apps-script/` | `Code.gs` (server, BGF import, API) and `Index.html` (staff page) |
| `docs/DEVNOTES.md` | how it works, BGF protocol, sheets, operations, troubleshooting |
| `docs/ROADMAP.md` | worker app and future plans |
| `CLAUDE.md` | working rules: always push to `main`, keep GitHub and Apps Script in sync |

After cloning: `scripts/setup-hooks.sh` (turns on auto-push after every commit).
