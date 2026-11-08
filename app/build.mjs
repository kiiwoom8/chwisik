// Copies the staff page into the app: apps-script/Index.html -> app/www/page.html.
// Run before `npx cap sync` (CI does this). page.html is generated, not committed.
import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
copyFileSync(here("../apps-script/Index.html"), here("www/page.html"));
console.log("www/page.html updated from apps-script/Index.html");
