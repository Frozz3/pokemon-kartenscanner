// Builds www/ for the native apps (Capacitor) and applies the settings of this instance.
//
// Instance settings come from environment variables, set as GitHub repository variables
// (Settings → Secrets and variables → Actions → Variables), so a fork needs no code changes:
//   SUPABASE_URL   https address of the Supabase project (cloud or self-hosted)
//   SUPABASE_KEY   its publishable ("sb_publishable_…") or anon key, never the secret/service_role key
//   APP_ID         optional app id, e.g. io.github.yourname.kartenscanner (default derived from the GitHub owner)
//   APP_NAME       optional name under the icon (default "Kartenscanner")
// GITHUB_REPOSITORY / GITHUB_REPOSITORY_OWNER are set by GitHub Actions and tell the app where to look for updates.
//
// Usage: node scripts/build-web.mjs [buildNumber]
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const env = process.env;
const fail = msg => { console.error(`\n✖ ${msg}\n`); process.exit(1); };
const build = Number(process.argv[2] || env.BUILD_NUMBER || 0);
const UPSTREAM = "Frozz3/pokemon-kartenscanner";
const repo = env.GITHUB_REPOSITORY || "";

rmSync("www", { recursive: true, force: true });
mkdirSync("www", { recursive: true });
for (const f of ["index.html", "styles.css", "app.js", "sync.js", "config.js", "manifest.webmanifest", "vendor", "icons"]) cpSync(f, `www/${f}`, { recursive: true });
rmSync("www/icons/splash", { recursive: true, force: true }); // web-only launch images; the apps have their own

// --- Server (Supabase) of this instance ---
const url = (env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const key = (env.SUPABASE_KEY || "").trim();
if (url || key) {
  if (!url || !key) fail("SUPABASE_URL und SUPABASE_KEY müssen beide gesetzt sein.");
  let u;
  try { u = new URL(url); } catch (_) { fail(`SUPABASE_URL ist keine gültige Adresse: ${url}`); }
  if (u.protocol !== "https:") fail("SUPABASE_URL muss mit https:// beginnen (Android und iOS erlauben nur verschlüsselte Verbindungen).");
  const role = (() => { try { return JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role; } catch (_) { return null; } })();
  if (/^sb_secret_/.test(key) || role === "service_role") fail("SUPABASE_KEY ist ein GEHEIMER Schlüssel. Nimm den publishable- bzw. anon-Schlüssel (Project Settings → API) und tausche den geheimen Schlüssel in Supabase aus.");
  writeFileSync("www/config.js", `// Generated at build time from the repository variables SUPABASE_URL and SUPABASE_KEY.\nwindow.KS_CONFIG = ${JSON.stringify({ supabaseUrl: u.origin, supabaseKey: key }, null, 2)};\n`);
  // Content Security Policy: allow exactly this server instead of all *.supabase.co projects.
  const html = readFileSync("www/index.html", "utf8");
  const csp = html.replace("https://*.supabase.co wss://*.supabase.co", `${u.origin} wss://${u.host}`);
  if (csp === html) fail("Die Content-Security-Policy in index.html ließ sich nicht an den Server anpassen.");
  writeFileSync("www/index.html", csp);
  console.log(`Server: ${u.origin}`);
} else if (repo && repo !== UPSTREAM) {
  fail(`Dieser Fork (${repo}) hat noch keinen eigenen Server eingetragen.\nLeg unter Settings → Secrets and variables → Actions → Variables die Variablen SUPABASE_URL und SUPABASE_KEY an (siehe README, „Eigene Instanz“).`);
}

// --- App id and name (capacitor.config.json is only changed in the build checkout) ---
const cfg = JSON.parse(readFileSync("capacitor.config.json", "utf8"));
const owner = (env.GITHUB_REPOSITORY_OWNER || repo.split("/")[0] || "").toLowerCase();
const fromOwner = owner && owner !== "frozz3" ? `io.github.${owner.replace(/[^a-z0-9]+/g, "_").replace(/^([^a-z])/, "x$1")}.kartenscanner` : null;
const appId = (env.APP_ID || "").trim() || fromOwner || cfg.appId;
if (!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(appId)) fail(`APP_ID „${appId}“ ist ungültig (Beispiel: io.github.deinname.kartenscanner).`);
const appName = (env.APP_NAME || "").trim() || cfg.appName;
if (appId !== cfg.appId || appName !== cfg.appName) {
  cfg.appId = appId; cfg.appName = appName;
  writeFileSync("capacitor.config.json", JSON.stringify(cfg, null, 2) + "\n");
}

// --- Version info read by the app (update check looks at this repository's releases) ---
writeFileSync("www/version.json", JSON.stringify({ build, repo, builtAt: new Date().toISOString() }) + "\n");
console.log(`www/ ready: build ${build}, app ${appId} („${appName}“)${repo ? `, updates from ${repo}` : ""}`);
