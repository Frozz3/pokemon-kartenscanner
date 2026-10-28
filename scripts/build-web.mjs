// Copies the web app into www/ for the iOS app (Capacitor) and stamps the build number.
// Usage: node scripts/build-web.mjs [buildNumber]
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
const build = Number(process.argv[2] || 0);
rmSync("www", { recursive: true, force: true });
mkdirSync("www", { recursive: true });
for (const f of ["index.html", "styles.css", "app.js", "config.js", "manifest.webmanifest", "vendor", "icons"]) cpSync(f, `www/${f}`, { recursive: true });
rmSync("www/icons/splash", { recursive: true, force: true }); // web-only launch images; the app has its own
writeFileSync("www/version.json", JSON.stringify({ build, builtAt: new Date().toISOString() }) + "\n");
console.log(`www/ ready (build ${build})`);
