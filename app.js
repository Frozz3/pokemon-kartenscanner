/* Pokémon Kartenscanner – web app (GitHub Pages) and iOS app (the same code in a Capacitor shell).
 * Storage: Supabase account, with a local copy in IndexedDB.
 * Recognition: Anthropic Messages API with the user's own key (stored only in this browser).
 * Prices: Cardmarket data from the free TCGdex API (https://tcgdex.dev).
 */
(() => {
  "use strict";

  // ---------- helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
  const usdF = new Intl.NumberFormat("de-DE", { style: "currency", currency: "USD" });
  const num = v => (typeof v === "number" && isFinite(v)) ? v : null;
  const money = v => num(v) === null ? "–" : eur.format(v);
  const usd = v => num(v) === null ? "–" : usdF.format(v);
  const r2 = v => num(v) === null ? null : Math.round(v * 100) / 100;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const dt = ts => ts ? new Date(ts).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "–";
  const dOnly = ts => ts ? new Date(ts).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "–";
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const parsePrice = s => { if (s === "" || s == null) return null; const v = parseFloat(String(s).replace(/\s|€/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".")); return isFinite(v) ? Math.round(v * 100) / 100 : null; };
  const priceInput = v => num(v) === null ? "" : v.toFixed(2).replace(".", ",");
  const stripId = o => { const { id, ...rest } = o; return rest; };
  const clone = o => JSON.parse(JSON.stringify(o));

  const CONDITIONS = [["MT", "Mint"], ["NM", "Near Mint"], ["EX", "Excellent"], ["GD", "Good"], ["LP", "Light Played"], ["PL", "Played"], ["PO", "Poor"]];
  const LANGS = [["DE", "Deutsch"], ["EN", "Englisch"], ["JP", "Japanisch"], ["FR", "Französisch"], ["IT", "Italienisch"], ["ES", "Spanisch"], ["PT", "Portugiesisch"], ["KO", "Koreanisch"], ["ZH", "Chinesisch"]];
  const MODELS = [["claude-sonnet-5-5", "Genau (empfohlen)"], ["claude-haiku-5-5", "Schnell & günstig"]];
  const condLabel = c => (CONDITIONS.find(x => x[0] === c) || [c, c || "–"])[1];
  const langLabel = c => (LANGS.find(x => x[0] === c) || [c, c || "–"])[1];

  // ---------- error log (local, shown in the admin area) ----------
  const ERRLOG_KEY = "ks-errlog";
  function logErr(where, e) {
    try {
      const msg = e == null ? "" : typeof e === "string" ? e : (e.message || e.code || (e.status ? "HTTP " + e.status : "") || JSON.stringify(e)).toString();
      const list = JSON.parse(localStorage.getItem(ERRLOG_KEY) || "[]");
      list.push({ t: Date.now(), w: String(where).slice(0, 60), m: String(msg).slice(0, 400) });
      localStorage.setItem(ERRLOG_KEY, JSON.stringify(list.slice(-100)));
    } catch (_) {}
  }
  const readErrLog = () => { try { return JSON.parse(localStorage.getItem(ERRLOG_KEY) || "[]"); } catch (_) { return []; } };
  window.addEventListener("error", e => logErr("Fehler", (e && e.message) + (e && e.filename ? ` (${String(e.filename).split("/").pop()}:${e.lineno})` : "")));
  window.addEventListener("unhandledrejection", e => logErr("Promise", e && e.reason));

  // ---------- native app (Capacitor on iOS) ----------
  // In the iOS app the same code runs inside a native shell; these hooks add haptics, status bar
  // colours, native sharing and an update hint. In the browser they do nothing.
  const Cap = window.Capacitor;
  const NATIVE = !!(Cap && typeof Cap.isNativePlatform === "function" && Cap.isNativePlatform());
  const plug = n => (NATIVE && Cap.Plugins && Cap.Plugins[n]) || null;
  const quiet = p => { try { Promise.resolve(p).catch(() => {}); } catch (_) {} };
  function haptic(kind = "light") {
    const h = plug("Haptics");
    if (!h) { if (kind === "medium" && navigator.vibrate) navigator.vibrate(12); return; }
    try { quiet(kind === "success" || kind === "warning" || kind === "error" ? h.notification({ type: kind.toUpperCase() }) : h.impact({ style: kind.toUpperCase() })); } catch (_) {}
  }
  const statusBar = darkBg => { const p = plug("StatusBar"); if (p) try { quiet(p.setStyle({ style: darkBg ? "DARK" : "LIGHT" })); } catch (_) {} };
  if (NATIVE) {
    document.documentElement.classList.add("native");
    const vp = document.querySelector('meta[name="viewport"]'); if (vp) vp.setAttribute("content", "width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover");
  }
  const RELEASE_PAGE = "https://github.com/Frozz3/pokemon-kartenscanner/releases/tag/ios-latest";
  const app = { build: 0, update: 0 };
  async function checkAppUpdate() {
    if (!NATIVE) return;
    try { app.build = Number((await (await fetch("version.json", { cache: "no-store" })).json()).build) || 0; } catch (_) {}
    let last = 0, known = 0; try { last = Number(localStorage.getItem("ks-updchk") || 0); known = Number(localStorage.getItem("ks-updbuild") || 0); } catch (_) {}
    if (Date.now() - last > 6 * 3600e3) {
      try {
        const r = await fetch("https://api.github.com/repos/Frozz3/pokemon-kartenscanner/releases/tags/ios-latest", { headers: { accept: "application/vnd.github+json" } });
        if (r.ok) { const m = /Build\s+(\d+)/i.exec((await r.json()).name || ""); known = m ? Number(m[1]) : 0; }
        localStorage.setItem("ks-updchk", String(Date.now())); localStorage.setItem("ks-updbuild", String(known));
      } catch (_) {}
    }
    app.update = app.build && known > app.build ? known : 0;
    if (app.update) {
      let told = 0; try { told = Number(localStorage.getItem("ks-updtold") || 0); } catch (_) {}
      if (told !== app.update) { try { localStorage.setItem("ks-updtold", String(app.update)); } catch (_) {} setTimeout(() => toast("Eine neue App-Version ist da. Details unter Einstellungen → App."), 1500); }
    }
    if (state.sheet && state.sheet.type === "settings") renderSheet();
  }

  // ---------- settings (localStorage) ----------
  const settings = (() => {
    const read = (k, d) => { try { const v = localStorage.getItem("ks-" + k); return v === null ? d : v; } catch (_) { return d; } };
    const write = (k, v) => { try { if (v === null || v === "") localStorage.removeItem("ks-" + k); else localStorage.setItem("ks-" + k, v); } catch (_) {} };
    return {
      // The API key belongs to the signed-in account on this device (others on the same phone don't use it).
      get apiKey() { const u = window.__ksUid; return u ? read("apikey:" + u, "") : ""; },
      set apiKey(v) { const u = window.__ksUid; if (u) write("apikey:" + u, v); },
      get closeLogout() { return read("closelogout", "1") === "1"; }, set closeLogout(v) { write("closelogout", v ? "1" : "0"); },
      get tech() { return read("tech", "0") === "1"; }, set tech(v) { write("tech", v ? "1" : "0"); },
      get model() { return read("model", MODELS[0][0]); }, set model(v) { write("model", v); },
      get sort() { return read("sort", "value"); }, set sort(v) { write("sort", v); },
      get sound() { return read("sound", "1") === "1"; }, set sound(v) { write("sound", v ? "1" : "0"); },
      get auto() { return read("auto", "1") === "1"; }, set auto(v) { write("auto", v ? "1" : "0"); },
      get setSort() { return read("setsort", "progress"); }, set setSort(v) { write("setsort", v); },
      get cardSort() { return read("cardsort", "num"); }, set cardSort(v) { write("cardsort", v); },
      get theme() { const t = read("theme", "auto"); return t === "light" || t === "dark" ? t : "auto"; }, set theme(v) { write("theme", v === "auto" ? "" : v); },
      get idle() { const n = Number(read("idle", "15")); return isFinite(n) ? n : 15; }, set idle(v) { write("idle", String(v)); },
    };
  })();

  // ---------- Supabase (login, data, photos) ----------
  // Each record is stored as one row {id, data} in its table; Row Level Security limits
  // every row and every photo to the account that created it (see supabase/schema.sql).
  const CFG = window.KS_CONFIG || {};
  const BUCKET = "card-images";
  const APP_URL = location.origin + location.pathname;
  let sb = null;

  // Local copy of the account's data on this device (IndexedDB), so the app starts instantly and
  // only changes are downloaded. Keys: "<user>|<table>|<id>".
  const Cache = (() => {
    let opening = null;
    const open = () => opening || (opening = new Promise((res, rej) => {
      const r = indexedDB.open("kartenscanner-cache", 1);
      r.onupgradeneeded = () => { const d = r.result; d.createObjectStore("rows", { keyPath: "k" }); d.createObjectStore("meta"); };
      r.onsuccess = () => res(r.result); r.onerror = () => { opening = null; rej(r.error); };
    }));
    const run = async (store, mode, fn) => {
      const d = await open();
      return new Promise((res, rej) => { const t = d.transaction(store, mode); let out; try { out = fn(t.objectStore(store)); } catch (e) { rej(e); return; } t.oncomplete = () => res(out && "result" in out ? out.result : undefined); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
    };
    const key = (uid, t, id) => `${uid}|${t}|${id}`;
    return {
      async load(uid) {
        const rows = await run("rows", "readonly", st => st.getAll(IDBKeyRange.bound(uid + "|", uid + "|￿")));
        const out = { cards: [], sessions: [], items: [], history: [] };
        for (const r of rows || []) if (out[r.t]) out[r.t].push(r.o);
        return out;
      },
      put: (uid, t, objs) => run("rows", "readwrite", st => { for (const o of objs) st.put({ k: key(uid, t, o.id), t, o: clone(o) }); }).catch(() => {}),
      del: (uid, t, ids) => run("rows", "readwrite", st => { for (const id of ids) st.delete(key(uid, t, id)); }).catch(() => {}),
      getMeta: uid => run("meta", "readonly", st => st.get(uid)).catch(() => null),
      accounts: async () => {
        const rows = await run("rows", "readonly", st => st.getAll());
        const by = new Map();
        for (const r of rows || []) { const u = String(r.k).split("|")[0]; const a = by.get(u) || { uid: u, cards: 0, qty: 0, value: 0, sessions: 0, history: 0 }; if (r.t === "cards") { a.cards++; a.qty += r.o.qty || 1; a.value += (num(r.o.priceEur) || 0) * (r.o.qty || 1); } else if (r.t === "sessions") a.sessions++; else if (r.t === "history") a.history++; by.set(u, a); }
        return [...by.values()];
      },
      clear: uid => Promise.all([run("rows", "readwrite", st => { st.delete(IDBKeyRange.bound(uid + "|", uid + "|\uffff")); }), run("meta", "readwrite", st => { st.delete(uid); })]).catch(() => {}),
      setMeta: (uid, m) => run("meta", "readwrite", st => { st.put(m, uid); }).catch(() => {}),
    };
  })();
  // In a browser others may use, signing out also removes the collection from this device.
  // The iOS app keeps it: it is a personal device, and the copy makes restoring an account possible.
  const dropDeviceCopy = () => { if (!NATIVE && state.user) Cache.clear(state.user.id); };
  const CHUNK = 100;
  const chunks = (a, n = CHUNK) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };
  const uidNow = () => state.user && state.user.id;

  const Store = {
    async all(t) { return (await Store.since(t, null)).rows; },
    // Rows changed after `since` (ISO time; null = everything), with the newest server timestamp seen.
    async since(t, since) {
      const rows = []; let max = since || "";
      for (let from = 0; ; from += 1000) {
        let q = sb.from(t).select("id,data,updated_at");
        if (since) q = q.gt("updated_at", since).order("updated_at");
        const { data, error } = await q.range(from, from + 999);
        if (error) throw error;
        for (const r of data) { rows.push({ ...r.data, id: r.id }); if (r.updated_at && r.updated_at > max) max = r.updated_at; }
        if (data.length < 1000) break;
      }
      return { rows, max };
    },
    async ids(t) {
      const out = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from(t).select("id").range(from, from + 999);
        if (error) throw error;
        out.push(...data.map(r => r.id)); if (data.length < 1000) break;
      }
      return out;
    },
    async put(t, obj) { return Store.putMany(t, [obj]); },
    // One request per 100 rows instead of one per row.
    async putMany(t, objs) {
      if (!objs.length) return;
      const now = new Date().toISOString();
      for (const part of chunks(objs)) {
        const { error } = await sb.from(t).upsert(part.map(o => { const { id, ...rest } = o; return { id, data: rest, updated_at: now }; }));
        if (error) throw error;
      }
      if (uidNow()) Cache.put(uidNow(), t, objs);
    },
    async del(t, id) { return Store.delMany(t, [id]); },
    async delMany(t, ids) {
      if (!ids.length) return;
      for (const part of chunks(ids)) { const { error } = await sb.from(t).delete().in("id", part); if (error) throw error; }
      if (uidNow()) Cache.del(uidNow(), t, ids);
    },
  };
  const Img = {
    path: id => `${state.user.id}/${id}.jpg`,
    async put(id, dataURL) {
      const { error } = await sb.storage.from(BUCKET).upload(Img.path(id), dataURLtoBlob(dataURL), { contentType: "image/jpeg", upsert: true });
      if (error) throw error;
    },
    async blob(id) { const { data, error } = await sb.storage.from(BUCKET).download(Img.path(id)); if (error) throw error; return data; },
    async url(id) {
      if (state.imgCache.has(id)) return state.imgCache.get(id);
      const u = URL.createObjectURL(await Img.blob(id)); state.imgCache.set(id, u); return u;
    },
    async del(id) { if (!id) return; state.imgCache.delete(id); try { await sb.storage.from(BUCKET).remove([Img.path(id)]); } catch (_) {} },
    async delMany(ids) { ids = ids.filter(Boolean); ids.forEach(id => state.imgCache.delete(id)); for (const part of chunks(ids)) { try { await sb.storage.from(BUCKET).remove(part.map(Img.path)); } catch (_) {} } },
  };

  // Data from the first, device-only version (IndexedDB), offered once for import into the account.
  const Legacy = {
    read() {
      return new Promise(res => {
        if (!("indexedDB" in window)) return res(null);
        let r;
        try { r = indexedDB.open("kartenscanner", 1); } catch (_) { return res(null); }
        r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (_) {} };
        r.onerror = () => res(null);
        r.onsuccess = () => {
          const d = r.result, stores = ["cards", "sessions", "items", "images"].filter(n => d.objectStoreNames.contains(n));
          if (!stores.length) { d.close(); return res(null); }
          const out = {}; let left = stores.length;
          const t = d.transaction(stores, "readonly");
          const done = () => { if (--left === 0) { d.close(); res(out); } };
          for (const n of stores) { const q = t.objectStore(n).getAll(); q.onsuccess = () => { out[n] = q.result || []; done(); }; q.onerror = () => { out[n] = []; done(); }; }
        };
      });
    },
    clear() { try { indexedDB.deleteDatabase("kartenscanner"); } catch (_) {} },
  };

  const state = {
    cards: [], sessions: [], items: [], open: null, loaded: false, problem: null,
    running: new Set(), stage: new Map(), tab: "scan", search: "", sort: settings.sort,
    sheet: null, imgCache: new Map(), busy: false, refreshing: null, test: null, marketDown: null,
    user: null, authReady: false, recovery: false, authMode: "login", authBusy: false, authMsg: null, authErr: null, authEmail: "",
    legacy: null, migrating: null, lastSync: 0,
    history: [], historyOk: true, setInfo: new Map(), setPrices: new Map(), setPricesBusy: null,
    me: null, // { name, admin, blocked } from the server
  };
  const isAdmin = () => !!(state.me && state.me.admin);
  const tech = () => isAdmin() && settings.tech; // technical details only for admins who switched them on

  async function save(store, obj) {
    if (store === "cards") scheduleSnapshot();
    try { await Store.put(store, clone(obj)); }
    catch (e) { logErr("Speichern", e); toast("Speichern fehlgeschlagen. Prüfe deine Internetverbindung."); throw e; }
    const list = store === "cards" ? state.cards : store === "sessions" ? state.sessions : store === "items" ? state.items : null;
    if (list) { const i = list.findIndex(x => x.id === obj.id); if (i >= 0) list[i] = obj; else list.push(obj); }
    if (store === "sessions") state.open = state.sessions.find(s => s.status === "open") || null;
  }
  const listOf = store => store === "cards" ? state.cards : store === "sessions" ? state.sessions : store === "items" ? state.items : null;
  async function saveMany(store, objs) {
    if (!objs.length) return;
    if (store === "cards") scheduleSnapshot();
    try { await Store.putMany(store, objs.map(clone)); }
    catch (e) { toast("Speichern fehlgeschlagen. Prüfe deine Internetverbindung."); throw e; }
    const list = listOf(store);
    if (list) { const pos = new Map(list.map((x, i) => [x.id, i])); for (const o of objs) { const i = pos.get(o.id); if (i === undefined) { pos.set(o.id, list.length); list.push(o); } else list[i] = o; } }
    if (store === "sessions") state.open = state.sessions.find(s => s.status === "open") || null;
  }
  async function removeMany(store, ids) {
    if (!ids.length) return;
    if (store === "cards") scheduleSnapshot();
    try { await Store.delMany(store, ids); }
    catch (e) { toast("Löschen fehlgeschlagen. Prüfe deine Internetverbindung."); throw e; }
    const list = listOf(store), gone = new Set(ids);
    if (list) for (let i = list.length - 1; i >= 0; i--) if (gone.has(list[i].id)) list.splice(i, 1);
    if (store === "sessions") state.open = state.sessions.find(s => s.status === "open") || null;
  }
  async function remove(store, id) {
    if (store === "cards") scheduleSnapshot();
    try { await Store.del(store, id); }
    catch (e) { toast("Löschen fehlgeschlagen. Prüfe deine Internetverbindung."); throw e; }
    const list = store === "cards" ? state.cards : store === "sessions" ? state.sessions : store === "items" ? state.items : null;
    if (list) { const i = list.findIndex(x => x.id === id); if (i >= 0) list.splice(i, 1); }
    if (store === "sessions") state.open = state.sessions.find(s => s.status === "open") || null;
  }
  const openItems = () => state.open ? state.items.filter(i => i.sessionId === state.open.id).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)) : [];

  // ---------- images ----------
  async function loadImage(file) {
    const url = URL.createObjectURL(file);
    const img = new Image(); img.src = url;
    try { await img.decode(); } catch (e) { URL.revokeObjectURL(url); throw new Error("decode"); }
    return { img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
  }
  function drawTo(src, sw, sh, maxSide, crop) {
    const c0 = crop || { x: 0, y: 0, w: sw, h: sh };
    const s = Math.min(1, maxSide / Math.max(c0.w, c0.h));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(c0.w * s)); c.height = Math.max(1, Math.round(c0.h * s));
    c.getContext("2d").drawImage(src, c0.x, c0.y, c0.w, c0.h, 0, 0, c.width, c.height);
    return c;
  }
  const toBlob = (canvas, q) => new Promise(r => canvas.toBlob(b => r(b), "image/jpeg", q));
  function makeVersions(src, sw, sh, crop) {
    return toBlob(drawTo(src, sw, sh, 1500, crop), 0.85).then(ai => ({
      ai,
      main: drawTo(src, sw, sh, 1100, crop).toDataURL("image/jpeg", 0.8),
      thumb: drawTo(src, sw, sh, 240, crop).toDataURL("image/jpeg", 0.66),
    }));
  }
  const blobToBase64 = blob => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); });
  function dataURLtoBlob(d) {
    const [head, body] = d.split(",");
    const mime = (head.match(/data:([^;]+)/) || [])[1] || "image/jpeg";
    const bin = atob(body); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
  const officialImg = (card, size) => card && card.officialImage ? `${card.officialImage}/${size}.webp` : null;

  // ---------- recognition (Anthropic API) ----------
  const IDENT_PROMPT = `Du bekommst ein Handyfoto einer Pokémon-Sammelkarte (Pokémon TCG). Bestimme die Karte so genau wie möglich anhand von Name, Artwork, Set-Symbol, Kartennummer unten (z. B. "025/165") und Sprache des Aufdrucks.

Antworte NUR mit einem JSON-Objekt in genau dieser Form (unbekannte Werte = null):
{"isCard": true, "name": "Name wie auf der Karte gedruckt", "nameEn": "offizieller englischer Kartenname, z. B. Charizard ex", "set": "englischer Name der Erweiterung", "setCode": "Kürzel wie SV3, PAL, OBF, BS", "number": "Kartennummer wie gedruckt, z. B. 125/197", "rarity": "z. B. Common, Uncommon, Rare, Holo Rare, Double Rare, Ultra Rare, Illustration Rare, Special Illustration Rare, Hyper Rare, Promo", "language": "DE|EN|JP|FR|IT|ES|PT|KO|ZH", "variant": "Normal, Holo, Reverse Holo, 1st Edition, Shadowless o. ä.", "cardType": "Pokémon, Trainer oder Energie", "pokemonType": "z. B. Feuer", "hp": 0, "year": 0, "condition": "MT|NM|EX|GD|LP|PL|PO (Cardmarket-Skala, nach sichtbarem Zustand geschätzt; wenn unklar NM)", "priceEur": 0.0, "confidence": 0.0}

Achte genau auf die Kartennummer und darauf, ob die ganze Karte glitzert (Holo) oder nur die Fläche außerhalb des Bildes (Reverse Holo).
priceEur = deine grobe Schätzung des Cardmarket-Trendpreises in Euro (nur Notlösung). confidence = wie sicher die Identifikation ist (0 bis 1).
Wenn auf dem Foto keine Pokémon-Karte zu sehen ist: {"isCard": false}`;

  function extractJSON(text) {
    const t = String(text || "").trim();
    try { return JSON.parse(t); } catch (_) {}
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (fence) { try { return JSON.parse(fence[1]); } catch (_) {} }
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (_) {} }
    throw { code: "bad_json" };
  }

  async function identify(blob, opts = {}) {
    const t0 = performance.now();
    const key = settings.apiKey;
    if (!key) throw { code: "no_key" };
    const data = await blobToBase64(blob);
    let res;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: settings.model, max_tokens: 1024, messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data } }, { type: "text", text: IDENT_PROMPT }] }] }),
      });
    } catch (e) { throw { code: "network" }; }
    if (!res.ok) {
      let message = ""; try { const j = await res.json(); message = (j.error && j.error.message) || ""; } catch (_) {}
      throw { code: "http", status: res.status, message };
    }
    const j = await res.json();
    const u = j.usage || {};
    if (sb && state.user) try { quiet(sb.rpc("track_usage", { p_scans: 1, p_in: u.input_tokens || 0, p_out: u.output_tokens || 0 })); } catch (_) {}
    const text = (j.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
    if (opts.raw) opts.raw({ text, usage: u, model: j.model, ms: Math.round(performance.now() - t0) });
    return extractJSON(text);
  }
  function aiMsg(e) {
    if (e && e.code !== "no_key") logErr("Erkennung", e && e.code === "http" ? `HTTP ${e.status}: ${e.message || ""}` : e);
    if (!e) return "Die Erkennung ist fehlgeschlagen.";
    if (e.code === "no_key") return "Für die automatische Erkennung fehlt noch dein Schlüssel. Richte ihn in den Einstellungen ein oder such die Karte von Hand.";
    if (e.code === "network") return "Keine Verbindung zur Erkennung. Prüfe dein Internet.";
    if (e.code === "bad_json") return "Die Antwort der Erkennung war unvollständig. Tippe auf „Erneut erkennen“.";
    if (e.code === "http") {
      if (e.status === 401) return "Dein Schlüssel funktioniert nicht mehr. Trag ihn in den Einstellungen neu ein.";
      if (e.status === 403) return "Dein Schlüssel darf die Erkennung nicht nutzen. Stell in den Einstellungen auf „Schnell & günstig“ um oder prüf den Schlüssel.";
      if (e.status === 400 && /credit|balance/i.test(e.message)) return "Dein Guthaben bei Anthropic ist aufgebraucht. Lade es auf console.anthropic.com auf.";
      if (e.status === 429) return "Zu viele Anfragen. Warte kurz und versuch es erneut.";
      if (e.status === 529 || e.status >= 500) return "Die Erkennung ist gerade überlastet. Versuch es gleich erneut.";
      return "Die Erkennung hat nicht geklappt. Versuch es erneut.";
    }
    if (e.message === "decode") return "Das Foto ließ sich nicht öffnen.";
    return "Die Erkennung ist fehlgeschlagen.";
  }
  function cleanStr(v, max = 80) { return (typeof v === "string" && v.trim()) ? v.trim().slice(0, max) : null; }
  function cleanNum(v) { const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", ".")); return isFinite(n) ? n : null; }
  function normalizeCard(r) {
    const ki = r2(cleanNum(r.priceEur));
    return {
      name: cleanStr(r.name) || cleanStr(r.nameEn) || "Unbekannte Karte",
      nameEn: cleanStr(r.nameEn), set: cleanStr(r.set), setCode: cleanStr(r.setCode, 16), number: cleanStr(r.number, 20),
      rarity: cleanStr(r.rarity, 40), language: cleanStr(r.language, 4), variant: cleanStr(r.variant, 40),
      cardType: cleanStr(r.cardType, 20), pokemonType: cleanStr(r.pokemonType, 20),
      hp: cleanNum(r.hp) || null, year: cleanNum(r.year) || null,
      condition: CONDITIONS.some(x => x[0] === r.condition) ? r.condition : "NM",
      confidence: cleanNum(r.confidence),
      kiPriceEur: ki, priceEur: ki, priceSource: ki === null ? null : "ki", priceDate: Date.now(),
      market: null, marketError: null, officialImage: null,
    };
  }

  // ---------- market prices (TCGdex → Cardmarket) ----------
  const TCG = "https://api.tcgdex.net/v2/";
  const TCG_LANG = { DE: "de", EN: "en", FR: "fr", IT: "it", ES: "es", PT: "pt-br", JP: "ja", ZH: "zh-tw" };
  const LANG_FROM_TCG = { de: "DE", en: "EN", fr: "FR", it: "IT", es: "ES", "pt-br": "PT", ja: "JP", "zh-tw": "ZH" };
  const searchUrl = (lang, name, local) => TCG + lang + "/cards?name=" + encodeURIComponent(name) + (local ? "&localId=" + encodeURIComponent(local) : "");
  const detailUrl = (lang, id) => TCG + lang + "/cards/" + encodeURIComponent(id);
  const normLocal = s => String(s ?? "").toUpperCase().replace(/\s/g, "").replace(/^([A-Z]*)0+(?=\d)/, "$1");
  const sameLocal = (a, b) => normLocal(a) === normLocal(b);
  const normCode = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/([a-z])0+(\d)/g, "$1$2");
  function splitNumber(n) {
    const s = String(n || "").trim(); if (!s) return {};
    const [a, b] = s.split("/");
    const raw = String(a || "").trim().toUpperCase().replace(/\s/g, "");
    const query = /^\d+$/.test(raw) ? String(Number(raw)) : raw;
    const denom = b && /^\d+$/.test(b.trim()) ? b.trim() : null;
    return { local: normLocal(raw) || null, query: query || null, denom };
  }
  const tcgCache = new Map(), tcgInflight = new Map();
  async function tcgFetch(url, fresh) {
    const hit = tcgCache.get(url);
    if (!fresh && hit && Date.now() - hit.t < 30 * 60e3) return hit.v;
    if (tcgInflight.has(url)) return tcgInflight.get(url);
    const p = tcgFetchNet(url).finally(() => tcgInflight.delete(url));
    tcgInflight.set(url, p);
    return p;
  }
  async function tcgFetchNet(url) {
    let res;
    try { res = await fetch(url, { headers: { accept: "application/json" } }); }
    catch (e) { throw { code: "tcg_network" }; }
    if (res.status === 404) { tcgCache.set(url, { t: Date.now(), v: null }); return null; }
    if (!res.ok) throw { code: "tcg_http", status: res.status };
    const v = await res.json();
    tcgCache.set(url, { t: Date.now(), v });
    state.marketDown = null;
    return v;
  }
  function tcgMsg(e) {
    logErr("Preise", e);
    if (e && e.code === "tcg_network") { state.marketDown = "Die Preise sind gerade nicht erreichbar. Prüfe dein Internet."; return state.marketDown; }
    if (e && e.code === "tcg_http") return "Die Preise sind gerade nicht abrufbar. Versuch es später erneut.";
    return "Der Preisabruf ist fehlgeschlagen.";
  }
  function rankBriefs(briefs, card) {
    const code = normCode(card.setCode);
    const setPart = b => normCode(String(b.id).replace(/-[^-]+$/, ""));
    return briefs.slice().sort((a, b) => (code && setPart(b) === code ? 1 : 0) - (code && setPart(a) === code ? 1 : 0));
  }
  function scoreDetail(d, card, local, denom) {
    let s = 0;
    if (local && sameLocal(d.localId, local)) s += 5;
    const off = d.set && d.set.cardCount && d.set.cardCount.official;
    if (denom && off && Number(denom) === Number(off)) s += 4;
    const sn = String((d.set && d.set.name) || "").toLowerCase(), cs = String(card.set || "").toLowerCase();
    if (cs && sn && sn === cs) s += 4; else if (cs && sn && (sn.includes(cs) || cs.includes(sn))) s += 2;
    if (card.setCode && d.set && normCode(d.set.id) === normCode(card.setCode)) s += 3;
    const dn = String(d.name || "").toLowerCase();
    if ([card.name, card.nameEn].some(n => n && n.toLowerCase() === dn)) s += 2;
    if (d.pricing) s += 1;
    return s;
  }
  function buildMarket(detail, card, lang, ambiguous) {
    const cm = detail.pricing && detail.pricing.cardmarket;
    const tp = detail.pricing && detail.pricing.tcgplayer;
    const wantFoil = /reverse/i.test(card.variant || "");
    const pick = foil => { if (!cm) return {}; const g = k => num(cm[foil ? k + "-holo" : k]); return { trend: g("trend"), low: g("low"), avg: g("avg"), avg1: g("avg1"), avg7: g("avg7"), avg30: g("avg30") }; };
    let p = pick(wantFoil), foil = wantFoil;
    if (cm && Object.values(p).every(v => v === null)) { p = pick(!wantFoil); foil = !wantFoil; }
    let usdPrice = null;
    if (tp && typeof tp === "object") {
      const keys = Object.keys(tp).filter(k => tp[k] && typeof tp[k] === "object");
      const pref = keys.filter(k => foil === /reverse/i.test(k));
      for (const k of [...pref, ...keys]) { const m = num(tp[k].marketPrice) ?? num(tp[k].midPrice); if (m !== null) { usdPrice = m; break; } }
    }
    const match = {
      tcgdexId: detail.id, lang, matchName: detail.name || null, matchSet: (detail.set && detail.set.name) || null,
      matchLocal: detail.localId != null ? String(detail.localId) : null,
      matchOfficial: (detail.set && detail.set.cardCount && num(detail.set.cardCount.official)) || null, ambiguous: !!ambiguous,
      setId: (detail.set && detail.set.id) || null,
      image: typeof detail.image === "string" ? detail.image : null,
    };
    const price = p.trend ?? p.avg7 ?? p.avg30 ?? p.avg ?? p.low ?? null;
    if (price === null) return { error: "Zu dieser Karte gibt es bei Cardmarket gerade keinen Preis.", match };
    const updated = cm && cm.updated ? (Date.parse(cm.updated) || null) : null;
    return { market: { source: "Cardmarket", ...match, trend: p.trend ?? null, low: p.low ?? null, avg: p.avg ?? null, avg1: p.avg1 ?? null, avg7: p.avg7 ?? null, avg30: p.avg30 ?? null, foil, usd: usdPrice, updated, fetchedAt: Date.now() }, priceEur: r2(price) };
  }
  async function lookupMarket(card, opts = {}) {
    const { local, query, denom } = splitNumber(card.number);
    try {
      if (card.market && card.market.tcgdexId && opts.useId !== false) {
        const lang = card.market.lang || "en";
        const d = await tcgFetch(detailUrl(lang, card.market.tcgdexId), opts.fresh);
        if (d && d.id) return buildMarket(d, card, lang, false);
      }
      const tries = [];
      if (card.nameEn) tries.push(["en", card.nameEn]);
      const l = TCG_LANG[card.language];
      if (l && card.name && !(l === "en" && card.name === card.nameEn)) tries.push([l, card.name]);
      if (!tries.length && card.name) tries.push(["en", card.name]);
      let briefs = [], lang = "en";
      for (const [lg, nm] of tries) {
        let list = (await tcgFetch(searchUrl(lg, nm, query || ""), opts.fresh)) || [];
        let b = Array.isArray(list) ? (local ? list.filter(c => sameLocal(c.localId, local)) : list) : [];
        if (!b.length && local) { list = (await tcgFetch(searchUrl(lg, nm, ""), opts.fresh)) || []; b = Array.isArray(list) ? list.filter(c => sameLocal(c.localId, local)) : []; }
        if (b.length) { briefs = b; lang = lg; break; }
      }
      if (!briefs.length) return { error: "Zu dieser Karte wurde kein Preis gefunden. Prüfe Name und Nummer oder such sie von Hand." };
      const pre = rankBriefs(briefs, card).slice(0, 6);
      const details = (await Promise.all(pre.map(b => tcgFetch(detailUrl(lang, b.id), opts.fresh).catch(() => null)))).filter(d => d && d.id);
      if (!details.length) return { error: "Die Kartendetails ließen sich nicht laden." };
      const scored = details.map(d => ({ d, s: scoreDetail(d, card, local, denom) })).sort((a, b) => b.s - a.s);
      return buildMarket(scored[0].d, card, lang, scored.length > 1 && scored[1].s === scored[0].s);
    } catch (e) { return { error: tcgMsg(e) }; }
  }
  function applyMarket(card, res) {
    const c = { ...card };
    if (res.market) {
      c.market = res.market; c.marketError = null;
      if (res.market.image) c.officialImage = res.market.image;
      if (c.priceSource !== "hand") { c.priceEur = res.priceEur; c.priceSource = "markt"; c.priceDate = res.market.updated || Date.now(); }
    } else {
      c.marketError = res.error || "Kein Marktpreis gefunden.";
      if (res.match && res.match.image) c.officialImage = res.match.image;
    }
    return c;
  }
  function cardFromDetail(d, lang, keep = {}) {
    const off = d.set && d.set.cardCount && d.set.cardCount.official;
    const base = {
      name: d.name || "Unbekannte Karte", nameEn: lang === "en" ? d.name : (keep.nameEn || null),
      set: (d.set && d.set.name) || null, setCode: (d.set && d.set.id) || null,
      number: d.localId != null ? (off ? `${d.localId}/${off}` : String(d.localId)) : null,
      rarity: d.rarity || null, language: keep.language || LANG_FROM_TCG[lang] || null, variant: keep.variant || "Normal",
      cardType: d.category || null, pokemonType: Array.isArray(d.types) ? d.types[0] : null, hp: num(d.hp) || null, year: null,
      condition: keep.condition || "NM", confidence: 1,
      kiPriceEur: keep.kiPriceEur ?? null, priceEur: keep.priceSource === "hand" ? keep.priceEur : null, priceSource: keep.priceSource === "hand" ? "hand" : null,
      priceDate: Date.now(), market: null, marketError: null, officialImage: typeof d.image === "string" ? d.image : null,
    };
    return applyMarket(base, buildMarket(d, base, lang, false));
  }

  // ---------- session actions ----------
  function setStage(id, text) { if (text) state.stage.set(id, text); else state.stage.delete(id); render(); }

  async function ensureSession() {
    if (state.open) return state.open.id;
    const s = { id: uid(), status: "open", startedAt: Date.now() };
    await save("sessions", s); render();
    return s.id;
  }

  async function addFromVersions(v, opts = {}) {
    const sid = await ensureSession();
    const id = opts.id || uid();
    Img.put(id, v.main).catch(() => toast("Das Foto ließ sich nicht hochladen. Die Karte wird trotzdem erkannt."));
    await save("items", { id, sessionId: sid, status: "pending", thumb: v.thumb, imageId: id, qty: 1, createdAt: Date.now(), auto: !!opts.auto });
    render();
    recognize(id, v.ai);
    return id;
  }
  async function handleFiles(fileList) {
    for (const f of Array.from(fileList || []).filter(f => f && f.size)) {
      try { const im = await loadImage(f); try { await addFromVersions(await makeVersions(im.img, im.w, im.h)); } finally { im.done(); } }
      catch (e) { toast(e && e.name === "QuotaExceededError" ? "Der Speicher auf deinem Handy ist voll." : "Ein Foto ließ sich nicht öffnen."); }
    }
  }

  const getItem = id => state.items.find(i => i.id === id);
  async function patchItem(id, patch) { const it = getItem(id); if (!it) return; await save("items", { ...it, ...patch }); }

  async function recognize(id, blob) {
    if (!settings.apiKey) { const p = { status: "error", error: aiMsg({ code: "no_key" }) }; await patchItem(id, p); camResult(id, p); render(); return; }
    state.running.add(id); setStage(id, "Karte wird erkannt …");
    let patch;
    try {
      const r = await identify(blob);
      if (!r || typeof r !== "object" || r.isCard === false) {
        const it = getItem(id);
        if (it && it.auto) { // automatic shot without a card: drop it quietly
          state.running.delete(id); state.stage.delete(id);
          await removeItem(id); camResult(id, { status: "nocard" }); return;
        }
        patch = { status: "error", error: "Auf dem Foto wurde keine Pokémon-Karte erkannt. Nimm sie neu auf oder such sie von Hand." };
      }
      else {
        let card = normalizeCard(r);
        setStage(id, `${card.name}: Marktpreis wird gesucht …`);
        card = applyMarket(card, await lookupMarket(card));
        patch = { status: "ok", card, error: null };
      }
    } catch (e) { patch = { status: "error", error: aiMsg(e) }; }
    try { await patchItem(id, patch); } catch (_) {}
    finally { state.running.delete(id); setStage(id, null); }
    camResult(id, patch);
  }
  async function relookupItem(id, useId) {
    const it = getItem(id); if (!it || !it.card) return;
    state.running.add(id);
    try {
      await patchItem(id, { status: "pending" }); setStage(id, `${it.card.name}: Marktpreis wird gesucht …`);
      const card = applyMarket(it.card, await lookupMarket(it.card, { useId }));
      await patchItem(id, { status: "ok", error: null, card });
    } catch (_) {}
    finally { state.running.delete(id); setStage(id, null); }
  }
  async function retryItem(id) {
    const it = getItem(id); if (!it || !it.imageId) return;
    let blob = null;
    try { blob = await Img.blob(it.imageId); } catch (_) {}
    if (!blob) { toast("Das Foto ist nicht mehr vorhanden."); return; }
    await patchItem(id, { status: "pending", error: null });
    recognize(id, blob);
  }
  async function removeItem(id) {
    const it = getItem(id); if (!it) return;
    await remove("items", id); if (it.imageId) await Img.del(it.imageId);
    render();
  }
  async function addManual() {
    const sid = await ensureSession();
    const id = uid();
    await save("items", { id, sessionId: sid, status: "error", error: "Noch keine Karte ausgewählt.", qty: 1, createdAt: Date.now(), imageId: null, thumb: null });
    render();
    openSheet({ type: "search", target: { kind: "item", id }, q: "", n: "", lang: "de" });
  }

  const cardKey = c => [c.name, c.setCode || c.set, c.number, c.variant, c.language, c.condition].map(s => String(s || "").toLowerCase().trim()).join("|");
  const sessionTotal = items => items.filter(i => i.status === "ok").reduce((s, i) => s + (num(i.card && i.card.priceEur) || 0) * (i.qty || 1), 0);

  async function commitSession() {
    if (!state.open || state.busy) return;
    const sess = state.open, all = openItems(), ok = all.filter(i => i.status === "ok");
    state.busy = true; renderSheet();
    try {
      // Work out all inventory changes first, then write them in a few bundled requests.
      let merged = 0, added = 0;
      const byKey = new Map(state.cards.map(c => [cardKey(c), c]));
      const changed = new Map(), imgGone = [];
      for (const it of ok) {
        const k = cardKey(it.card), ex = byKey.get(k), qty = it.qty || 1;
        if (ex) {
          const upd = { ...ex, qty: (ex.qty || 1) + qty };
          if (ex.priceSource !== "hand" && num(it.card.priceEur) !== null) Object.assign(upd, { priceEur: it.card.priceEur, priceSource: it.card.priceSource, priceDate: it.card.priceDate, market: it.card.market || null, marketError: it.card.marketError || null });
          byKey.set(k, upd); changed.set(upd.id, upd);
          if (it.imageId && it.imageId !== ex.imageId) imgGone.push(it.imageId);
          merged++;
        } else {
          const nc = { id: it.id, ...it.card, qty, thumb: it.thumb || null, imageId: it.imageId || null, addedAt: Date.now(), sessionId: sess.id };
          byKey.set(k, nc); changed.set(nc.id, nc);
          added++;
        }
      }
      await saveMany("cards", [...changed.values()]);
      const summary = ok.map(i => ({ name: i.card.name, set: i.card.set || null, number: i.card.number || null, qty: i.qty || 1, priceEur: num(i.card.priceEur), priceSource: i.card.priceSource || null }));
      const total = r2(sessionTotal(ok)) || 0;
      const count = ok.reduce((s, i) => s + (i.qty || 1), 0);
      await save("sessions", { ...sess, status: "done", finishedAt: Date.now(), total, count, summary });
      await removeMany("items", all.map(i => i.id));
      Img.delMany([...imgGone, ...all.filter(i => i.status !== "ok").map(i => i.imageId)]);
      state.busy = false;
      openSheet({ type: "done", total, count, added, merged });
    } catch (e) {
      state.busy = false;
      toast("Abschließen hat nicht vollständig geklappt. Versuch es erneut.");
      renderSheet();
    }
    render();
  }
  async function discardSession() {
    if (!state.open) return;
    const all = openItems();
    await removeMany("items", all.map(i => i.id));
    Img.delMany(all.map(i => i.imageId));
    await remove("sessions", state.open.id);
    closeSheet(); render();
  }

  // ---------- edit / search / refresh ----------
  async function saveEdit(form) {
    const s = state.sheet; if (!s) return;
    const f = new FormData(form);
    const g = k => cleanStr(f.get(k), 80);
    const isItem = s.kind === "item";
    const src = isItem ? getItem(s.id) : state.cards.find(c => c.id === s.id);
    if (!src) return closeSheet();
    const base = isItem ? (src.card || {}) : src;
    const priceTyped = parsePrice(f.get("priceEur"));
    const priceChanged = priceTyped !== num(base.priceEur);
    const card = { ...(isItem ? base : stripId(base)), name: g("name") || "Unbekannte Karte", nameEn: g("nameEn"), set: g("set"), setCode: g("setCode"), number: g("number"), rarity: g("rarity"), language: g("language"), variant: g("variant"), condition: g("condition") || "NM" };
    const idChanged = ["name", "nameEn", "set", "setCode", "number", "language"].some(k => (card[k] || null) !== (base[k] || null));
    const variantChanged = (card.variant || null) !== (base.variant || null);
    if (priceChanged) Object.assign(card, { priceEur: priceTyped, priceSource: priceTyped === null ? null : "hand", priceDate: Date.now() });
    if (idChanged) { card.market = null; card.marketError = null; }
    if ((idChanged || variantChanged) && !priceChanged && card.priceSource === "markt") card.priceSource = num(card.kiPriceEur) !== null ? "ki" : null;
    const wantLookup = (idChanged || variantChanged) && !priceChanged;
    const qty = Math.max(1, Math.min(999, parseInt(f.get("qty"), 10) || 1));
    if (isItem) {
      await save("items", { ...src, status: "ok", error: null, card, qty });
      closeSheet(); render();
      if (wantLookup) relookupItem(src.id, !idChanged);
    } else {
      await save("cards", { id: src.id, ...card, qty });
      openSheet({ type: "detail", id: src.id }); render();
      if (wantLookup) refreshCard(src.id, { useId: !idChanged });
    }
  }

  async function runSearch(form) {
    const s = state.sheet; if (!s || s.type !== "search") return;
    const f = new FormData(form);
    s.q = String(f.get("q") || "").trim(); s.n = String(f.get("n") || "").trim(); s.lang = String(f.get("lang") || "de");
    if (!s.q) { toast("Gib einen Kartennamen ein."); return; }
    s.loading = true; s.results = null; s.error = null; renderSheet();
    try {
      const { local, query } = splitNumber(s.n);
      let list = (await tcgFetch(searchUrl(s.lang, s.q, query || ""))) || [];
      if (!Array.isArray(list)) list = [];
      if (local) list = list.filter(c => sameLocal(c.localId, local));
      const top = list.slice(0, 15);
      const details = await Promise.all(top.map(b => tcgFetch(detailUrl(s.lang, b.id)).catch(() => null)));
      s.results = top.map((b, i) => details[i] || b);
      s.more = list.length - top.length;
    } catch (e) { s.error = tcgMsg(e); }
    s.loading = false; renderSheet();
  }
  async function pickResult(idx) {
    const s = state.sheet; if (!s || !s.results) return;
    let d = s.results[idx]; if (!d) return;
    if (!d.set) { try { d = await tcgFetch(detailUrl(s.lang, d.id)) || d; } catch (_) {} }
    const t = s.target;
    if (t.kind === "item") {
      const it = getItem(t.id); if (!it) return closeSheet();
      const card = cardFromDetail(d, s.lang, it.card || {});
      await save("items", { ...it, status: "ok", error: null, card });
    } else {
      const c = state.cards.find(x => x.id === t.id); if (!c) return closeSheet();
      const card = cardFromDetail(d, s.lang, c);
      await save("cards", { ...c, ...card, id: c.id });
    }
    closeSheet(); render();
    if (t.kind === "card") openSheet({ type: "detail", id: t.id });
  }

  async function refreshCard(id, opts = {}) {
    const c = state.cards.find(x => x.id === id); if (!c) return;
    if (state.sheet && state.sheet.id === id) { state.sheet.refreshing = true; renderSheet(); }
    try {
      const res = await lookupMarket(c, { fresh: true, useId: opts.useId });
      const cur = state.cards.find(x => x.id === id) || c;
      await save("cards", { ...applyMarket(cur, res), id });
      toast(res.market ? `Marktpreis: ${money(res.priceEur)} (Cardmarket-Trend)` : res.error);
    } catch (_) {}
    finally { if (state.sheet && state.sheet.id === id) { state.sheet.refreshing = false; renderSheet(); } }
    render();
  }
  let renderTimer = 0;
  const renderAdminToo = () => { if (state.sheet && state.sheet.type === "admin") renderSheet(); };
  const renderSoon = () => { if (renderTimer) return; renderTimer = setTimeout(() => { renderTimer = 0; render(); renderAdminToo(); }, 250); };
  async function refreshAll(opts = {}) {
    if (state.refreshing || !state.cards.length) return;
    const cards = state.cards.slice();
    state.refreshing = { done: 0, total: cards.length, failed: 0 }; renderInv();
    let failed = 0, saveErrors = 0, stop = false; const total = cards.length;
    // Fresh prices for this run: drop cached answers once, then identical cards share one request.
    tcgCache.clear();
    const pending = [];
    const flush = async (all) => {
      if (!pending.length || (!all && pending.length < 25)) return;
      const batch = pending.splice(0, pending.length);
      try { await saveMany("cards", batch); } catch (_) { saveErrors++; if (saveErrors >= 2) stop = true; }
    };
    let next = 0;
    const worker = async () => {
      while (!stop && next < cards.length && state.user) {
        const c = cards[next++];
        const res = await lookupMarket(c, {});
        const cur = state.cards.find(x => x.id === c.id);
        if (cur) pending.push({ ...applyMarket(cur, res), id: c.id });
        if (!res.market) failed++;
        if (state.refreshing) state.refreshing.done++;
        if (state.marketDown) stop = true;
        await flush(false);
        renderSoon();
      }
    };
    try { await Promise.all(Array.from({ length: 5 }, worker)); await flush(true); }
    finally { state.refreshing = null; render(); renderAdminToo(); }
    if (saveErrors) toast("Preise konnten nicht gespeichert werden. Prüfe deine Internetverbindung.");
    else if (!opts.silent || state.marketDown) toast(state.marketDown || (failed ? `Preise aktualisiert. ${failed} von ${total} ohne Marktpreis.` : "Alle Preise aktualisiert."));
    scheduleSnapshot();
  }
  // Checks a recognition key without spending credit (lists the available models).
  async function checkKey(key) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" } });
      if (r.ok) return { ok: true };
      let message = ""; try { message = ((await r.json()).error || {}).message || ""; } catch (_) {}
      if (r.status === 401) return { ok: false, msg: "Dieser Schlüssel stimmt nicht. Kopier ihn bitte noch einmal vollständig." };
      logErr("Schlüssel", `HTTP ${r.status}: ${message}`);
      return { ok: false, soft: true, msg: "Der Schlüssel ließ sich gerade nicht prüfen." };
    } catch (e) { logErr("Schlüssel", e); return { ok: false, soft: true, msg: "Keine Verbindung. Prüfe dein Internet." }; }
  }
  async function saveKey(raw) {
    const s = state.sheet; if (!s) return;
    const key = raw.trim().replace(/\s+/g, "");
    if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) { s.err = "Das sieht nicht nach einem Schlüssel aus. Er beginnt mit „sk-ant-“ und ist ziemlich lang."; renderSheet(); return; }
    s.busy = true; s.err = null; renderSheet();
    const r = await checkKey(key);
    s.busy = false;
    if (!r.ok && !r.soft) { s.err = r.msg; renderSheet(); return; }
    settings.apiKey = key; haptic("success");
    toast(r.ok ? "Fertig! Die Erkennung ist bereit." : "Gespeichert. Prüfen ging gerade nicht; der erste Scan zeigt, ob alles klappt.");
    closeSheet(); render();
  }
  async function saveName(raw) {
    const s = state.sheet; if (!s) return;
    const name = raw.trim().slice(0, 40);
    if (!name) { s.err = "Gib einen Namen ein."; renderSheet(); return; }
    s.busy = true; s.err = null; renderSheet();
    try {
      const { data, error } = await sb.rpc("me", { p_name: name }); if (error) throw error;
      state.me = { ...(state.me || {}), ...(data || {}), name };
      toast("Name gespeichert."); openSheet({ type: "settings" }); render();
    } catch (e) { logErr("Profil", e); s.busy = false; s.err = "Der Name ließ sich nicht speichern."; renderSheet(); }
  }
  async function connResults() {
    const out = [];
    try { const { error } = await sb.rpc("me"); out.push(error ? { ok: false, msg: "Datenbank: " + (error.message || "Fehler") } : { ok: true, msg: "Datenbank und Konto erreichbar." }); }
    catch (e) { out.push({ ok: false, msg: "Datenbank nicht erreichbar." }); }
    try {
      const d = await tcgFetch(detailUrl("en", "swsh3-136"), true);
      const m = d && buildMarket(d, { variant: "Normal" }, "en", false);
      out.push(d ? { ok: true, msg: `Preise erreichbar: ${d.name} (${(d.set && d.set.name) || "?"}) ${m && m.market ? money(m.market.trend ?? m.priceEur) : "–"}` } : { ok: false, msg: "Preise: Antwort ohne Kartendaten." });
    } catch (e) { out.push({ ok: false, msg: tcgMsg(e) }); }
    if (!settings.apiKey) out.push({ ok: false, msg: "Auf diesem Gerät ist kein Schlüssel eingerichtet." });
    else { const r = await checkKey(settings.apiKey); out.push(r.ok ? { ok: true, msg: "Schlüssel funktioniert." } : { ok: false, msg: r.msg }); }
    return out;
  }

  async function deleteCard(id) {
    const c = state.cards.find(x => x.id === id); if (!c) return;
    await remove("cards", id); if (c.imageId) await Img.del(c.imageId);
    closeSheet(); render(); toast("Karte gelöscht.");
  }

  // ---------- import / migration ----------
  async function importRecords(data, progress) {
    const imgs = data.images || [];
    let n = 0; const total = imgs.length + ["cards", "sessions", "items"].reduce((t, k) => t + (data[k] || []).length, 0);
    const tick = () => { n++; if (progress) progress(n, total); };
    for (const v of imgs) { if (v && v.id && v.data) { try { await Img.put(v.id, v.data); } catch (_) {} } tick(); }
    // 100 rows per request instead of one request per row.
    for (const k of ["cards", "sessions", "items"]) {
      const rows = data[k] || [];
      await Store.putMany(k, rows.filter(v => v && v.id));
      n += rows.length; if (progress) progress(n, total);
    }
  }
  async function migrateLegacy() {
    const data = state.legacy; if (!data || state.migrating) return;
    state.migrating = { n: 0, total: 1 }; render();
    try {
      await importRecords(data, (n, total) => { state.migrating = { n, total }; render(); });
      Legacy.clear(); state.legacy = null; state.migrating = null;
      await loadAll(); render(); toast("Deine Karten sind jetzt in deinem Konto gespeichert.");
    } catch (e) { state.migrating = null; render(); toast("Übernahme abgebrochen. Prüfe deine Verbindung und versuch es erneut."); }
  }

  // ---------- backup ----------
  async function exportData() {
    const data = { app: "pokemon-kartenscanner", version: 2, exportedAt: new Date().toISOString(), cards: state.cards, sessions: state.sessions, items: state.items };
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const name = `kartenscanner-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const fs = plug("Filesystem"), share = plug("Share");
    if (fs && share) {
      try {
        const { uri } = await fs.writeFile({ path: name, data: JSON.stringify(data), directory: "CACHE", encoding: "utf8" });
        await share.share({ title: "Kartenscanner-Backup", url: uri, dialogTitle: "Backup sichern" });
      } catch (e) { if (!/cancel/i.test(String(e && (e.message || e)))) toast("Das Backup ließ sich nicht teilen."); }
      return;
    }
    const file = new File([blob], name, { type: "application/json" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "Kartenscanner-Backup" }); return; } catch (e) { if (e && e.name === "AbortError") return; }
    }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  async function importData(file) {
    try {
      const data = JSON.parse(await file.text());
      if (!data || data.app !== "pokemon-kartenscanner") throw new Error("format");
      await importRecords(data);
      await loadAll(); closeSheet(); render();
      toast(`Backup eingespielt: ${(data.cards || []).length} Karten.`);
    } catch (e) {
      if (e instanceof SyntaxError || e.message === "format") toast("Die Datei ist kein gültiges Kartenscanner-Backup.");
      else { logErr("Import", e); toast("Import abgebrochen. Prüfe deine Internetverbindung und versuch es erneut."); }
    }
  }

  // ---------- duplicates ----------
  // Same card = same TCGdex id (or name + number) and same finish (normal vs. reverse holo).
  const finishOf = c => /reverse/i.test((c && c.variant) || "") ? "r" : "n";
  const identOf = c => !c ? "" : (c.market && c.market.tcgdexId ? `t:${c.market.tcgdexId}` : `k:${String(c.name || "").toLowerCase().trim()}|${String(c.number || "").toLowerCase().replace(/\s/g, "")}`) + "|" + finishOf(c);
  const invCount = c => { const k = identOf(c); return state.cards.filter(x => identOf(x) === k).reduce((t, x) => t + (x.qty || 1), 0); };
  // For each scan in the open session: how often the card was scanned before in this session, and how often it is in the inventory.
  function sessionDupes() {
    const seen = new Map(), out = new Map();
    for (const it of openItems()) {
      if (it.status !== "ok" || !it.card) continue;
      const k = identOf(it.card), before = seen.get(k) || 0;
      out.set(it.id, { ses: before, inv: invCount(it.card) });
      seen.set(k, before + 1);
    }
    return out;
  }
  const dupChips = d => !d ? "" : (d.ses ? '<span class="chip warn">Doppelt gescannt</span>' : "") + (d.inv ? `<span class="chip own">${d.inv}× im Inventar</span>` : "");

  // ---------- value history ----------
  const dayId = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  let snapTimer;
  function scheduleSnapshot() { clearTimeout(snapTimer); snapTimer = setTimeout(writeSnapshot, 2000); }
  async function writeSnapshot() {
    if (!state.user || !state.historyOk || !state.loaded) return;
    const prices = {}; let total = 0, count = 0;
    for (const c of state.cards) { const p = num(c.priceEur), q = c.qty || 1; count += q; if (p !== null) { total += p * q; prices[c.id] = [p, q]; } }
    const id = dayId(), snap = { id, date: id, ts: Date.now(), total: r2(total) || 0, count, prices };
    const ex = state.history.find(h => h.id === id);
    if (ex && ex.total === snap.total && ex.count === snap.count && JSON.stringify(ex.prices) === JSON.stringify(prices)) return;
    try {
      await Store.put("history", snap);
      const i = state.history.findIndex(h => h.id === id); if (i >= 0) state.history[i] = snap; else state.history.push(snap);
      if (state.tab === "value") renderValue();
    } catch (e) { if (isMissingTable(e)) { state.historyOk = false; if (state.tab === "value") renderValue(); } }
  }
  const isMissingTable = e => !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache/i.test(String(e.message || "")));
  const histSorted = () => state.history.slice().sort((a, b) => a.id < b.id ? -1 : 1);
  // The snapshot to compare against: the latest one at least `days` old, else the oldest one from before today.
  function baseline(days) {
    const h = histSorted(), today = dayId(), cut = dayId(new Date(Date.now() - days * 864e5));
    let b = null; for (const x of h) if (x.id <= cut) b = x;
    if (!b) b = h.find(x => x.id < today) || null;
    return b;
  }
  function cardHistory(id) { return histSorted().filter(h => h.prices && h.prices[id]).map(h => ({ x: Date.parse(h.id + "T12:00:00"), y: h.prices[id][0] })); }
  async function maybeAutoRefresh() {
    if (!state.cards.length || state.refreshing) return;
    let last = 0; try { last = Number(localStorage.getItem("ks-autoref") || 0); } catch (_) {}
    if (Date.now() - last < 20 * 3600e3) { scheduleSnapshot(); return; }
    try { localStorage.setItem("ks-autoref", String(Date.now())); } catch (_) {}
    refreshAll({ silent: true });
  }

  // ---------- charts (inline SVG, colors from theme tokens) ----------
  function lineChart(pts, o = {}) {
    const W = o.w || 340, H = o.h || 150, L = o.compact ? 2 : 52, R = o.compact ? 4 : 10, T = o.compact ? 4 : 10, B = o.compact ? 4 : 24;
    if (pts.length < 2) return "";
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    let y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (y1 - y0 < 0.01) { y0 -= 1; y1 += 1; }
    const padY = (y1 - y0) * 0.12; y0 = Math.max(0, y0 - padY); y1 += padY;
    const x0 = Math.min(...xs), x1 = Math.max(...xs) === x0 ? x0 + 1 : Math.max(...xs);
    const X = x => L + (x - x0) / (x1 - x0) * (W - L - R), Y = y => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
    const line = pts.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");
    const area = `${line}L${X(pts[pts.length - 1].x).toFixed(1)},${(H - B).toFixed(1)}L${X(pts[0].x).toFixed(1)},${(H - B).toFixed(1)}Z`;
    const last = pts[pts.length - 1];
    let grid = "";
    if (!o.compact) {
      for (const g of [y0, (y0 + y1) / 2, y1]) grid += `<line x1="${L}" x2="${W - R}" y1="${Y(g).toFixed(1)}" y2="${Y(g).toFixed(1)}" class="ch-grid"/><text x="${L - 6}" y="${(Y(g) + 4).toFixed(1)}" class="ch-lbl" text-anchor="end">${esc(money(g).replace(/,\d\d\s/, " "))}</text>`;
      const d = t => new Date(t).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
      grid += `<text x="${L}" y="${H - 6}" class="ch-lbl">${d(x0)}</text><text x="${W - R}" y="${H - 6}" class="ch-lbl" text-anchor="end">${d(x1)}</text>`;
    }
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label || "Verlauf")}">${grid}<path d="${area}" class="ch-area"/><path d="${line}" class="ch-line"/><circle cx="${X(last.x).toFixed(1)}" cy="${Y(last.y).toFixed(1)}" r="${o.compact ? 2.5 : 4}" class="ch-dot"/></svg>`;
  }
  const signed = v => (v > 0 ? "+" : v < 0 ? "−" : "±") + money(Math.abs(v));
  const pct = (v, base) => base ? ` (${v >= 0 ? "+" : "−"}${Math.abs(v / base * 100).toFixed(1).replace(".", ",")} %)` : "";
  const deltaCls = v => v > 0.004 ? "up" : v < -0.004 ? "down" : "flat";

  // ---------- sets ----------
  const SET_TTL = 7 * 864e5;
  const setIdOf = c => c && c.market ? (c.market.setId || (c.market.tcgdexId ? String(c.market.tcgdexId).replace(/-[^-]+$/, "") : null)) : null;
  // Set data in German where TCGdex has it (names, card images); the English data fills gaps and gives the complete card list.
  async function getSet(setId) {
    const cached = state.setInfo.get(setId); if (cached && cached !== "error") return cached;
    const key = "ks-set2-" + setId;
    try { const raw = localStorage.getItem(key); if (raw) { const o = JSON.parse(raw); if (Date.now() - o.t < SET_TTL) { state.setInfo.set(setId, o.v); return o.v; } } } catch (_) {}
    const url = lang => TCG + lang + "/sets/" + encodeURIComponent(setId);
    const [en, de] = await Promise.all([tcgFetch(url("en")), tcgFetch(url("de")).catch(() => null)]);
    const base = (en && Array.isArray(en.cards)) ? en : (de && Array.isArray(de.cards) ? de : null);
    if (!base) throw new Error("set");
    const deCards = new Map(((de && de.cards) || []).map(c => [c.id, c]));
    const enCards = new Map(((en && en.cards) || []).map(c => [c.id, c]));
    const ids = [...new Set([...enCards.keys(), ...deCards.keys()])];
    const img = c => c && typeof c.image === "string" ? c.image : null;
    const cards = ids.map(id => {
      const e = enCards.get(id), d = deCards.get(id), any = e || d;
      return { id, localId: String(any.localId), name: (d && d.name) || e.name, nameEn: (e && e.name) || null, image: img(d) || img(e) };
    }).sort((a, b) => (isNum(a.localId) && isNum(b.localId)) ? Number(a.localId) - Number(b.localId) : a.localId.localeCompare(b.localId, "de", { numeric: true }));
    const pick = k => (de && de[k]) || (en && en[k]) || null;
    const slim = { id: base.id, name: pick("name"), nameEn: (en && en.name) || null, german: !!(de && de.name), logo: pick("logo"), symbol: pick("symbol"),
      releaseDate: pick("releaseDate"), serie: (de && de.serie && de.serie.name) || (en && en.serie && en.serie.name) || null,
      official: (base.cardCount && num(base.cardCount.official)) || null, total: (base.cardCount && num(base.cardCount.total)) || cards.length, cards };
    state.setInfo.set(setId, slim);
    try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), v: slim })); } catch (_) {}
    return slim;
  }
  const setLoading = new Set();
  function ensureSets(ids) {
    const todo = ids.filter(id => !state.setInfo.has(id) && !setLoading.has(id));
    if (!todo.length) return;
    todo.forEach(id => setLoading.add(id));
    (async () => {
      for (const id of todo) {
        try { await getSet(id); } catch (_) { state.setInfo.set(id, "error"); }
        setLoading.delete(id);
        if (state.tab === "sets") renderSets();
        if (state.tab === "inv") renderInv();
        if (state.sheet && (state.sheet.type === "set" && state.sheet.id === id || state.sheet.type === "detail")) renderSheet();
      }
    })();
  }
  const isNum = s => /^\d+$/.test(String(s));
  // Owned cards of a set, keyed by TCGdex card id.
  function ownedInSet(setId) {
    const m = new Map();
    for (const c of state.cards) if (setIdOf(c) === setId && c.market && c.market.tcgdexId) {
      const e = m.get(c.market.tcgdexId) || { qty: 0, value: 0, cards: [] };
      e.qty += c.qty || 1; e.value += (num(c.priceEur) || 0) * (c.qty || 1); e.cards.push(c); m.set(c.market.tcgdexId, e);
    }
    return m;
  }
  function setProgress(info, owned) {
    const official = info.official || info.total || info.cards.length;
    let main = 0, secret = 0;
    for (const sc of info.cards) if (owned.has(sc.id)) { if (isNum(sc.localId) && Number(sc.localId) <= official) main++; else secret++; }
    return { official, main, secret, pct: official ? main / official : 0 };
  }
  function setCardPrice(sc, owned) { const o = owned.get(sc.id); if (o) return num(o.cards[0].priceEur); return state.setPrices.has(sc.id) ? num(state.setPrices.get(sc.id)) : null; }
  async function loadMissingPrices(setId) {
    const info = state.setInfo.get(setId); if (!info || info === "error" || state.setPricesBusy) return;
    const owned = ownedInSet(setId);
    const todo = info.cards.filter(c => !owned.has(c.id) && !state.setPrices.has(c.id));
    state.setPricesBusy = { setId, done: 0, total: todo.length }; renderSheet();
    let i = 0;
    const worker = async () => {
      while (i < todo.length) {
        const sc = todo[i++];
        try { const d = await tcgFetch(detailUrl("en", sc.id)); const b = d ? buildMarket(d, { variant: "Normal" }, "en", false) : null; state.setPrices.set(sc.id, b && b.market ? (b.market.trend ?? b.priceEur) : null); }
        catch (e) { state.setPrices.set(sc.id, null); if (e && e.code === "tcg_network") { i = todo.length; } }
        state.setPricesBusy.done++;
        if (state.setPricesBusy.done % 6 === 0 && state.sheet && state.sheet.type === "set") renderSheet();
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    state.setPricesBusy = null;
    if (state.sheet && state.sheet.type === "set") renderSheet();
  }

  // ---------- sound ----------
  let actx = null;
  function audioUnlock() {
    try {
      if (!actx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return; actx = new C(); }
      if (actx.state === "suspended") actx.resume();
    } catch (_) {}
  }
  // "Ka-ching": short drawer clack (filtered noise) followed by two or three bell tones.
  // Two short, falling beeps: "already scanned in this session".
  function dupSound() {
    if (!settings.sound || !actx) return;
    try {
      const t = actx.currentTime + 0.01;
      [[660, 0], [440, 0.16]].forEach(([f, dt]) => {
        const o = actx.createOscillator(), g = actx.createGain(); o.type = "triangle"; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + dt); g.gain.exponentialRampToValueAtTime(0.35, t + dt + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.14);
        o.connect(g); g.connect(actx.destination); o.start(t + dt); o.stop(t + dt + 0.16);
      });
    } catch (_) {}
  }
  function cashSound(big) {
    if (!settings.sound || !actx) return;
    try {
      const t = actx.currentTime + 0.01;
      const out = actx.createGain(); out.gain.value = 0.55; out.connect(actx.destination);
      const len = Math.floor(actx.sampleRate * 0.08), buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      const n = actx.createBufferSource(); n.buffer = buf;
      const bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2600; bp.Q.value = 0.8;
      const ng = actx.createGain(); ng.gain.value = 0.7;
      n.connect(bp); bp.connect(ng); ng.connect(out); n.start(t);
      const bell = (start, f) => {
        for (const [m, a] of [[1, 0.5], [2.76, 0.16], [5.4, 0.07]]) {
          const o = actx.createOscillator(); o.type = "sine"; o.frequency.value = f * m;
          const g = actx.createGain();
          g.gain.setValueAtTime(0.0001, start);
          g.gain.exponentialRampToValueAtTime(a, start + 0.005);
          g.gain.exponentialRampToValueAtTime(0.0001, start + 0.7);
          o.connect(g); g.connect(out); o.start(start); o.stop(start + 0.75);
        }
      };
      bell(t + 0.06, 1568); bell(t + 0.17, 2093);
      if (big) bell(t + 0.3, 2637);
    } catch (_) {}
  }

  // ---------- camera ----------
  // Auto capture: a small grayscale copy of the frame area is analysed ~8x per second.
  // A shot is taken when the picture is detailed enough (a card, not an empty table),
  // has been still for a moment, and differs from the last captured card.
  const AUTO = { W: 36, H: 50, STABLE: 5, CHANGE: 14, MIN_DETAIL: 5, HOLD: 650, COOLDOWN: 1500, TICK: 120 };
  const BIG_PRICE = 20;
  let stream = null, camShots = 0, camTimer = null, prevG = null, lastG = null, stableSince = 0, lastShot = 0, frameState = "";
  const anaCanvas = document.createElement("canvas"); anaCanvas.width = AUTO.W; anaCanvas.height = AUTO.H;
  const anaCtx = anaCanvas.getContext("2d", { willReadFrequently: true });
  const camOpen = () => !!stream;

  function frameCrop(v, pad) {
    const box = v.getBoundingClientRect(), fr = $("#camFrame").getBoundingClientRect();
    const scale = Math.max(box.width / v.videoWidth, box.height / v.videoHeight);
    const ox = (box.width - v.videoWidth * scale) / 2, oy = (box.height - v.videoHeight * scale) / 2;
    let x = (fr.left - box.left - ox) / scale, y = (fr.top - box.top - oy) / scale, w = fr.width / scale, h = fr.height / scale;
    x -= w * pad; y -= h * pad; w *= 1 + 2 * pad; h *= 1 + 2 * pad;
    x = Math.max(0, x); y = Math.max(0, y); w = Math.min(v.videoWidth - x, w); h = Math.min(v.videoHeight - y, h);
    return { x, y, w, h };
  }
  function sampleGray(v) {
    const c = frameCrop(v, 0);
    anaCtx.drawImage(v, c.x, c.y, c.w, c.h, 0, 0, AUTO.W, AUTO.H);
    const px = anaCtx.getImageData(0, 0, AUTO.W, AUTO.H).data;
    const g = new Float32Array(AUTO.W * AUTO.H);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2];
    return g;
  }
  const meanDiff = (a, b) => { let t = 0; for (let i = 0; i < a.length; i++) t += Math.abs(a[i] - b[i]); return t / a.length; };
  function detailOf(g) {
    const W = AUTO.W, H = AUTO.H; let t = 0, n = 0;
    for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) { const i = y * W + x; t += Math.abs(g[i + 1] - g[i]) + Math.abs(g[i + W] - g[i]); n++; }
    return t / n;
  }
  function setFrameState(st) {
    if (st === frameState) return;
    frameState = st;
    const f = $("#camFrame"); f.classList.remove("hold", "same", "go"); if (st) f.classList.add(st);
    const txt = !settings.auto ? "Auslöser tippen, um zu scannen"
      : st === "hold" ? "Stillhalten …"
      : st === "same" ? (camShots ? "Erfasst. Nächste Karte in den Rahmen" : "Karte in den Rahmen legen")
      : "Karte in den Rahmen legen";
    $("#camCount").textContent = txt;
  }
  function camTick() {
    const v = $("#camVideo");
    if (!stream || !v.videoWidth || document.hidden) return;
    let g;
    try { g = sampleGray(v); } catch (_) { return; }
    const now = performance.now();
    const moving = prevG ? meanDiff(g, prevG) : 99; prevG = g;
    if (moving > AUTO.STABLE) stableSince = now;
    if (!settings.auto) { setFrameState(""); return; }
    const fresh = !lastG || meanDiff(g, lastG) > AUTO.CHANGE;
    let st = "";
    if (!fresh) st = "same";
    else if (detailOf(g) >= AUTO.MIN_DETAIL) st = now - stableSince >= AUTO.HOLD ? "go" : "hold";
    setFrameState(st);
    if (st === "go" && now - lastShot > AUTO.COOLDOWN) { lastShot = now; lastG = g; shoot(true); }
  }

  async function openCamera() {
    audioUnlock();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $("#camFallback").click(); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    } catch (e) {
      stream = null;
      toast("Kein Kamerazugriff. Ich öffne stattdessen die Foto-Aufnahme.");
      $("#camFallback").click(); return;
    }
    const v = $("#camVideo"); v.srcObject = stream;
    $("#camera").hidden = false; statusBar(true);
    camShots = 0; prevG = null; lastG = null; stableSince = performance.now(); lastShot = performance.now(); frameState = "x";
    $("#camFeed").innerHTML = ""; $("#camPrice").classList.remove("on");
    updateCamTools(); setFrameState(""); updateCamSum();
    try { await v.play(); } catch (_) {}
    clearInterval(camTimer); camTimer = setInterval(camTick, AUTO.TICK);
  }
  function closeCamera() {
    clearInterval(camTimer); camTimer = null;
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null; $("#camera").hidden = true; $("#camVideo").srcObject = null; statusBar(isDark());
  }
  function updateCamTools() {
    $("#camAutoBtn").setAttribute("aria-pressed", String(settings.auto));
    $("#camSoundBtn").setAttribute("aria-pressed", String(settings.sound));
    $("#camSoundBtn").textContent = settings.sound ? "Ton an" : "Ton aus";
  }
  function updateCamSum() {
    const items = openItems();
    $("#camSum").textContent = items.length ? `Session: ${money(sessionTotal(items))}` : "";
  }
  async function shoot(auto) {
    haptic("medium");
    const v = $("#camVideo"); if (!v.videoWidth) return;
    if (!auto) { try { lastG = sampleGray(v); } catch (_) {} lastShot = performance.now(); }
    const flash = $("#camFlash"); flash.classList.add("on"); setTimeout(() => flash.classList.remove("on"), 60);
    const id = uid();
    camEntry(id);
    camShots++;
    try {
      const vers = await makeVersions(v, v.videoWidth, v.videoHeight, frameCrop(v, 0.06));
      await addFromVersions(vers, { id, auto: !!auto });
    } catch (_) { camResult(id, { status: "error", error: "Der Scan ließ sich nicht speichern." }); }
  }

  // Live results in the camera view
  const camEntries = new Map();
  function camEntry(id) {
    const feed = $("#camFeed");
    const el = document.createElement("div");
    el.className = "cam-item"; el.innerHTML = `<span class="n">Wird erkannt …</span><span class="p"></span>`;
    feed.prepend(el); camEntries.set(id, el);
    while (feed.children.length > 3) feed.lastElementChild.remove();
  }
  let priceTimer;
  function camResult(id, patch) {
    if (!camOpen()) return;
    const el = camEntries.get(id); camEntries.delete(id);
    updateCamSum();
    if (patch.status === "ok" && patch.card) {
      const c = patch.card, price = num(c.priceEur);
      const d = sessionDupes().get(id) || { ses: 0, inv: invCount(c) };
      const note = d.ses ? "Schon in dieser Session gescannt" : d.inv ? `Schon ${d.inv}× im Inventar` : "";
      if (el) {
        el.querySelector(".n").textContent = c.name + (d.ses ? " · doppelt" : d.inv ? ` · ${d.inv}× im Inventar` : "");
        el.querySelector(".p").textContent = price === null ? "kein Preis" : money(price);
        if (d.ses) el.classList.add("dup");
      }
      const pill = $("#camPrice");
      pill.innerHTML = `<b>${price === null ? "kein Preis" : esc(money(price)) + (c.priceSource === "markt" ? "" : " (KI)")}</b>${note ? `<small>${esc(note)}</small>` : ""}`;
      pill.classList.toggle("dup", !!d.ses);
      pill.classList.remove("on"); void pill.offsetWidth; pill.classList.add("on");
      clearTimeout(priceTimer); priceTimer = setTimeout(() => pill.classList.remove("on"), d.ses ? 5000 : 3500);
      if (d.ses) { dupSound(); haptic("warning"); } else if (price !== null) { cashSound(price >= BIG_PRICE); haptic("success"); }
    } else if (el) {
      el.classList.add("err");
      el.querySelector(".n").textContent = patch.status === "nocard" ? "Keine Karte erkannt" : (patch.error || "Nicht erkannt");
    }
    if (el) setTimeout(() => { el.classList.add("fade"); setTimeout(() => el.remove(), 450); }, 7000);
  }

  // ---------- rendering ----------
  const I = {
    cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    pics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-8 8"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/></svg>',
    find: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  };
  const setNameOf = c => { const si = state.setInfo.get(setIdOf(c)); return si && si !== "error" ? si.name : c.set; };
  const subLine = c => [setNameOf(c), c.number].filter(Boolean).map((v, i, a) => (i === a.length - 1 && c.number) ? `<span class="mono">${esc(v)}</span>` : esc(v)).join(" · ") || "Set unbekannt";
  // Where a price comes from: for everyone only when it is not the normal market price; the source name only in tech mode.
  const srcLabel = c => c.priceSource === "hand" ? "eigener Preis" : c.priceSource === "markt" ? (tech() ? "Cardmarket-Trend" : "") : (num(c.priceEur) !== null ? "geschätzt" : "kein Preis");
  const priceChip = c => c.priceSource === "hand" ? '<span class="chip hand">eigener Preis</span>' : c.priceSource === "markt" ? (tech() ? '<span class="chip mk">Cardmarket</span>' : "") : (num(c.priceEur) !== null ? '<span class="chip ai">geschätzt</span>' : "");
  const imgTag = (src, alt) => src ? `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy">` : "";
  const thumbOf = (thumb, card) => thumb || officialImg(card, "low");

  const TAB_TITLES = { scan: "Scannen", inv: "Inventar", sets: "Sets", value: "Wert", hist: "Verlauf" };
  let shownTab = null;
  const calm = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  // Launch screen: stays until the first real content is on screen (at least briefly, so it doesn't flicker).
  let splashGone = false;
  function hideSplash() {
    if (splashGone) return; splashGone = true;
    const sp = $("#splash"); if (!sp) return;
    setTimeout(() => { sp.classList.add("out"); setTimeout(() => sp.remove(), 500); }, Math.max(0, 350 - performance.now()));
  }
  setTimeout(hideSplash, 3000);
  function render() {
    const authed = !!state.user && !state.recovery;
    $("#view-auth").hidden = authed; $("#nav").hidden = !authed; $("#topRight").hidden = !authed; $("#subtitle").hidden = !authed;
    // Login: the icon carries the name, so no large title above it.
    $("#brand").hidden = !authed;
    $("#pageTitle").textContent = $("#miniTitle").textContent = authed ? (TAB_TITLES[state.tab] || "Kartenscanner") : "";
    if (state.problem || (state.authReady && (!state.user || state.loaded))) hideSplash();
    if (!authed) { ["#view-scan", "#view-inv", "#view-sets", "#view-value", "#view-hist"].forEach(q => { $(q).hidden = true; }); renderAuth(); return; }
    document.querySelectorAll(".nav button").forEach(b => { if (b.dataset.tab === state.tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    const openDot = state.open && state.tab !== "scan";
    $("#navDot").innerHTML = openDot ? '<span class="dot" title="Offene Session"></span>' : "";
    // VoiceOver doesn't read the dot's title, so the tab itself says it.
    const scanTab = $('.nav button[data-tab="scan"]');
    if (openDot) scanTab.setAttribute("aria-label", "Scannen, offene Session"); else scanTab.removeAttribute("aria-label");
    $("#view-scan").hidden = state.tab !== "scan";
    $("#view-inv").hidden = state.tab !== "inv";
    $("#view-hist").hidden = state.tab !== "hist";
    $("#view-sets").hidden = state.tab !== "sets";
    $("#view-value").hidden = state.tab !== "value";
    $("#worth").textContent = state.loaded ? money(state.cards.reduce((s, c) => s + (num(c.priceEur) || 0) * (c.qty || 1), 0)) : "–";
    if (state.tab !== shownTab) { shownTab = state.tab; const v = $("#view-" + state.tab); v.classList.remove("view-in"); void v.offsetWidth; v.classList.add("view-in"); }
    if (state.tab === "scan") renderScan();
    if (state.tab === "inv") renderInv();
    if (state.tab === "hist") renderHist();
    if (state.tab === "sets") renderSets();
    if (state.tab === "value") renderValue();
  }

  // ---------- login: e-mail and password, stored only as hashes ----------
  // The e-mail address is turned into "e-<PBKDF2 hash>@kartenscanner.invalid" on the device; only
  // that hash reaches Supabase, so the database never contains the real address. The password is
  // hashed on the device as well (PBKDF2) before it is sent; Supabase then stores that value with
  // bcrypt, so the real password never leaves the phone. Older logins (user name "u-<sha256>",
  // real e-mail, unhashed password) keep working and are upgraded on the next successful login.
  const UNAME_RE = /^[a-z0-9._-]{3,32}$/;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const PSEUDO_DOMAIN = "kartenscanner.invalid";
  const normUser = u => String(u || "").trim().toLowerCase();
  const hex = buf => [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, "0")).join("");
  const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  async function pbkdf2(secret, salt, rounds) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret.normalize("NFC")), "PBKDF2", false, ["deriveBits"]);
    return crypto.subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: rounds, hash: "SHA-256" }, key, 256);
  }
  const isPseudo = email => String(email || "").endsWith("@" + PSEUDO_DOMAIN);
  const isEmailId = email => /^e-[0-9a-f]{64}@/.test(String(email || ""));
  async function emailIdOf(email) { return "e-" + hex(await pbkdf2(normUser(email), "kartenscanner-email-v1", 200000)) + "@" + PSEUDO_DOMAIN; }
  async function loginIdOf(input) {
    const u = normUser(input);
    if (u.endsWith("@" + PSEUDO_DOMAIN)) return u;
    if (u.includes("@")) return emailIdOf(u);
    return "u-" + hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("kartenscanner:" + u))) + "@" + PSEUDO_DOMAIN; // older user-name logins
  }
  async function pwHash(pw) { return "kp1." + b64url(await pbkdf2(pw, "kartenscanner-password-v1", 150000)); }
  // Sign in with the hashed password; fall back to the older ways of signing in and upgrade them.
  async function signIn(input, pw) {
    const u = normUser(input), id = await loginIdOf(u), hpw = await pwHash(pw);
    const tries = [[id, hpw, false], [id, pw, true]];
    if (u.includes("@") && !u.endsWith("@" + PSEUDO_DOMAIN)) tries.push([u, hpw, true], [u, pw, true]); // account still stored with the real address
    let lastErr = null;
    for (const [email, password, upgrade] of tries) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (!error) {
        if (upgrade) {
          const patch = { password: hpw };
          if (email !== id && u.includes("@")) patch.email = id;
          try { await sb.auth.updateUser(patch); } catch (_) {}
        }
        return;
      }
      lastErr = error;
      if (!(error.code === "invalid_credentials" || /invalid login/i.test(error.message || ""))) break;
    }
    throw lastErr;
  }
  const shownUser = () => {
    let n = ""; try { n = localStorage.getItem("ks-login") || localStorage.getItem("ks-username") || ""; } catch (_) {}
    return n || (state.user && !isPseudo(state.user.email) ? state.user.email : "dein Konto");
  };

  function authMsg(e) {
    const code = (e && (e.code || e.error_code)) || "", msg = String((e && e.message) || "");
    if (code === "invalid_credentials" || /invalid login/i.test(msg)) return "E-Mail oder Passwort ist falsch.";
    if (code === "email_not_confirmed" || /not confirmed/i.test(msg)) { logErr("Anmeldung", "Konto nicht bestätigt („Confirm email“ ausschalten)"); return "Dein Konto ist noch nicht freigeschaltet. Wende dich an den Admin der App."; }
    if (code === "user_already_exists" || code === "email_exists" || /already registered/i.test(msg)) return "Mit dieser E-Mail gibt es schon ein Konto. Melde dich an.";
    if (code === "same_password" || /should be different/i.test(msg)) return "Das neue Passwort muss sich vom alten unterscheiden.";
    if (code === "weak_password" || /password should/i.test(msg)) return "Das Passwort ist zu schwach. Nimm mindestens 8 Zeichen.";
    if (code !== "over_email_send_rate_limit" && (/rate.?limit/i.test(code + " " + msg) || (e && e.status === 429))) return "Zu viele Versuche in kurzer Zeit. Warte ein paar Minuten.";
    if (code === "signup_disabled" || /signups not allowed/i.test(msg)) return "Neue Konten sind gerade nicht möglich. Versuch es später erneut.";
    if (/sending.*email|confirmation email|email_address_not_authorized|over_email_send_rate_limit|not authorized/i.test(code + " " + msg)) { logErr("Anmeldung", "Supabase will eine Bestätigungs-Mail senden: „Confirm email“ ausschalten"); return "Das Konto lässt sich gerade nicht anlegen. Wende dich an den Admin der App."; }
    if (/fetch|network/i.test(msg)) return "Keine Verbindung zum Server. Prüfe dein Internet.";
    // Never show raw server messages (they can contain the internal login id); the admin finds them in the log.
    logErr("Anmeldung", (code ? code + ": " : "") + msg);
    return "Das hat nicht geklappt. Versuch es erneut oder wende dich an den Admin der App.";
  }

  function renderAuth() {
    const v = $("#view-auth");
    if (state.problem) { v.innerHTML = `<div class="notice"><strong>App noch nicht eingerichtet.</strong><br>${esc(state.problem)}</div>`; return; }
    if (!sb || !state.authReady) { v.innerHTML = `<div class="notice">Wird geladen …</div>`; return; }
    const m = state.recovery ? "newpw" : (state.authMode === "reset" ? "login" : state.authMode);
    const T = {
      login: ["Anmelden", "Melde dich mit deiner E-Mail-Adresse an.", "Anmelden"],
      signup: ["Konto erstellen", "Sammle deine Pokémon-Karten und sieh, was sie wert sind.", "Konto erstellen"],
      newpw: ["Neues Passwort", "Leg ein neues Passwort für dein Konto fest.", "Passwort speichern"],
    }[m];
    const nameField = m === "signup" ? `<label class="full"><span>Dein Name <span class="muted">(optional)</span></span><input class="field" id="a-name" name="name" autocomplete="nickname" maxlength="40" value="${esc(state.authName || "")}"></label>` : "";
    const pw2 = m === "signup" || m === "newpw" ? `<label class="full">Passwort wiederholen<input class="field" id="a-pw2" name="pw2" type="password" autocomplete="new-password" required></label>` : "";
    const user = m !== "newpw" ? `<label class="full">E-Mail<input class="field" id="a-user" name="user" type="email" inputmode="email" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required value="${esc(state.authEmail)}"></label>` : "";
    const pw = `<label class="full">${m === "newpw" ? "Neues Passwort (mind. 8 Zeichen)" : m === "signup" ? "Passwort (mind. 8 Zeichen)" : "Passwort"}<input class="field" id="a-pw" name="pw" type="password" autocomplete="${m === "login" ? "current-password" : "new-password"}" required></label>`;
    const links = {
      login: `<button class="btn ghost small" type="button" data-act="auth-mode" data-mode="signup">Noch kein Konto? Registrieren</button>`,
      signup: `<button class="btn ghost small" type="button" data-act="auth-mode" data-mode="login">Schon ein Konto? Anmelden</button>`,
      newpw: "",
    }[m];
    // Keep what was typed when the form is drawn again (e.g. after an error message).
    const kept = v.dataset.mode === m ? [...v.querySelectorAll("input")].map(i => [i.id, i.value]) : [];
    v.dataset.mode = m;
    v.innerHTML = `<section class="start auth">
        <img class="auth-logo" src="icons/icon.svg" alt="" width="64" height="64">
        <h2>${T[0]}</h2><p>${T[1]}</p>
        ${state.authMsg ? `<div class="notice ok-box">${esc(state.authMsg)}</div>` : ""}
        ${state.authErr ? `<div class="banner">${esc(state.authErr)}</div>` : ""}
        <form class="edit" id="authForm" novalidate>
          ${nameField}${user}${pw}${pw2}
          <button class="btn primary full" type="submit" ${state.authBusy ? "disabled" : ""}>${state.authBusy ? "Einen Moment …" : T[2]}</button>
        </form>
        <div class="auth-links">${links}</div>
        ${m === "login" ? `<p class="fine" style="margin:0">Passwort vergessen? Der Admin der App kann dir ein vorläufiges Passwort geben.</p>` : ""}
        ${m === "signup" ? `<p class="fine" style="margin:0">Deine E-Mail-Adresse wird nur unkenntlich gespeichert. Deshalb gibt es keinen Link zum Zurücksetzen: Merk dir dein Passwort gut.</p>` : ""}
      </section>`;
    for (const [id, val] of kept) { const el = id && document.getElementById(id); if (el && val) el.value = val; }
    $("#authForm").onsubmit = e => { e.preventDefault(); submitAuth(new FormData(e.target), m); };
  }

  async function submitAuth(f, m) {
    const raw = String(f.get("user") || "").trim(), pw = String(f.get("pw") || ""), pw2 = f.get("pw2");
    const name = String(f.get("name") || "").trim().slice(0, 40);
    if (m !== "newpw") state.authEmail = raw;
    if (m === "signup") state.authName = name;
    const fail = msg => { state.authErr = msg; state.authMsg = null; render(); };
    const u = normUser(raw);
    if (m === "login" && !(EMAIL_RE.test(u) || UNAME_RE.test(u))) return fail("Gib deine E-Mail-Adresse ein.");
    if (m === "signup" && !EMAIL_RE.test(u)) return fail("Gib eine gültige E-Mail-Adresse ein.");
    if ((m === "signup" || m === "newpw") && pw.length < 8) return fail("Das Passwort braucht mindestens 8 Zeichen.");
    if ((m === "signup" || m === "newpw") && pw2 !== null && pw !== String(pw2)) return fail("Die beiden Passwörter stimmen nicht überein.");
    if (m === "login" && !pw) return fail("Gib dein Passwort ein.");
    state.authBusy = true; state.authErr = null; state.authMsg = null; render();
    try {
      if (m === "login") {
        await signIn(u, pw);
        try { localStorage.setItem("ks-login", u); } catch (_) {}
      } else if (m === "signup") {
        state.pendingName = name; // stored with the profile right after the account is created
        const { data, error } = await sb.auth.signUp({ email: await emailIdOf(u), password: await pwHash(pw) }); if (error) throw error;
        try { localStorage.setItem("ks-login", u); } catch (_) {}
        state.authName = "";
        if (!data.session) { state.authMode = "login"; logErr("Registrierung", "Konto wartet auf E-Mail-Bestätigung (Confirm email in Supabase ausschalten)"); state.authErr = "Dein Konto wurde angelegt, ist aber noch nicht freigeschaltet. Wende dich an den Admin der App."; }
      } else if (m === "newpw") {
        const { error } = await sb.auth.updateUser({ password: await pwHash(pw) }); if (error) throw error;
        state.recovery = false; toast("Neues Passwort gespeichert.");
      }
    } catch (e) { state.authErr = authMsg(e); }
    state.authBusy = false; render();
  }

  // Settings: switch the login to an e-mail address / change the password (both hashed on the device).
  async function setLoginEmail(f) {
    const s = state.sheet; if (!s) return;
    const email = normUser(f.get("email")), cur = String(f.get("cur") || "");
    const fail = msg => { s.err = msg; s.busy = false; renderSheet(); };
    if (!EMAIL_RE.test(email)) return fail("Gib eine gültige E-Mail-Adresse ein.");
    if (!cur) return fail("Gib zur Bestätigung dein aktuelles Passwort ein.");
    s.busy = true; s.err = null; renderSheet();
    try {
      const id = await emailIdOf(email), hpw = await pwHash(cur);
      // Confirm the current password (any of the stored forms) before changing anything.
      let ok = null;
      for (const pw of [hpw, cur]) { const { error } = await sb.auth.signInWithPassword({ email: state.user.email, password: pw }); if (!error) { ok = pw; break; } }
      if (!ok) return fail("Das aktuelle Passwort ist falsch.");
      // Password first (only if it is still stored unhashed), then the login address. If Supabase refuses
      // to change the address directly (it would want to send a confirmation mail), show SQL with only the hash.
      if (ok !== hpw) { const { error } = await sb.auth.updateUser({ password: hpw }); if (error && error.code !== "same_password") throw error; }
      try { localStorage.setItem("ks-login", email); } catch (_) {}
      let changed = false;
      try { const { data, error } = await sb.auth.updateUser({ email: id }); if (!error && data && data.user && data.user.email === id) { state.user = data.user; changed = true; } } catch (_) {}
      if (changed) s.done = "ok"; else { s.done = "sql"; s.sql = loginSql(state.user.id, id); }
      s.busy = false; renderSheet(); render();
    } catch (e) { fail(authMsg(e)); }
  }
  const loginSql = (uid, id) => `update auth.users\n   set email = '${id}', email_confirmed_at = coalesce(email_confirmed_at, now()),\n       raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - 'email',\n       email_change = '', email_change_token_new = '', email_change_token_current = ''\n where id = '${uid}';\nupdate auth.identities\n   set identity_data = jsonb_set(coalesce(identity_data, '{}'::jsonb), '{email}', to_jsonb('${id}'::text))\n where user_id = '${uid}';`;
  async function changePassword(f) {
    const s = state.sheet; if (!s) return;
    const cur = String(f.get("cur") || ""), nw = String(f.get("new") || "");
    const fail = msg => { s.err = msg; s.busy = false; renderSheet(); };
    if (nw.length < 8) return fail("Das neue Passwort braucht mindestens 8 Zeichen.");
    if (nw !== String(f.get("new2") || "")) return fail("Die neuen Passwörter stimmen nicht überein.");
    s.busy = true; s.err = null; renderSheet();
    try {
      let ok = false;
      for (const pw of [await pwHash(cur), cur]) { const { error } = await sb.auth.signInWithPassword({ email: state.user.email, password: pw }); if (!error) { ok = true; break; } }
      if (!ok) return fail("Das aktuelle Passwort ist falsch.");
      const { error } = await sb.auth.updateUser({ password: await pwHash(nw) }); if (error) throw error;
      closeSheet(); toast("Passwort geändert.");
    } catch (e) { fail(authMsg(e)); }
  }

  function renderScan() {
    const v = $("#view-scan");
    if (state.problem) { v.innerHTML = `<div class="notice"><strong>Speicher nicht verfügbar.</strong><br>${esc(state.problem)}</div>`; return; }
    if (!state.loaded) { v.innerHTML = `<div class="notice">Wird geladen …</div>`; return; }
    const keyBanner = !settings.apiKey ? `<div class="banner info"><span>Damit die App Karten automatisch erkennt, richte einmalig die Erkennung ein. Bis dahin kannst du Karten über „Suchen“ hinzufügen.</span><button class="btn small" type="button" data-act="key-setup">Einrichten</button></div>` : "";
    const down = (state.marketDown ? `<div class="banner">${esc(state.marketDown)}</div>` : "") + legacyBanner();
    const scanButtons = `
      <div class="scanrow">
        <button class="btn primary" type="button" data-act="camera">${I.cam}<span>Karte scannen</span></button>
        <button class="btn" type="button" data-act="gallery">${I.pics}<span>Fotos</span></button>
        <button class="btn" type="button" data-act="manual">${I.find}<span>Suchen</span></button>
      </div>`;
    if (!state.open) {
      const last = state.sessions.filter(s => s.status === "done").sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0))[0];
      const hello = greetName() ? `Hallo ${esc(greetName())}!` : "Neue Scan-Session";
      v.innerHTML = `${keyBanner}${down}
        <section class="start">
          <div class="eyebrow">${hello}</div>
          <h2>Karten scannen und sehen, was sie wert sind</h2>
          ${state.sessions.some(x => x.status === "done") ? "" : `<div class="steps"><div><b>Scannen</b>Karte gut beleuchtet in den Rahmen halten.</div><div><b>Prüfen</b>Antippen, falls etwas nicht stimmt.</div><div><b>Abschließen</b>Gesamtwert sehen und ins Inventar legen.</div></div>`}
          ${scanButtons}
        </section>
        ${last ? `<div class="notice">Letzte Session am ${esc(dOnly(last.finishedAt))}: <strong>${last.count || 0} Karten</strong> · <strong class="mono">${money(last.total)}</strong></div>` : ""}`;
      return;
    }
    const items = openItems();
    const pending = items.filter(i => i.status === "pending").length;
    const errors = items.filter(i => i.status === "error").length;
    const ok = items.filter(i => i.status === "ok");
    const count = ok.reduce((s, i) => s + (i.qty || 1), 0);
    const noMk = ok.filter(i => i.card && i.card.priceSource !== "markt" && i.card.priceSource !== "hand").length;
    v.innerHTML = `${keyBanner}${down}
      <section class="session-head">
        <div class="session-meta">
          <div><div class="eyebrow">Session seit ${esc(dt(state.open.startedAt))}</div><div class="running">${money(sessionTotal(items))}</div></div>
          <div class="fine">${count} Karte${count === 1 ? "" : "n"}${pending ? ` · ${pending} in Arbeit` : ""}${errors ? ` · ${errors} offen` : ""}${noMk ? ` · ${noMk} ohne Marktpreis` : ""}</div>
        </div>
        ${scanButtons}
      </section>
      ${(state.dupView = sessionDupes(), "")}${items.length ? `<ul class="list">${items.slice().reverse().map(rowHTML).join("")}</ul><p class="fine" style="margin:-6px 0 0">Zum Entfernen eine Karte nach rechts wischen.</p>` : `<div class="empty">Noch keine Karte in dieser Session. Tippe auf „Karte scannen“.</div>`}
      <div class="session-foot">
        <button class="btn primary" type="button" data-act="finish" ${ok.length && !pending ? "" : "disabled"}>${pending ? "Warte auf Erkennung …" : "Session abschließen"}</button>
        <button class="btn ghost danger" type="button" data-act="discard">Verwerfen</button>
      </div>
      ${errors && !pending ? `<p class="fine">Offene Scans werden beim Abschließen nicht übernommen.</p>` : ""}`;
  }

  function legacyBanner() {
    const L = state.legacy; if (!L) return "";
    const n = (L.cards || []).reduce((t, c) => t + (c.qty || 1), 0), sN = (L.sessions || []).filter(x => x.status === "done").length;
    const mg = state.migrating;
    return `<div class="notice stack" style="gap:8px;border-color:var(--accent)"><span><strong>Karten auf diesem Gerät gefunden:</strong> ${n} Karte${n === 1 ? "" : "n"} und ${sN} Session${sN === 1 ? "" : "s"} aus der Version ohne Konto. Übernimm sie in dein Konto, damit sie dauerhaft gespeichert sind.</span>
      <button class="btn primary small" type="button" data-act="migrate" ${mg ? "disabled" : ""}>${mg ? `Übertrage ${mg.n}/${mg.total} …` : "In mein Konto übernehmen"}</button></div>`;
  }

  const swipeWrap = (id, inner) => `<li class="swipe" data-swipe-id="${esc(id)}"><div class="swipe-bg" aria-hidden="true">${I.trash}<span>Löschen</span></div>${inner}</li>`;
  function rowHTML(it) {
    const inner = rowInner(it).replace(/^<li /, "<div ").replace(/<\/li>$/, "</div>").replace('class="row', 'class="row swipe-fg');
    return swipeWrap(it.id, inner);
  }
  function rowInner(it) {
    const c = it.card || {};
    const mini = `<div class="mini">${imgTag(thumbOf(it.thumb, c), "Scan")}</div>`;
    if (it.status === "pending") return `<li class="row" aria-busy="true">${mini}<div style="min-width:0"><div class="stage">${esc(state.stage.get(it.id) || "Wird bearbeitet …")}</div><div class="bar"></div></div><div></div></li>`;
    if (it.status === "error") return `<li class="row err">${mini}<div style="min-width:0"><div class="errtxt">${esc(it.error || "Nicht erkannt.")}</div>
      <div class="erractions">${it.imageId && settings.apiKey ? `<button class="btn small" type="button" data-act="retry" data-id="${esc(it.id)}">Erneut erkennen</button>` : ""}
      <button class="btn small" type="button" data-act="search-item" data-id="${esc(it.id)}">Karte suchen</button>
      <button class="btn small ghost danger" type="button" data-act="remove" data-id="${esc(it.id)}">Entfernen</button></div></div><div></div></li>`;
    const lowConf = num(c.confidence) !== null && c.confidence < 0.6;
    const noMarket = c.priceSource !== "markt" && c.priceSource !== "hand";
    return `<li class="row" data-act="edit-item" data-id="${esc(it.id)}" tabindex="0" role="button" aria-label="${esc(c.name)} bearbeiten">${mini}
      <div style="min-width:0"><div class="nm">${esc(c.name)}</div><div class="sub">${subLine(c)}</div>
      <div class="chips">${dupChips(state.dupView && state.dupView.get(it.id))}${lowConf ? '<span class="chip warn">unsicher – prüfen</span>' : ""}${c.market && c.market.ambiguous ? '<span class="chip warn">bitte prüfen</span>' : ""}${c.condition && c.condition !== "NM" ? `<span class="chip">${esc(c.condition)}</span>` : ""}${c.variant && c.variant !== "Normal" ? `<span class="chip">${esc(c.variant)}</span>` : ""}${c.rarity ? `<span class="chip">${esc(c.rarity)}</span>` : ""}</div>
      ${noMarket && c.marketError ? `<div class="erractions"><span class="fine">${esc(c.marketError)}</span><button class="btn small" type="button" data-act="search-item" data-id="${esc(it.id)}">Karte suchen</button></div>` : ""}</div>
      <div class="px">${money(num(c.priceEur) === null ? null : c.priceEur * (it.qty || 1))}${(it.qty || 1) > 1 ? `<small>${it.qty} × ${money(c.priceEur)}</small>` : srcLabel(c) ? `<small>${esc(srcLabel(c))}</small>` : ""}</div></li>`;
  }

  function renderInv() {
    const cards = state.cards;
    ensureSets([...new Set(cards.map(setIdOf).filter(Boolean))]);
    const totalQty = cards.reduce((s, c) => s + (c.qty || 1), 0);
    const total = cards.reduce((s, c) => s + (num(c.priceEur) || 0) * (c.qty || 1), 0);
    $("#invStats").innerHTML = `
      <div class="stat"><div class="eyebrow">Karten</div><div class="v">${totalQty}</div></div>
      <div class="stat"><div class="eyebrow">Verschiedene</div><div class="v">${cards.length}</div></div>
      <div class="stat"><div class="eyebrow">Gesamtwert</div><div class="v">${money(total)}</div></div>`;
    const mk = cards.filter(c => c.priceSource === "markt" && c.market);
    const oldest = mk.reduce((m, c) => Math.min(m, c.market.updated || c.market.fetchedAt || Infinity), Infinity);
    const ki = cards.filter(c => c.priceSource !== "markt" && c.priceSource !== "hand").length;
    const rf = state.refreshing;
    $("#invPrices").innerHTML = cards.length ? `<div class="pricebar">
      <div class="fine">${tech() ? `${mk.length} von ${cards.length} mit Cardmarket-Preis${isFinite(oldest) ? ` · ältester Stand ${dOnly(oldest)}` : ""}${ki ? ` · ${ki} ohne Marktpreis` : ""}` : ki ? `${ki} Karte${ki === 1 ? "" : "n"} ohne Marktpreis` : ""}</div>
      <button class="btn small" type="button" data-act="refresh-all" ${rf ? "disabled" : ""}>${rf ? `Aktualisiere ${rf.done}/${rf.total} …` : "Preise aktualisieren"}</button></div>` : "";
    const q = state.search.trim().toLowerCase();
    const list = cards.filter(c => !q || [c.name, c.nameEn, c.set, c.setCode, c.number, c.rarity, c.pokemonType].some(v => String(v || "").toLowerCase().includes(q)));
    const val = c => (num(c.priceEur) || 0) * (c.qty || 1);
    list.sort({
      value: (a, b) => val(b) - val(a),
      new: (a, b) => (b.addedAt || 0) - (a.addedAt || 0),
      name: (a, b) => String(a.name).localeCompare(String(b.name), "de"),
      set: (a, b) => String(a.set || "").localeCompare(String(b.set || ""), "de") || String(a.number || "").localeCompare(String(b.number || ""), "de", { numeric: true }),
    }[state.sort] || (() => 0));
    const g = $("#invGrid");
    if (!cards.length) { g.innerHTML = `<div class="empty"><div>Dein Inventar ist noch leer. Scanne deine ersten Karten, dann erscheinen sie hier mit Bild und Wert.</div><button class="btn primary" type="button" data-tab="scan">Zur Scan-Session</button></div>`; return; }
    if (!list.length) { g.innerHTML = `<div class="empty">Keine Karte passt zu „${esc(state.search)}“.</div>`; return; }
    g.innerHTML = `<div class="grid">${list.map(c => `
      <button class="tile" type="button" data-act="detail" data-id="${esc(c.id)}">
        <div class="art">${imgTag(thumbOf(c.thumb, c), c.name)}${(c.qty || 1) > 1 ? `<span class="qty">×${c.qty}</span>` : ""}</div>
        <div class="info"><div class="nm">${esc(c.name)}</div><div class="num">${esc([c.setCode || c.set, c.number].filter(Boolean).join(" · ") || "–")}</div>
        <div class="price">${money(c.priceEur)}${c.priceSource === "markt" ? "" : c.priceSource === "hand" ? '<span class="src">eigen</span>' : (num(c.priceEur) !== null ? '<span class="src">geschätzt</span>' : "")}</div></div>
      </button>`).join("")}</div>`;
  }

  const SET_SORTS = [["progress", "Fortschritt"], ["value", "Dein Wert"], ["missing", "Wenigste fehlend"], ["name", "Name"], ["new", "Neueste zuerst"], ["old", "Älteste zuerst"]];
  function renderSets() {
    const v = $("#view-sets");
    if (!state.loaded) { v.innerHTML = `<div class="notice">Wird geladen …</div>`; return; }
    const ids = [...new Set(state.cards.map(setIdOf).filter(Boolean))];
    const unassigned = state.cards.filter(c => !setIdOf(c)).length;
    if (!ids.length) { v.innerHTML = `<div class="empty">Noch keine Sets. Sobald Karten in deinem Inventar sind, siehst du hier, wie viele dir pro Set noch fehlen.</div>`; return; }
    ensureSets(ids);
    const sort = settings.setSort;
    const rows = ids.map(id => {
      const info = state.setInfo.get(id), owned = ownedInSet(id);
      const value = [...owned.values()].reduce((t, e) => t + e.value, 0);
      if (!info || info === "error") {
        const anyCard = state.cards.find(c => setIdOf(c) === id);
        const name = (anyCard && anyCard.market && anyCard.market.matchSet) || id;
        return { id, name, pct: -1, value, missing: 1e9, date: "", html: `<button class="setrow" type="button" data-act="open-set" data-id="${esc(id)}"><div class="setlogo"></div><div style="min-width:0"><div class="nm">${esc(name)}</div><div class="sub">${info === "error" ? "Set-Daten nicht ladbar" : "Wird geladen …"} · ${owned.size} Karte${owned.size === 1 ? "" : "n"}</div></div><div class="px">${money(value)}</div></button>` };
      }
      const p = setProgress(info, owned);
      return { id, name: info.name, pct: p.pct, value, missing: p.official - p.main, date: info.releaseDate || "", html: `<button class="setrow" type="button" data-act="open-set" data-id="${esc(id)}">
        <div class="setlogo">${info.logo ? `<img src="${esc(info.logo)}.png" alt="" loading="lazy">` : ""}</div>
        <div style="min-width:0"><div class="nm">${esc(info.name)}</div>
          <div class="sub"><span class="mono">${p.main}/${p.official}</span>${p.secret ? ` + ${p.secret} Secret` : ""} · ${Math.floor(p.pct * 100)} %${info.releaseDate ? ` · ${esc(info.releaseDate.slice(0, 4))}` : ""}</div>
          <div class="prog"><i style="width:${(p.pct * 100).toFixed(1)}%"></i></div></div>
        <div class="px">${money(value)}<small>dein Wert</small></div></button>` };
    });
    const by = {
      progress: (a, b) => b.pct - a.pct || b.value - a.value,
      value: (a, b) => b.value - a.value,
      missing: (a, b) => a.missing - b.missing,
      name: (a, b) => a.name.localeCompare(b.name, "de"),
      new: (a, b) => (b.date || "").localeCompare(a.date || ""),
      old: (a, b) => (a.date || "9999").localeCompare(b.date || "9999"),
    }[sort] || (() => 0);
    rows.sort(by);
    v.innerHTML = `<div class="toolbar"><div class="fine" style="align-self:center">${ids.length} Set${ids.length === 1 ? "" : "s"} in deiner Sammlung</div>
        <select class="field" id="setSort" aria-label="Sets sortieren">${SET_SORTS.map(([k, l]) => `<option value="${k}" ${k === sort ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="setlist">${rows.map(r => r.html).join("")}</div>
      ${unassigned ? `<p class="fine">${unassigned} Karte${unassigned === 1 ? " ist" : "n sind"} noch keinem Set zugeordnet. Öffne sie im Inventar und tippe auf „Andere Karte wählen“.</p>` : ""}
      ${tech() ? `<p class="fine">Set- und Kartennamen auf Deutsch, soweit TCGdex sie kennt; sonst Englisch.</p>` : ""}`;
    $("#setSort").onchange = e => { settings.setSort = e.target.value; renderSets(); };
  }

  function renderValue() {
    const v = $("#view-value");
    if (!state.loaded) { v.innerHTML = `<div class="notice">Wird geladen …</div>`; return; }
    if (!state.historyOk) {
      v.innerHTML = `<div class="notice">Die Wertentwicklung ist gerade nicht verfügbar.${isAdmin() ? " (Admin: In der Datenbank fehlt die Tabelle „history“. supabase/schema.sql ausführen.)" : ""}</div>`;
      return;
    }
    const total = state.cards.reduce((t, c) => t + (num(c.priceEur) || 0) * (c.qty || 1), 0);
    const h = histSorted(), pts = h.slice(-120).map(x => ({ x: Date.parse(x.id + "T12:00:00"), y: x.total }));
    const today = dayId();
    if (!h.some(x => x.id === today)) pts.push({ x: Date.parse(today + "T12:00:00"), y: r2(total) });
    const b7 = baseline(7), b30 = baseline(30);
    const card = (label, base) => {
      if (!base) return `<div class="stat"><div class="eyebrow">${label}</div><div class="v flat">–</div></div>`;
      const dv = total - base.total;
      return `<div class="stat"><div class="eyebrow">${label}</div><div class="v ${deltaCls(dv)}">${signed(dv)}</div><div class="fine">seit ${esc(dOnly(Date.parse(base.id + "T12:00:00")))}</div></div>`;
    };
    // Market movement only: same cards, price then vs. now (ignores cards added or removed since).
    const base = b7 || h.find(x => x.id < today);
    let movers = [], marketDelta = 0;
    if (base && base.prices) {
      for (const c of state.cards) {
        const old = base.prices[c.id], now = num(c.priceEur);
        if (!old || now === null) continue;
        const dq = (now - old[0]) * (c.qty || 1); marketDelta += dq;
        if (Math.abs(now - old[0]) >= 0.01) movers.push({ c, old: old[0], now, dq });
      }
    }
    const up = movers.filter(m => m.dq > 0).sort((a, b) => b.dq - a.dq).slice(0, 5), down = movers.filter(m => m.dq < 0).sort((a, b) => a.dq - b.dq).slice(0, 5);
    const mv = m => `<li><button type="button" class="mover" data-act="detail" data-id="${esc(m.c.id)}"><div class="mini">${imgTag(thumbOf(m.c.thumb, m.c), "")}</div><div style="min-width:0"><div class="nm">${esc(m.c.name)}</div><div class="sub">${money(m.old)} → ${money(m.now)}${(m.c.qty || 1) > 1 ? ` · ×${m.c.qty}` : ""}</div></div><div class="px ${deltaCls(m.dq)}">${signed(m.dq)}</div></button></li>`;
    const rf = state.refreshing;
    v.innerHTML = `
      <section class="session-head">
        <div class="session-meta"><div><div class="eyebrow">Wert deiner Sammlung</div><div class="running">${money(total)}</div></div>
        <button class="btn small" type="button" data-act="refresh-all" ${rf ? "disabled" : ""}>${rf ? `Aktualisiere ${rf.done}/${rf.total} …` : "Preise aktualisieren"}</button></div>
        ${pts.length >= 2 ? lineChart(pts, { label: "Wert der Sammlung über Zeit" }) : `<p class="fine" style="margin:0">Ab heute speichert die App jeden Tag den Wert deiner Sammlung. Morgen siehst du hier die erste Kurve.</p>`}
      </section>
      <div class="stats stats2">${card("7 Tage", b7)}${card("30 Tage", b30)}</div>
      ${base && tech() ? `<div class="notice">Davon durch Preisänderungen am Markt: <strong class="${deltaCls(marketDelta)}">${signed(marketDelta)}</strong> seit ${esc(dOnly(Date.parse(base.id + "T12:00:00")))}. Der Rest kommt von neu hinzugefügten oder entfernten Karten.</div>` : ""}
      ${up.length ? `<h3 class="sec">Gewinner</h3><ul class="movers">${up.map(mv).join("")}</ul>` : ""}
      ${down.length ? `<h3 class="sec">Verlierer</h3><ul class="movers">${down.map(mv).join("")}</ul>` : ""}
      ${base && !movers.length ? `<p class="fine">Seit ${esc(dOnly(Date.parse(base.id + "T12:00:00")))} haben sich die Preise deiner Karten nicht verändert.</p>` : ""}
      <p class="fine">Die Preise werden einmal am Tag automatisch aktualisiert.</p>`;
  }

  function renderHist() {
    const v = $("#view-hist");
    const done = state.sessions.filter(s => s.status === "done").sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
    if (!done.length) { v.innerHTML = `<div class="empty">Noch keine abgeschlossene Session. Hier steht später jede Session mit Datum, Kartenzahl und Endbetrag.</div>`; return; }
    const sum = done.reduce((s, x) => s + (x.total || 0), 0);
    v.innerHTML = `<div class="notice">${done.length} Session${done.length === 1 ? "" : "s"} · zusammen <strong class="mono">${money(sum)}</strong> beim Scannen</div>` +
      done.map(s => `<details class="hist"><summary><div><div class="t">${esc(dt(s.finishedAt))}</div><div class="sub">${s.count || 0} Karte${s.count === 1 ? "" : "n"}</div></div><div class="px">${money(s.total)}</div></summary>
        <ul>${(s.summary || []).map(x => `<li><span>${esc(x.name)}${x.qty > 1 ? ` ×${x.qty}` : ""} <span class="muted">${esc([x.set, x.number].filter(Boolean).join(" · "))}${x.priceSource && x.priceSource !== "markt" ? ` · ${x.priceSource === "hand" ? "eigen" : "geschätzt"}` : ""}</span></span><span class="mono">${money(num(x.priceEur) === null ? null : x.priceEur * (x.qty || 1))}</span></li>`).join("")}</ul></details>`).join("");
  }

  // ---------- admin area (only accounts listed in public.admins; the server checks this too) ----------
  const ADMIN_TABS = [["users", "Nutzer"], ["tests", "Tests"], ["tech", "Technik"], ["care", "Wartung"]];
  const ago = ts => {
    if (!ts) return "nie";
    const t = typeof ts === "number" ? ts : Date.parse(ts), m = Math.round((Date.now() - t) / 60e3);
    if (m < 2) return "gerade eben"; if (m < 60) return `vor ${m} Min.`;
    const h = Math.round(m / 60); if (h < 24) return `vor ${h} Std.`;
    const d = Math.round(h / 24); return d < 30 ? `vor ${d} Tag${d === 1 ? "" : "en"}` : dOnly(t);
  };
  const loginLabel = l => {
    l = String(l || "");
    if (/@kartenscanner\.invalid$/.test(l)) return l.replace(/@kartenscanner\.invalid$/, "").slice(0, 12) + "…";
    const [a, d] = l.split("@"); return d ? a.slice(0, 2) + "•••@" + d : l;
  };
  const nfmt = n => new Intl.NumberFormat("de-DE").format(Number(n) || 0);
  const fact = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`; // values are escaped by the caller

  function adminBody(s) {
    const tabs = `<div class="seg seg4" role="group" aria-label="Bereich">${ADMIN_TABS.map(([k, l]) => `<button type="button" data-act="admin-tab" data-pane="${k}" aria-pressed="${s.tab === k}">${l}</button>`).join("")}</div>`;
    const inner = s.tab === "users" ? (s.sel ? adminUserDetail(s) : adminUserList(s)) : s.tab === "tests" ? adminTests(s) : s.tab === "tech" ? adminTech() : adminCare(s);
    return `<div class="stack admin">${tabs}${inner}</div>`;
  }
  function adminAfterRender(s) {
    if (s.tab === "care" && !s.local && !s.localBusy) { s.localBusy = true; Cache.accounts().then(a => { s.local = a.filter(x => x.cards || x.sessions || x.history); s.localBusy = false; if (state.sheet === s) renderSheet(); }).catch(() => { s.local = []; s.localBusy = false; }); }
    if (s.tab === "users" && !s.users && !s.usersLoading && !s.usersErr) adminLoadUsers();
    if (s.tab === "tests" && !s.diag && !s.diagBusy) adminDiag();
  }
  function adminUserList(s) {
    if (s.usersErr) return `<div class="banner">${esc(s.usersErr)}</div><button class="btn" type="button" data-act="admin-reload">Erneut versuchen</button>`;
    if (!s.users) return `<div class="notice">Wird geladen …</div>`;
    const us = s.users, active = us.filter(u => u.last_seen && Date.now() - Date.parse(u.last_seen) < 30 * 864e5).length;
    const sum = k => us.reduce((t, u) => t + (Number(u[k]) || 0), 0);
    const stat = (l, v) => `<div class="stat"><div class="eyebrow">${l}</div><div class="v">${v}</div></div>`;
    return `<div class="stats stats2">${stat("Konten", nfmt(us.length))}${stat("Aktiv (30 Tage)", nfmt(active))}${stat("Scans gesamt", nfmt(sum("scans")))}${stat("Karten gesamt", nfmt(sum("card_qty")))}</div>
      <ul class="list ulist">${us.map(u => `<li><button class="urow" type="button" data-act="admin-user" data-id="${esc(u.user_id)}">
        <div class="avatar" aria-hidden="true">${esc(((u.name || "?").trim().charAt(0) || "?").toUpperCase())}</div>
        <div style="min-width:0"><div class="nm">${esc(u.name || "Ohne Namen")}${u.user_id === uidNow() ? ' <span class="badge">Du</span>' : ""}${u.admin ? ' <span class="badge">Admin</span>' : ""}${u.blocked ? ' <span class="badge bad">Gesperrt</span>' : ""}</div>
        <div class="sub">${nfmt(u.card_qty)} Karten · ${money(Number(u.value))} · ${nfmt(u.scans)} Scans</div></div>
        <div class="px"><small>${esc(ago(u.last_seen || u.last_sign_in_at))}</small></div></button></li>`).join("")}</ul>
      <p class="gf">Namen geben die Nutzer selbst an; E-Mail-Adressen sind nur unkenntlich gespeichert. Fremde Karten siehst du nicht, nur Zahlen.</p>
      <button class="btn" type="button" data-act="admin-reload">Aktualisieren</button>`;
  }
  function adminUserDetail(s) {
    const u = (s.users || []).find(x => x.user_id === s.sel);
    if (!u) return `<div class="notice">Konto nicht gefunden.</div><button class="btn" type="button" data-act="admin-back">‹ Alle Nutzer</button>`;
    const self = u.user_id === uidNow();
    return `<button class="btn ghost small back" type="button" data-act="admin-back">‹ Alle Nutzer</button>
      <div class="dtitle"><h2>${esc(u.name || "Ohne Namen")}</h2><div class="sub">${esc(loginLabel(u.login))}${u.admin ? " · Admin" : ""}${u.blocked ? ' · <span class="bad-txt">gesperrt</span>' : ""}</div></div>
      <dl class="facts">
        ${fact("Konto seit", esc(dOnly(Date.parse(u.created_at))))}
        ${fact("Zuletzt aktiv", esc(ago(u.last_seen || u.last_sign_in_at)))}
        ${fact("Karten", `${nfmt(u.card_qty)} (${nfmt(u.cards)} verschiedene)`)}
        ${fact("Sammlungswert", money(Number(u.value)))}
        ${fact("Sessions", nfmt(u.sessions))}
        ${fact("Scans", `${nfmt(u.scans)} (30 Tage: ${nfmt(u.scans_30d)})`)}
        ${fact("KI-Tokens", `${nfmt(u.input_tokens)} rein · ${nfmt(u.output_tokens)} raus`)}
      </dl>
      ${s.msg ? `<div class="notice ok-box">${esc(s.msg)}</div>` : ""}${s.err ? `<div class="banner">${esc(s.err)}</div>` : ""}
      ${self ? `<p class="gf">Das ist dein eigenes Konto.</p>` : `
      <form class="edit" id="adminPwForm"><label class="full">Vorläufiges Passwort setzen<input class="field" name="pw" minlength="8" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="mind. 8 Zeichen" required></label>
        <button class="btn full" type="submit" ${s.busy ? "disabled" : ""}>Passwort setzen</button></form>
      <div class="actions">
        <button class="btn" type="button" data-act="${u.blocked ? "admin-unblock" : "admin-block"}" data-id="${esc(u.user_id)}" ${s.busy ? "disabled" : ""}>${u.blocked ? "Entsperren" : "Sperren"}</button>
        <button class="btn danger" type="button" data-act="${s.confirmDel ? "admin-delete-yes" : "admin-delete"}" data-id="${esc(u.user_id)}" ${s.busy ? "disabled" : ""}>${s.confirmDel ? "Endgültig löschen?" : "Konto löschen"}</button>
      </div>
      <p class="gf">Sperren meldet das Konto sofort ab, die Daten bleiben erhalten. Löschen entfernt das Konto mit allen Karten und Fotos endgültig.</p>`}`;
  }
  function adminTests(s) {
    const c = s.conn, t = s.scan, q = s.price, d = s.diag;
    const langs = [["DE", "Deutsch"], ["EN", "Englisch"], ["FR", "Französisch"], ["IT", "Italienisch"], ["ES", "Spanisch"], ["JP", "Japanisch"]];
    return `<section><h3 class="gh">Verbindungen</h3><div class="group pad stack" style="gap:8px">
        ${c && c.results ? c.results.map(r => `<div class="${r.ok ? "ok-txt" : "bad-txt"}">${r.ok ? "✓" : "✕"} ${esc(r.msg)}</div>`).join("") : `<div class="fine">Prüft Datenbank, Preise und den Schlüssel auf diesem Gerät.</div>`}
        <div><button class="btn small" type="button" data-act="admin-conn" ${c && c.running ? "disabled" : ""}>${c && c.running ? "Teste …" : "Jetzt testen"}</button></div></div></section>
      <section><h3 class="gh">Test-Scan</h3><div class="group pad stack" style="gap:8px">
        <div class="fine">Erkennt ein Foto, ohne es zu speichern, und zeigt die Rohdaten.</div>
        <div><button class="btn small" type="button" data-act="admin-scan" ${t && t.running ? "disabled" : ""}>${t && t.running ? esc(t.stage || "Läuft …") : "Foto wählen"}</button></div>
        ${t && t.error ? `<div class="bad-txt">${esc(t.error)}</div>` : ""}
        ${t && t.done ? `<dl class="facts">${fact("Dauer", `${nfmt(t.ms)} ms`)}${fact("Modell", esc(t.model || "–"))}${fact("Tokens", `${nfmt(t.usage.input_tokens)} rein · ${nfmt(t.usage.output_tokens)} raus`)}${fact("Erkannt", esc([t.card.name, t.card.set, t.card.number].filter(Boolean).join(" · ") || "–"))}${fact("Preis", t.market && t.market.market ? `${money(t.market.priceEur)} · ${esc([t.market.market.matchSet, t.market.market.matchLocal].filter(Boolean).join(" "))}` : esc((t.market && t.market.error) || "kein Treffer"))}</dl>` : ""}
        ${t && t.text ? `<div class="fine">Antwort der KI</div><pre class="sqlbox raw">${esc(t.text)}</pre>` : ""}
      </div></section>
      <section><h3 class="gh">Preis-Abfrage</h3><div class="group pad">
        <form class="edit" id="adminPriceForm">
          <label class="full">Kartenname<input class="field" name="q" value="${esc((q && q.q) || "")}" placeholder="z. B. Glurak" required></label>
          <label>Nummer<input class="field mono" name="n" value="${esc((q && q.n) || "")}" placeholder="136/189"></label>
          <label>Sprache<select class="field" name="lang">${langs.map(([v, l]) => `<option value="${v}" ${((q && q.lang) || "DE") === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          <button class="btn small full" type="submit" ${q && q.running ? "disabled" : ""}>${q && q.running ? "Suche …" : "Abfragen"}</button>
        </form>
        ${q && q.res ? `<pre class="sqlbox raw">${esc(q.res)}</pre>` : ""}
      </div></section>
      <section><h3 class="gh">Diagnose</h3>${d ? `<dl class="facts">${d.map(([k, v]) => fact(esc(k), esc(v))).join("")}</dl>` : `<div class="notice">Wird ermittelt …</div>`}</section>`;
  }
  function adminTech() {
    const cards = state.cards, mk = cards.filter(c => c.priceSource === "markt" && c.market);
    const oldest = mk.reduce((m, c) => Math.min(m, c.market.updated || c.market.fetchedAt || Infinity), Infinity);
    const noMk = cards.filter(c => c.priceSource !== "markt" && c.priceSource !== "hand").length, hand = cards.filter(c => c.priceSource === "hand").length;
    const noSet = cards.filter(c => !setIdOf(c)).length, amb = cards.filter(c => c.market && c.market.ambiguous).length;
    let host = "–"; try { host = new URL(CFG.supabaseUrl).host; } catch (_) {}
    return `<div class="group"><button class="cell" type="button" role="switch" aria-checked="${settings.tech}" data-act="set-tech"><span>Technik-Details in der App</span><span class="switch" aria-hidden="true"></span></button></div>
      <p class="gf" style="margin-top:-8px">Zeigt Preisquelle, Zuordnung, KI-Sicherheit und Zusatzfelder überall in der App, nur für dich.</p>
      <section><h3 class="gh">Preise (dein Inventar)</h3><dl class="facts">
        ${fact("Mit Marktpreis", `${nfmt(mk.length)} von ${nfmt(cards.length)}`)}${fact("Ältester Preisstand", isFinite(oldest) ? esc(dOnly(oldest)) : "–")}
        ${fact("Ohne Marktpreis", nfmt(noMk))}${fact("Eigener Preis", nfmt(hand))}${fact("Ohne Set", nfmt(noSet))}${fact("Mehrdeutig zugeordnet", nfmt(amb))}
        ${fact("Quelle", "Cardmarket-Trend über TCGdex")}</dl></section>
      <section><h3 class="gh">Daten</h3><dl class="facts">
        ${fact("Datenbank", esc(host))}${fact("Letzter Abgleich", state.lastSync ? esc(ago(state.lastSync)) : "–")}
        ${fact("Karten · Sessions · Scans", `${nfmt(cards.length)} · ${nfmt(state.sessions.length)} · ${nfmt(state.items.length)}`)}
        ${fact("Verlaufspunkte", nfmt(state.history.length))}${fact("Erkennungsmodell", esc(settings.model))}
        ${fact("App", NATIVE ? `iOS-App, Build ${esc(app.build || "–")}` : "Web-App")}
        ${fact("Profil-Funktionen", state.me && state.me.missing ? '<span class="bad-txt">fehlen, schema.sql ausführen</span>' : "ok")}</dl></section>`;
  }
  function adminCare(s) {
    const rf = state.refreshing, log = readErrLog().slice().reverse();
    return `<div class="group">
        <button class="cell action" type="button" data-act="refresh-all" ${rf ? "disabled" : ""}>${rf ? `Aktualisiere ${rf.done}/${rf.total} …` : "Alle Preise neu laden"}</button>
        <button class="cell action" type="button" data-act="admin-clear-cache" ${s.clearing ? "disabled" : ""}>${s.clearing ? "Wird neu geladen …" : "Zwischenspeicher leeren und neu laden"}</button>
        <button class="cell action" type="button" data-act="export">Backup exportieren</button></div>
      <p class="gf" style="margin-top:-8px">Betrifft dein Konto auf diesem Gerät.</p>
      <section><h3 class="gh">Auf diesem Gerät gespeicherte Sammlungen</h3>
        ${s.local ? (s.local.length ? `<div class="group">${s.local.map(a => `<div class="cell" style="flex-wrap:wrap"><span>${a.uid === uidNow() ? "Dieses Konto" : "Früheres Konto"} <span class="muted">${esc(a.uid.slice(0, 8))}</span><br><span class="fine">${nfmt(a.qty)} Karten · ${money(a.value)} · ${nfmt(a.sessions)} Sessions · ${nfmt(a.history)} Verlaufstage</span></span>${a.uid === uidNow() ? "" : `<button class="btn small" type="button" data-act="admin-restore" data-id="${esc(a.uid)}" ${s.restoring ? "disabled" : ""}>${s.restoring === a.uid ? esc(s.restoreStage || "Übernehme …") : "In dieses Konto übernehmen"}</button>`}</div>`).join("")}</div>` : `<div class="notice">Keine gespeicherten Sammlungen gefunden.</div>`) : `<div class="notice">Wird gesucht …</div>`}
        <p class="gf">Holt eine Sammlung zurück, die nur noch auf diesem Gerät liegt (z. B. nach einem gelöschten Konto). Gleiche Karten werden nicht doppelt angelegt.</p></section>
      <section><h3 class="gh">Fehlerprotokoll (dieses Gerät)</h3>
        ${log.length ? `<ul class="list loglist">${log.slice(0, 40).map(x => `<li><div class="sub">${esc(new Date(x.t).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }))} · ${esc(x.w)}</div><div class="logmsg">${esc(x.m)}</div></li>`).join("")}</ul>
          <div class="actions" style="margin-top:10px"><button class="btn small" type="button" data-act="admin-log-copy">Kopieren</button><button class="btn small danger" type="button" data-act="admin-log-clear">Leeren</button></div>` : `<div class="notice">Keine Fehler aufgezeichnet.</div>`}</section>`;
  }
  async function adminLoadUsers(force) {
    const s = state.sheet; if (!s || s.type !== "admin" || s.usersLoading || (s.users && !force)) return;
    s.usersLoading = true; s.usersErr = null; if (force) s.users = null; renderSheet();
    try { const { data, error } = await sb.rpc("admin_users"); if (error) throw error; s.users = data || []; }
    catch (e) {
      logErr("Admin", e);
      const m = String((e && (e.message || e.code)) || "");
      s.usersErr = /forbidden/i.test(m) ? "Für diesen Bereich fehlen dir die Admin-Rechte." : /PGRST202|function|schema cache|does not exist/i.test(m) ? "Die Admin-Funktionen fehlen in der Datenbank. Führe supabase/schema.sql im SQL Editor aus." : "Die Nutzerliste ließ sich nicht laden.";
    }
    s.usersLoading = false; if (state.sheet === s) renderSheet();
  }
  const rpcErr = e => { const m = String((e && e.message) || ""); return m && m.length < 120 && !/^(forbidden|permission)/i.test(m) ? m : "Das hat nicht geklappt."; };
  async function adminBlock(target, on) {
    const s = state.sheet; s.busy = true; s.msg = s.err = null; renderSheet();
    try {
      const { error } = await sb.rpc("admin_set_blocked", { p_user: target, p_blocked: on }); if (error) throw error;
      const u = (s.users || []).find(x => x.user_id === target); if (u) u.blocked = on;
      s.msg = on ? "Konto gesperrt und abgemeldet." : "Konto entsperrt.";
    } catch (e) { logErr("Admin", e); s.err = rpcErr(e); }
    s.busy = false; if (state.sheet === s) renderSheet();
  }
  async function adminSetPassword(pw) {
    const s = state.sheet; if (!s || !s.sel) return;
    if (pw.length < 8) { s.err = "Das Passwort braucht mindestens 8 Zeichen."; s.msg = null; renderSheet(); return; }
    s.busy = true; s.msg = s.err = null; renderSheet();
    try {
      // Same on-device hashing as the login, so the person can sign in with exactly this password.
      const { error } = await sb.rpc("admin_set_password", { p_user: s.sel, p_hash: await pwHash(pw) }); if (error) throw error;
      const u = (s.users || []).find(x => x.user_id === s.sel);
      s.msg = `Passwort gesetzt. Gib es ${u && u.name ? u.name : "der Person"} weiter; ändern geht danach unter Einstellungen → Passwort ändern.`;
    } catch (e) { logErr("Admin", e); s.err = rpcErr(e); }
    s.busy = false; if (state.sheet === s) renderSheet();
  }
  async function adminDelete(target) {
    const s = state.sheet; s.busy = true; s.msg = s.err = null; renderSheet();
    try {
      // Photos first (the database cannot delete files), then the account with all its rows.
      const store = sb.storage.from(BUCKET);
      for (let round = 0; round < 50; round++) {
        const { data, error } = await store.list(target, { limit: 100 });
        if (error) throw error;
        const files = (data || []).filter(f => f && f.name && f.name !== ".emptyFolderPlaceholder").map(f => `${target}/${f.name}`);
        if (!files.length) break;
        const r = await store.remove(files); if (r.error) throw r.error;
      }
      const { error } = await sb.rpc("admin_delete_user", { p_user: target }); if (error) throw error;
      s.users = (s.users || []).filter(x => x.user_id !== target); s.sel = null; toast("Konto gelöscht.");
    } catch (e) { logErr("Admin", e); s.err = rpcErr(e); }
    s.busy = false; s.confirmDel = false; if (state.sheet === s) renderSheet();
  }
  async function adminConn() {
    const s = state.sheet; if (!s) return;
    s.conn = { running: true }; renderSheet();
    const results = await connResults();
    s.conn = { results }; if (state.sheet === s) renderSheet();
  }
  function adminPickScan() {
    let inp = $("#adminScanIn");
    if (!inp) {
      inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*"; inp.id = "adminScanIn"; inp.hidden = true;
      document.body.appendChild(inp);
      inp.addEventListener("change", () => { const f = inp.files && inp.files[0]; inp.value = ""; if (f) adminTestScan(f); });
    }
    inp.click();
  }
  async function adminTestScan(file) {
    const s = state.sheet; if (!s || s.type !== "admin") return;
    const step = t => { s.scan = { running: true, stage: t }; if (state.sheet === s) renderSheet(); };
    let raw = null;
    try {
      step("Foto wird vorbereitet …");
      const im = await loadImage(file); let v; try { v = await makeVersions(im.img, im.w, im.h); } finally { im.done(); }
      step("KI erkennt die Karte …");
      const r = await identify(v.ai, { raw: x => { raw = x; } });
      const card = normalizeCard(r || {});
      step("Preis wird gesucht …");
      const market = await lookupMarket(card, { fresh: true });
      s.scan = { done: true, ms: raw ? raw.ms : 0, model: raw && raw.model, usage: (raw && raw.usage) || {}, text: raw ? raw.text : "", card, market };
    } catch (e) { logErr("Test-Scan", e); s.scan = { error: e && e.code ? aiMsg(e) : "Der Test-Scan ist fehlgeschlagen.", text: raw ? raw.text : "" }; }
    if (state.sheet === s) renderSheet();
  }
  async function adminPriceTest(f) {
    const s = state.sheet; if (!s) return;
    const q = { q: String(f.get("q") || "").trim(), n: String(f.get("n") || "").trim(), lang: String(f.get("lang") || "DE"), running: true };
    s.price = q; renderSheet();
    const lines = [];
    try {
      const res = await lookupMarket({ name: q.q, nameEn: q.lang === "EN" ? q.q : null, number: q.n || null, language: q.lang, variant: "Normal" }, { fresh: true });
      if (res.market) {
        const m = res.market;
        lines.push(`Treffer: ${m.matchName} · ${m.matchSet} · Nr. ${m.matchLocal}${m.matchOfficial ? "/" + m.matchOfficial : ""}${m.ambiguous ? " (mehrdeutig)" : ""}`,
          `Preis: ${money(res.priceEur)} (Trend ${money(m.trend)}, ab ${money(m.low)}, Ø 30 Tage ${money(m.avg30)})`, `TCGdex-ID: ${m.tcgdexId} (${m.lang})`);
      } else lines.push("Kein Preis: " + (res.error || "keine Antwort"));
      lines.push("", "Rohdaten:", JSON.stringify(res, null, 1).slice(0, 3000));
    } catch (e) { lines.push("Fehler: " + ((e && (e.message || e.code)) || e)); }
    q.running = false; q.res = lines.join("\n"); if (state.sheet === s) renderSheet();
  }
  async function adminDiag() {
    const s = state.sheet; if (!s || s.type !== "admin" || s.diagBusy) return;
    s.diagBusy = true;
    let store = "–";
    try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); store = `${(e.usage / 1048576).toFixed(1)} MB belegt`; } } catch (_) {}
    const ua = navigator.userAgent, ios = ua.match(/OS (\d+)_(\d+)/);
    const dev = /iPhone|iPad/.test(ua) ? (ios ? `iOS ${ios[1]}.${ios[2]}` : "iOS") : /Android/.test(ua) ? "Android" : "Computer";
    const standalone = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone;
    s.diag = [
      ["App", NATIVE ? `iOS-App, Build ${app.build || "–"}` : standalone ? "Web-App vom Home-Bildschirm" : "Web-App im Browser"],
      ["Gerät", dev], ["Online", navigator.onLine ? "ja" : "nein"], ["Speicher", store], ["Darstellung", isDark() ? "dunkel" : "hell"],
      ["Kamera", navigator.mediaDevices && navigator.mediaDevices.getUserMedia ? "verfügbar" : "nicht verfügbar"],
      ["Schlüssel", settings.apiKey ? "eingerichtet" : "fehlt"], ["Einträge im Fehlerprotokoll", String(readErrLog().length)],
    ];
    s.diagBusy = false; if (state.sheet === s) renderSheet();
  }
  // Copies a collection that is only left in this device's cache into the signed-in account,
  // including its photos (admins may read other folders in the photo storage).
  async function adminRestore(oldUid) {
    const s = state.sheet; if (!s || !oldUid || oldUid === uidNow()) return;
    const stage = t => { s.restoreStage = t; if (state.sheet === s) renderSheet(); };
    s.restoring = oldUid; stage("Lese Gerätekopie …");
    try {
      const d = await Cache.load(oldUid);
      const have = new Set(state.cards.map(c => c.id)), haveS = new Set(state.sessions.map(x => x.id)), haveH = new Set(state.history.map(x => x.id));
      const cards = d.cards.filter(c => !have.has(c.id)), sessions = d.sessions.filter(x => !haveS.has(x.id)), items = d.items, hist = d.history.filter(x => !haveH.has(x.id));
      stage(`Übernehme ${cards.length} Karten …`);
      await saveMany("cards", cards);
      await saveMany("sessions", sessions);
      if (items.length) await saveMany("items", items);
      if (hist.length) { await Store.putMany("history", hist); state.history.push(...hist); }
      // Photos: copy <old>/<id>.jpg to <new>/<id>.jpg (best effort; cards keep their thumbnails anyway).
      const ids = [...new Set([...cards, ...items].map(x => x.imageId).filter(Boolean))];
      let copied = 0;
      for (let i = 0; i < ids.length; i++) {
        if (i % 5 === 0) stage(`Fotos ${i}/${ids.length} …`);
        try { const r = await sb.storage.from(BUCKET).copy(`${oldUid}/${ids[i]}.jpg`, Img.path(ids[i])); if (!r.error) copied++; } catch (_) {}
      }
      state.open = state.sessions.filter(x => x.status === "open").sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0] || null;
      toast(`Wiederhergestellt: ${cards.length} Karten, ${sessions.length} Sessions, ${hist.length} Verlaufstage${ids.length ? `, ${copied} von ${ids.length} Fotos` : ""}.`, { duration: 8000 });
      scheduleSnapshot(); render();
    } catch (e) { logErr("Wiederherstellen", e); toast("Wiederherstellen hat nicht geklappt. Prüfe die Verbindung und versuch es erneut."); }
    s.restoring = null; s.restoreStage = null; s.local = null; if (state.sheet === s) renderSheet();
  }
  async function adminClearCache() {
    const s = state.sheet; if (!s) return;
    s.clearing = true; renderSheet();
    try {
      await Cache.clear(uidNow());
      tcgCache.clear(); state.setInfo.clear(); state.setPrices.clear();
      try { Object.keys(localStorage).filter(k => k.startsWith("ks-set2-")).forEach(k => localStorage.removeItem(k)); } catch (_) {}
      await loadAll(); render(); toast("Zwischenspeicher geleert, alles neu geladen.");
    } catch (e) { logErr("Wartung", e); toast("Neu laden hat nicht geklappt."); }
    s.clearing = false; if (state.sheet === s) renderSheet();
  }

  // ---------- sheets ----------
  function openSheet(s) { state.sheet = s; renderSheet(); }
  function closeSheet() {
    state.sheet = null; sheetDrag = null;
    const r = $("#sheetRoot"); r.dataset.key = ""; document.body.style.overflow = "";
    const sc = r.querySelector(".scrim:not(.leaving)");
    r.querySelectorAll(".scrim.leaving").forEach(x => x.remove());
    if (!sc || calm()) { r.innerHTML = ""; return; }
    // Slide the sheet down (from wherever a drag left it) and fade the dimming, then remove it.
    const sh = sc.querySelector(".sheet");
    if (sh) { const m = /translateY\(([-\d.]+)px\)/.exec(sh.style.transform || ""); sh.style.setProperty("--drag", (m ? m[1] : 0) + "px"); sh.removeAttribute("role"); }
    // The leaving copy is only a picture: no ids or actions, so nothing can find or trigger it.
    sc.removeAttribute("data-act"); sc.inert = true; sc.querySelectorAll("[id], [data-act]").forEach(e => { e.removeAttribute("id"); e.removeAttribute("data-act"); });
    sc.style.backgroundColor = ""; sc.classList.remove("still"); sc.classList.add("leaving");
    setTimeout(() => sc.remove(), 340);
  }

  // Drag a sheet down to close it, from the grabber/title or from anywhere while its content is scrolled to the top.
  let sheetDrag = null;
  function sheetDragStart(x, y, target, mouse) {
    const sh = target && target.closest && target.closest("#sheetRoot .sheet");
    if (!sh || sh.closest(".leaving") || calm()) return;
    const head = !!target.closest(".sheet-head");
    if (!head && (mouse || sh.scrollTop > 0 || target.closest("input, select, textarea"))) return;
    const sc = sh.parentElement, bg = getComputedStyle(sc).backgroundColor, a = /rgba?\([^)]*,\s*([\d.]+)\)/.exec(bg);
    sheetDrag = { sh, sc, head, x0: x, y0: y, off: 0, on: false, v: 0, ly: y, lt: performance.now(), alpha: a ? Number(a[1]) : 0.35 };
  }
  function sheetDragMove(x, y, ev) {
    const d = sheetDrag; if (!d) return;
    const dy = y - d.y0, dx = x - d.x0;
    if (!d.on) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) { sheetDrag = null; return; }
      if (dy < -4) { sheetDrag = null; return; }
      if (dy < 7) return;
      if (!d.head && d.sh.scrollTop > 0) { sheetDrag = null; return; }
      d.on = true; d.sh.classList.remove("snap"); d.sh.classList.add("dragging"); d.y0 = y - 1;
    }
    if (ev && ev.cancelable) ev.preventDefault();
    const raw = y - d.y0; d.off = raw > 0 ? raw : raw / 4;
    const now = performance.now(); d.v = (y - d.ly) / Math.max(1, now - d.lt); d.ly = y; d.lt = now;
    d.sh.style.transform = `translateY(${d.off}px)`;
    const k = Math.max(0, Math.min(1, d.off / Math.max(1, d.sh.offsetHeight)));
    d.sc.style.backgroundColor = `rgba(0,0,0,${(d.alpha * (1 - k)).toFixed(3)})`;
  }
  function sheetDragEnd() {
    const d = sheetDrag; sheetDrag = null; if (!d || !d.on) return;
    d.sh.classList.remove("dragging");
    if (d.off > Math.min(140, d.sh.offsetHeight * 0.3) || (d.v > 0.6 && d.off > 24)) { closeSheet(); return; }
    d.sh.classList.add("snap"); d.sh.style.transform = ""; d.sc.style.backgroundColor = "";
    setTimeout(() => d.sh.classList.remove("snap"), 460);
  }
  document.addEventListener("touchstart", e => { if (e.touches.length === 1) sheetDragStart(e.touches[0].clientX, e.touches[0].clientY, e.target, false); else sheetDrag = null; }, { passive: true });
  document.addEventListener("touchmove", e => { if (sheetDrag && e.touches.length === 1) sheetDragMove(e.touches[0].clientX, e.touches[0].clientY, e); }, { passive: false });
  document.addEventListener("touchend", sheetDragEnd, { passive: true });
  document.addEventListener("touchcancel", sheetDragEnd, { passive: true });
  document.addEventListener("pointerdown", e => { if (e.pointerType === "mouse") sheetDragStart(e.clientX, e.clientY, e.target, true); });
  document.addEventListener("pointermove", e => { if (e.pointerType === "mouse" && sheetDrag) sheetDragMove(e.clientX, e.clientY, e); });
  document.addEventListener("pointerup", e => { if (e.pointerType === "mouse") sheetDragEnd(); });

  function marketBox(c, s) {
    const m = c.market;
    const head = c.priceSource === "hand" ? "Dein Preis pro Karte" : c.priceSource === "markt" ? `Marktpreis${m && m.foil ? " (Reverse Holo)" : ""}` : "Geschätzter Wert";
    let inner = `<div class="eyebrow">${head} ${priceChip(c)}</div><div class="big">${money(c.priceEur)}</div>`;
    if (m && !tech()) {
      const cell = (k, v) => `<div><div class="k">${k}</div><div class="v">${v}</div></div>`;
      inner += `<div class="mgrid">${cell("Günstigstes Angebot", money(m.low))}${cell("Ø 30 Tage", money(m.avg30))}</div>
        <div class="fine">Stand ${esc(dOnly(m.updated || m.fetchedAt))}${m.ambiguous ? ' · <span class="bad-txt">bitte prüfen, ob die Karte stimmt</span>' : ""}</div>`;
    } else if (m) {
      const cell = (k, v) => `<div><div class="k">${k}</div><div class="v">${v}</div></div>`;
      inner += `<div class="mgrid">${cell("Trend", money(m.trend))}${cell("Ab", money(m.low))}${cell("Ø 1 Tag", money(m.avg1))}${cell("Ø 7 Tage", money(m.avg7))}${cell("Ø 30 Tage", money(m.avg30))}${m.usd != null ? cell("TCGplayer", usd(m.usd)) : ""}</div>
        <div class="fine">Stand ${esc(dOnly(m.updated || m.fetchedAt))} · Quelle: Cardmarket über TCGdex</div>
        <div class="fine">Zugeordnet: ${esc(m.matchName || "?")} · ${esc(m.matchSet || "?")} · Nr. <span class="mono">${esc(m.matchLocal || "?")}${m.matchOfficial ? "/" + esc(m.matchOfficial) : ""}</span>${m.ambiguous ? ' <span class="bad-txt">– mehrere Treffer, bitte prüfen</span>' : ""}</div>`;
    } else {
      inner += `<div class="fine">${c.priceSource === "hand" ? "Von dir eingetragen." : num(c.priceEur) !== null ? "Grob geschätzt, kein aktueller Marktpreis." : "Noch kein Preis."}${c.marketError ? " " + esc(c.marketError) : ""}</div>`;
    }
    const hist = cardHistory(c.id);
    if (hist.length >= 2) {
      const dv = hist[hist.length - 1].y - hist[0].y;
      inner += `<div class="spark"><div><div class="k">Preisverlauf seit ${esc(dOnly(hist[0].x))}</div><div class="v ${deltaCls(dv)}">${signed(dv)}${pct(dv, hist[0].y)}</div></div>${lineChart(hist, { w: 140, h: 40, compact: true, label: "Preisverlauf" })}</div>`;
    }
    return `<div class="pricebox">${inner}<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn small" type="button" data-act="refresh-card" data-id="${esc(c.id)}" ${s.refreshing ? "disabled" : ""}>${s.refreshing ? "Rufe Preis ab …" : "Preis aktualisieren"}</button><button class="btn small" type="button" data-act="search-card" data-id="${esc(c.id)}">Andere Karte wählen</button></div></div>`;
  }

  // Session total counts up, then lands with a little bounce, the cash sound and a burst of coins.
  function playDone(s) {
    if (s.played) return; s.played = true;
    const el = $("#sheetRoot .scrim:not(.leaving) .endbetrag .big"); if (!el || calm() || !(s.total > 0)) return;
    const dur = Math.min(1700, 700 + (s.count || 1) * 45), t0 = performance.now();
    el.classList.add("counting");
    const step = now => {
      if (!el.isConnected) return;
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = money(s.total * e);
      if (k < 1) { requestAnimationFrame(step); return; }
      el.textContent = money(s.total); el.classList.remove("counting"); el.classList.add("landed");
      cashSound(true); haptic("success");
      const box = el.parentElement.querySelector(".coins"); if (!box) return;
      const n = Math.min(26, 12 + Math.round(Math.log10(1 + s.total) * 5));
      box.innerHTML = Array.from({ length: n }, (_, i) => {
        const x = Math.round((Math.random() * 2 - 1) * 170), h = -Math.round(60 + Math.random() * 100), r = Math.round((Math.random() * 2 - 1) * 540);
        return `<i style="--x:${x}px;--h:${h}px;--r:${r}deg;--d:${Math.round(i * 22 + Math.random() * 60)}ms"><b></b></i>`;
      }).join("");
      setTimeout(() => { if (box.isConnected) box.innerHTML = ""; }, 2400);
    };
    requestAnimationFrame(step);
  }

  let rangeTimer;
  function renderSheet() {
    const s = state.sheet, root = $("#sheetRoot");
    if (!s) { root.innerHTML = ""; return; }
    document.body.style.overflow = "hidden";
    let title = "", body = "", dv = new Map();
    if (s.type === "finish") {
      const ok = openItems().filter(i => i.status === "ok");
      const total = sessionTotal(ok), count = ok.reduce((a, i) => a + (i.qty || 1), 0);
      const ki = ok.filter(i => i.card.priceSource !== "markt" && i.card.priceSource !== "hand").length;
      title = "Session abschließen";
      body = `<div class="stack">
        <div class="endbetrag"><div class="eyebrow">Endbetrag dieser Session</div><div class="big">${money(total)}</div><div>${count} Karte${count === 1 ? "" : "n"}</div></div>
        ${(dv = sessionDupes(), "")}<ul class="compact">${ok.map(i => swipeWrap(i.id, `<div class="cline swipe-fg"><span>${esc(i.card.name)}${(i.qty || 1) > 1 ? ` ×${i.qty}` : ""} <span class="muted">${esc([i.card.number, srcLabel(i.card)].filter(Boolean).join(" · "))}</span>${(dv.get(i.id) || {}).ses ? ' <span class="chip warn">doppelt</span>' : ""}</span><span class="mono">${money(num(i.card.priceEur) === null ? null : i.card.priceEur * (i.qty || 1))}</span><button class="icon-del" type="button" data-act="del-item" data-id="${esc(i.id)}" aria-label="${esc(i.card.name)} entfernen">${I.trash}</button></div>`)).join("")}</ul>
        <p class="fine" style="margin:0">Doppelt gescannt? Nach rechts wischen oder auf den Mülleimer tippen.</p>
        <p class="fine">Die Preise gelten für Karten in sehr gutem Zustand.${ki ? ` ${ki} Karte${ki === 1 ? " ist" : "n sind"} geschätzt.` : ""}${tech() ? " Grundlage: Cardmarket-Trend (Near Mint) über TCGdex." : ""}</p>
        <button class="btn primary block" type="button" data-act="commit" ${state.busy ? "disabled" : ""}>${state.busy ? "Wird übernommen …" : "Zum Inventar hinzufügen"}</button>
      </div>`;
    } else if (s.type === "done") {
      title = "Session abgeschlossen";
      body = `<div class="stack">
        <div class="endbetrag"><div class="coins" aria-hidden="true"></div><div class="eyebrow">Endbetrag</div><div class="big mono" aria-label="${esc(money(s.total))}">${money(s.played || calm() || !(s.total > 0) ? s.total : 0)}</div><div>${s.count} Karte${s.count === 1 ? "" : "n"} übernommen</div></div>
        <p class="muted" style="margin:0">${s.added} neu im Inventar${s.merged ? `, ${s.merged} zu vorhandenen Karten dazugezählt` : ""}.</p>
        <div class="actions"><button class="btn" type="button" data-act="close">Neue Session</button><button class="btn primary" type="button" data-act="goinv">Inventar ansehen</button></div>
      </div>`;
    } else if (s.type === "discard") {
      title = "Session verwerfen?";
      body = `<div class="stack"><p style="margin:0">Alle ${openItems().length} Scans dieser Session werden gelöscht. Dein Inventar bleibt unverändert.</p>
        <div class="actions"><button class="btn" type="button" data-act="close">Abbrechen</button><button class="btn danger" type="button" data-act="discard-yes">Verwerfen</button></div></div>`;
    } else if (s.type === "detail") {
      const c = state.cards.find(x => x.id === s.id);
      if (!c) { closeSheet(); return; }
      title = "Karte";
      const own = state.imgCache.get(c.imageId) || c.thumb;
      const off = officialImg(c, "high");
      const showOff = (s.img === "official" && off) || (!own && off);
      const big = showOff ? off : own;
      const totalVal = num(c.priceEur) === null ? null : c.priceEur * (c.qty || 1);
      const facts = [
        ["Set", [setNameOf(c), c.setCode ? `(${c.setCode})` : ""].filter(Boolean).join(" ")],
        ["Nummer", c.number ? `<span class="mono">${esc(c.number)}</span>` : null, true],
        ["Seltenheit", c.rarity], ["Variante", c.variant], ["Sprache", c.language ? langLabel(c.language) : null],
        ["Zustand", c.condition ? `${c.condition} · ${condLabel(c.condition)}` : null],
        ["Menge", String(c.qty || 1)], ["Wert gesamt", totalVal === null ? null : `<span class="mono">${money(totalVal)}</span>`, true],
        ["KI-Schätzung", !tech() || num(c.kiPriceEur) === null ? null : `<span class="mono">${money(c.kiPriceEur)}</span>`, true],
        ["Kartentyp", c.cardType], ["Typ", c.pokemonType], ["KP", c.hp ? String(c.hp) : null],
        ["Erkennung", !tech() || num(c.confidence) === null || c.confidence === 1 ? null : `${Math.round(c.confidence * 100)} % sicher`],
        ["Hinzugefügt", dt(c.addedAt)],
      ].filter(f => f[1]);
      const cmQuery = [(c.market && c.market.matchName) || c.nameEn || c.name, c.number ? String(c.number).split("/")[0] : ""].filter(Boolean).join(" ");
      body = `<div class="stack">
        <div class="bigimg">${big ? `<img id="bigImg" src="${esc(big)}" alt="${esc(c.name)}">` : ""}</div>
        ${own && off ? `<div class="imgswitch"><button type="button" data-act="img-own" aria-pressed="${!showOff}">Dein Foto</button><button type="button" data-act="img-off" aria-pressed="${!!showOff}">Offizielles Bild</button></div>` : ""}
        <div class="dtitle"><h2>${esc(c.name)}</h2><div class="sub">${subLine(c)}</div></div>
        ${marketBox(c, s)}
        <dl class="facts">${facts.map(f => `<dt>${f[0]}</dt><dd>${f[2] ? f[1] : esc(f[1])}</dd>`).join("")}</dl>
        <div class="actions">
          <button class="btn" type="button" data-act="edit-card" data-id="${esc(c.id)}">Bearbeiten</button>
          <a class="btn" href="https://www.cardmarket.com/de/Pokemon/Products/Search?searchString=${encodeURIComponent(cmQuery)}" target="_blank" rel="noopener">Auf Cardmarket ansehen</a>
          ${setIdOf(c) ? `<button class="btn" type="button" data-act="open-set" data-id="${esc(setIdOf(c))}">Set-Fortschritt</button>` : ""}
          <button class="btn danger" type="button" data-act="${s.confirmDelete ? "delete-yes" : "delete"}" data-id="${esc(c.id)}">${s.confirmDelete ? "Wirklich löschen?" : "Löschen"}</button>
        </div>
      </div>`;
      if (c.imageId && !state.imgCache.has(c.imageId)) {
        Img.url(c.imageId).then(u => {
          const el = $("#bigImg"); if (el && state.sheet && state.sheet.id === c.id && state.sheet.img !== "official") el.src = u;
        }).catch(() => {});
      }
    } else if (s.type === "edit") {
      const isItem = s.kind === "item";
      const src = isItem ? getItem(s.id) : state.cards.find(c => c.id === s.id);
      if (!src) { closeSheet(); return; }
      const c = isItem ? (src.card || {}) : src;
      title = isItem ? "Scan prüfen" : "Karte bearbeiten";
      const opt = (list, cur) => list.map(([v, l]) => `<option value="${v}" ${v === cur ? "selected" : ""}>${v} · ${l}</option>`).join("");
      body = `<form class="edit" id="editForm">
        <div class="full" style="display:flex;gap:12px;align-items:center"><div class="mini" style="width:64px">${imgTag(thumbOf(src.thumb, c), "Karte")}</div>
          <div class="stack" style="gap:6px;min-width:0"><div class="fine">Falsche Karte erkannt? Such die richtige, dann wird alles automatisch übernommen.</div>
          <button class="btn small" type="button" data-act="${isItem ? "search-item" : "search-card"}" data-id="${esc(src.id)}">${I.find}<span>Richtige Karte suchen</span></button></div></div>
        <label class="full">Name<input class="field" id="f-name" name="name" value="${esc(c.name || "")}" required></label>
        ${tech() ? `<label class="full">Englischer Name (für die Preissuche)<input class="field" id="f-nameEn" name="nameEn" value="${esc(c.nameEn || "")}" placeholder="z. B. Charizard ex"></label>` : `<input type="hidden" name="nameEn" value="${esc(c.nameEn || "")}">`}
        <label class="full">Set<input class="field" id="f-set" name="set" value="${esc(c.set || "")}"></label>
        ${tech() ? `<label>Set-Kürzel<input class="field" id="f-setCode" name="setCode" value="${esc(c.setCode || "")}"></label>` : `<input type="hidden" name="setCode" value="${esc(c.setCode || "")}">`}
        <label${tech() ? "" : ' class="full"'}>Nummer<input class="field" id="f-number" name="number" value="${esc(c.number || "")}" placeholder="025/165"></label>
        <label>Seltenheit<input class="field" id="f-rarity" name="rarity" value="${esc(c.rarity || "")}"></label>
        <label>Variante<input class="field" id="f-variant" name="variant" value="${esc(c.variant || "")}" list="variants"></label>
        <label>Sprache<select class="field" id="f-language" name="language"><option value="">–</option>${opt(LANGS, c.language)}</select></label>
        <label>Zustand<select class="field" id="f-condition" name="condition">${opt(CONDITIONS, c.condition || "NM")}</select></label>
        <label>Eigener Preis (€)<input class="field mono" id="f-price" name="priceEur" inputmode="decimal" value="${esc(priceInput(c.priceEur))}" placeholder="0,00"></label>
        <label>Menge<input class="field mono" id="f-qty" name="qty" type="number" min="1" max="999" value="${src.qty || 1}"></label>
        <datalist id="variants"><option value="Normal"><option value="Holo"><option value="Reverse Holo"><option value="1st Edition"><option value="Shadowless"><option value="Promo"></datalist>
        <p class="fine full" style="margin:0">Ein eigener Preis bleibt bei Aktualisierungen erhalten. Leer lassen, um wieder den Marktpreis zu nutzen.</p>
        <button class="btn primary full" type="submit">Speichern</button>
        ${isItem ? `<button class="btn danger full" type="button" data-act="del-item" data-id="${esc(src.id)}">${I.trash}<span>Aus Session entfernen</span></button>` : ""}
      </form>`;
    } else if (s.type === "search") {
      title = "Karte suchen";
      const langOpt = [["de", "Deutsch"], ["en", "Englisch"], ["fr", "Französisch"], ["it", "Italienisch"], ["es", "Spanisch"], ["ja", "Japanisch"]].map(([v, l]) => `<option value="${v}" ${v === s.lang ? "selected" : ""}>${l}</option>`).join("");
      let res = "";
      if (s.loading) res = `<div class="notice">Suche läuft …</div>`;
      else if (s.error) res = `<div class="banner">${esc(s.error)}</div>`;
      else if (s.results && !s.results.length) res = `<div class="empty">Keine Karte gefunden. Prüfe die Schreibweise oder stell die Sprache um (z. B. „Glurak“ auf Deutsch, „Charizard“ auf Englisch).</div>`;
      else if (s.results) res = `<ul class="results">${s.results.map((d, i) => {
        const b = d.id ? buildMarket(d, { variant: "Normal" }, s.lang, false) : {};
        const off = d.set && d.set.cardCount && d.set.cardCount.official;
        return `<li><button class="result" type="button" data-act="pick" data-idx="${i}"><div class="mini">${typeof d.image === "string" ? `<img src="${esc(d.image)}/low.webp" alt="" loading="lazy">` : ""}</div>
          <div style="min-width:0"><div class="nm">${esc(d.name)}</div><div class="sub">${esc((d.set && d.set.name) || d.id)} · <span class="mono">${esc(d.localId)}${off ? "/" + esc(off) : ""}</span></div>${d.rarity ? `<div class="chips"><span class="chip">${esc(d.rarity)}</span></div>` : ""}</div>
          <div class="px">${b.market ? money(b.market.trend ?? b.priceEur) : "–"}${b.market ? "" : "<small>kein Preis</small>"}</div></button></li>`;
      }).join("")}</ul>${s.more > 0 ? `<p class="fine">${s.more} weitere Treffer. Gib die Nummer an, um einzugrenzen.</p>` : ""}`;
      body = `<div class="stack"><form class="edit" id="searchForm">
        <label class="full">Kartenname<input class="field" id="s-q" name="q" value="${esc(s.q || "")}" placeholder="z. B. Glurak oder Charizard" autocomplete="off" required></label>
        <label>Nummer (optional)<input class="field mono" id="s-n" name="n" value="${esc(s.n || "")}" placeholder="136 oder 136/189"></label>
        <label>Sprache des Namens<select class="field" id="s-lang" name="lang">${langOpt}</select></label>
        <button class="btn primary full" type="submit">${I.find}<span>Suchen</span></button>
      </form>${res}</div>`;
    } else if (s.type === "set") {
      const info = state.setInfo.get(s.id);
      if (!info || info === "error") {
        ensureSets([s.id]);
        title = "Set";
        body = info === "error" ? `<div class="banner">Die Set-Daten ließen sich nicht laden. Prüfe deine Verbindung und versuch es erneut.</div><button class="btn" type="button" data-act="set-retry" data-id="${esc(s.id)}">Erneut versuchen</button>` : `<div class="notice">Set wird geladen …</div>`;
      } else {
        title = info.name;
        const owned = ownedInSet(s.id), p = setProgress(info, owned);
        const value = [...owned.values()].reduce((t, e) => t + e.value, 0);
        const f = s.filter || "missing", sort = settings.cardSort;
        const lo = s.min != null ? s.min : null, hi = s.max != null ? s.max : null;
        const priceMode = sort === "pdesc" || sort === "pasc" || lo !== null || hi !== null;
        const missing = info.cards.filter(c => !owned.has(c.id));
        const known = missing.filter(c => state.setPrices.has(c.id));
        const missSum = known.reduce((t, c) => t + (state.setPrices.get(c.id) || 0), 0);
        const busy = state.setPricesBusy && state.setPricesBusy.setId === s.id ? state.setPricesBusy : null;
        // Sorting or filtering by price needs the prices of the missing cards: load them once, automatically.
        if (priceMode && known.length < missing.length && !state.setPricesBusy && !s.autoLoaded) { s.autoLoaded = true; setTimeout(() => loadMissingPrices(s.id), 0); }
        let list = info.cards.filter(c => f === "all" || (f === "missing" ? !owned.has(c.id) : owned.has(c.id)));
        if (lo !== null || hi !== null) list = list.filter(c => { const pr = setCardPrice(c, owned); return pr !== null && (lo === null || pr >= lo) && (hi === null || pr <= hi); });
        const pv = c => setCardPrice(c, owned);
        const cmpNum = (a, b) => (isNum(a.localId) && isNum(b.localId)) ? Number(a.localId) - Number(b.localId) : a.localId.localeCompare(b.localId, "de", { numeric: true });
        list = list.slice().sort({
          num: cmpNum,
          pdesc: (a, b) => (pv(b) ?? -1) - (pv(a) ?? -1) || cmpNum(a, b),
          pasc: (a, b) => (pv(a) ?? 1e9) - (pv(b) ?? 1e9) || cmpNum(a, b),
          name: (a, b) => a.name.localeCompare(b.name, "de"),
        }[sort] || cmpNum);
        const listSum = list.reduce((t, c) => t + (pv(c) || 0), 0), listPriced = list.filter(c => pv(c) !== null).length;
        const tile = c => {
          const o = owned.get(c.id), price = pv(c);
          const im = c.image ? `<img src="${esc(c.image)}/low.webp" alt="" loading="lazy">` : `<span class="noimg">${esc(c.localId)}</span>`;
          const inner = `<div class="sart">${im}${o && o.qty > 1 ? `<span class="qty">×${o.qty}</span>` : ""}</div><div class="sinfo"><span class="mono">${esc(c.localId)}</span> ${esc(c.name)}${price != null ? `<b>${esc(money(price))}</b>` : ""}</div>`;
          return o ? `<button class="stile own" type="button" data-act="detail" data-id="${esc(o.cards[0].id)}">${inner}</button>`
                   : `<a class="stile miss" href="https://www.cardmarket.com/de/Pokemon/Products/Search?searchString=${encodeURIComponent((c.nameEn || c.name) + " " + c.localId)}" target="_blank" rel="noopener">${inner}</a>`;
        };
        const fmtIn = v => v === null ? "" : String(v).replace(".", ",");
        const presets = [[null, 1, "bis 1 €"], [1, 5, "1–5 €"], [5, 20, "5–20 €"], [20, null, "ab 20 €"]];
        body = `<div class="stack">
          <div class="pricebox">
            <div class="eyebrow">${esc([info.serie, info.releaseDate ? info.releaseDate.slice(0, 4) : null].filter(Boolean).join(" · ") || "Set")}${info.nameEn && info.nameEn !== info.name ? ` · ${esc(info.nameEn)}` : ""}</div>
            <div class="big">${p.main} / ${p.official}</div>
            <div class="prog big"><i style="width:${(p.pct * 100).toFixed(1)}%"></i></div>
            <div class="fine">${Math.floor(p.pct * 100)} % vollständig${p.secret ? ` · dazu ${p.secret} Secret Rare${p.secret === 1 ? "" : "s"}` : ""} · dein Wert ${money(value)}</div>
          </div>
          <div class="pricebox">
            <div class="eyebrow">Fehlende Karten: ${missing.length}</div>
            ${known.length ? `<div class="fine">Kosten zum Vervollständigen: etwa <strong>${money(missSum)}</strong>${known.length < missing.length ? ` (${known.length} von ${missing.length} Preisen geladen)` : ""}</div>` : `<div class="fine">Lade die Preise, um zu sehen, was die fehlenden Karten kosten.</div>`}
            ${known.length < missing.length ? `<div><button class="btn small" type="button" data-act="set-prices" data-id="${esc(s.id)}" ${state.setPricesBusy ? "disabled" : ""}>${busy ? `Lade Preise ${busy.done}/${busy.total} …` : `Preise der fehlenden Karten laden (${missing.length - known.length})`}</button></div>` : ""}
          </div>
          <div class="seg" role="group" aria-label="Anzeigen">
            ${[["missing", `Fehlend (${missing.length})`], ["owned", `Vorhanden (${owned.size})`], ["all", `Alle (${info.cards.length})`]].map(([k, l]) => `<button type="button" data-act="set-filter" data-f="${k}" aria-pressed="${f === k}">${l}</button>`).join("")}
          </div>
          <div class="filters">
            <label class="flbl">Sortieren<select class="field" id="cardSort">${[["num", "Nummer"], ["pdesc", "Preis: teuerste zuerst"], ["pasc", "Preis: günstigste zuerst"], ["name", "Name"]].map(([k, l]) => `<option value="${k}" ${k === sort ? "selected" : ""}>${l}</option>`).join("")}</select></label>
            <div class="flbl">Preis von – bis (€)
              <div class="range"><input class="field mono" id="pmin" inputmode="decimal" placeholder="von" value="${esc(fmtIn(lo))}" autocomplete="off"><span>–</span><input class="field mono" id="pmax" inputmode="decimal" placeholder="bis" value="${esc(fmtIn(hi))}" autocomplete="off"></div></div>
            <div class="presets">${presets.map(([a, b, l]) => `<button type="button" class="chipbtn" data-act="set-range" data-min="${a ?? ""}" data-max="${b ?? ""}" aria-pressed="${a === lo && b === hi}">${l}</button>`).join("")}${lo !== null || hi !== null ? `<button type="button" class="chipbtn" data-act="set-range" data-min="" data-max="">Alle Preise</button>` : ""}</div>
          </div>
          <div class="fine">${list.length} Karte${list.length === 1 ? "" : "n"}${listPriced ? ` · zusammen ${money(listSum)}${listPriced < list.length ? ` (${listPriced} mit Preis)` : ""}` : ""}${busy ? " · Preise werden geladen …" : ""}</div>
          ${list.length ? `<div class="sgrid">${list.map(tile).join("")}</div>` : `<div class="empty">${lo !== null || hi !== null ? (busy ? "Preise werden geladen …" : "Keine Karte in dieser Preisspanne.") : f === "missing" ? "Du hast alle Karten dieses Sets. Glückwunsch!" : "Keine Karten."}</div>`}
          <p class="fine" style="margin:0">Tippe auf eine fehlende Karte, um sie auf Cardmarket zu suchen.${tech() ? " Preise: Cardmarket-Trend (Normalversion). Gezählt werden Karten mit Marktpreis-Zuordnung, unabhängig von Sprache und Variante." : ""}</p>
        </div>`;
      }
    } else if (s.type === "login-email") {
      title = "Anmelde-E-Mail";
      if (s.done === "ok") body = `<div class="stack"><div class="notice ok-box">Erledigt. Du meldest dich ab jetzt mit <strong>${esc(shownUser())}</strong> an. In der Datenbank steht nur der Hash.</div><button class="btn primary block" type="button" data-act="close">Fertig</button></div>`;
      else if (s.done === "sql") body = `<div class="stack"><div class="notice">Supabase verlangt für E-Mail-Änderungen eine Bestätigungs-Mail, die an die Hash-Adresse nie ankommt. Führ diese zwei Befehle einmal im Supabase <strong>SQL Editor</strong> aus. Sie enthalten nur den Hash, nicht deine E-Mail.</div>
          <pre class="sqlbox" id="sqlbox">${esc(s.sql)}</pre><button class="btn" type="button" data-act="copy-sql">SQL kopieren</button>
          <p class="fine" style="margin:0">Dein Passwort ist bereits umgestellt. Nach dem SQL meldest du dich mit deiner E-Mail und demselben Passwort an.</p></div>`;
      else body = `<form class="edit" id="leForm" novalidate>
          <p class="fine full" style="margin:0">Die App speichert deine E-Mail nicht. Sie bildet daraus auf diesem Gerät einen Hash, und nur der steht in der Datenbank. Ein Passwort-Reset per Mail ist deshalb nicht möglich.</p>
          <label class="full">E-Mail-Adresse<input class="field" id="le-email" name="email" type="email" inputmode="email" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
          <label class="full">Aktuelles Passwort<input class="field" id="le-cur" name="cur" type="password" autocomplete="current-password" required></label>
          ${s.err ? `<div class="banner full">${esc(s.err)}</div>` : ""}
          <button class="btn primary full" type="submit" ${s.busy ? "disabled" : ""}>${s.busy ? "Einen Moment …" : "Umstellen"}</button>
        </form>`;
    } else if (s.type === "pw-change") {
      title = "Passwort ändern";
      body = `<form class="edit" id="pwForm" novalidate>
          <input type="email" name="username" autocomplete="username" value="${esc(shownUser())}" hidden>
          <label class="full">Aktuelles Passwort<input class="field" id="pw-cur" name="cur" type="password" autocomplete="current-password" required></label>
          <label class="full">Neues Passwort (mind. 8 Zeichen)<input class="field" id="pw-new" name="new" type="password" autocomplete="new-password" required></label>
          <label class="full">Neues Passwort wiederholen<input class="field" id="pw-new2" name="new2" type="password" autocomplete="new-password" required></label>
          ${s.err ? `<div class="banner full">${esc(s.err)}</div>` : ""}
          <button class="btn primary full" type="submit" ${s.busy ? "disabled" : ""}>${s.busy ? "Einen Moment …" : "Passwort ändern"}</button>
        </form>`;
    } else if (s.type === "settings") {
      title = "Einstellungen";
      const key = settings.apiKey, u = state.user;
      const sw = (act, on, label) => `<button class="cell" type="button" role="switch" aria-checked="${on}" data-act="${act}"><span>${label}</span><span class="switch" aria-hidden="true"></span></button>`;
      const link = (act, label, val) => `<button class="cell link" type="button" data-act="${act}"><span>${label}</span><span class="tail">${val ? `<span class="val">${esc(val)}</span>` : ""}<span class="chev"></span></span></button>`;
      const legacyLogin = u && !isEmailId(u.email);
      body = `<div class="stack settings">
        <section><h3 class="gh">Darstellung</h3>
          <div class="group pad"><div class="seg" role="group" aria-label="Darstellung">${[["auto", "Automatisch"], ["light", "Hell"], ["dark", "Dunkel"]].map(([k, l]) => `<button type="button" data-act="theme-set" data-theme="${k}" aria-pressed="${settings.theme === k}">${l}</button>`).join("")}</div></div></section>
        <section><h3 class="gh">Kamera</h3>
          <div class="group">${sw("set-auto", settings.auto, "Automatisch auslösen")}${sw("set-sound", settings.sound, "Kassen-Sound")}</div>
          <p class="gf">Die Kamera löst aus, sobald eine Karte ruhig im Rahmen liegt.</p></section>
        <section><h3 class="gh">Erkennung</h3>
          <div class="group">
            ${link("key-setup", "Schlüssel", key ? "Eingerichtet" : "Fehlt")}
            <label class="cell"><span>Modus</span><select class="cell-select" id="set-model">${MODELS.map(([v, l]) => `<option value="${v}" ${v === settings.model ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          </div>
          ${key ? "" : `<p class="gf">Ohne Schlüssel kannst du Karten über „Suchen“ hinzufügen.</p>`}</section>
        <section><h3 class="gh">Konto</h3>
          <div class="group">
            <div class="cell"><span>Angemeldet als</span><span class="val">${esc(shownUser())}</span></div>
            ${link("name", "Name", greetName() || "Nicht festgelegt")}
            ${legacyLogin || isAdmin() ? link("login-email", legacyLogin ? "Auf E-Mail-Anmeldung umstellen" : "E-Mail ändern") : ""}
            ${link("pw-change", "Passwort ändern")}
            ${sw("set-closelogout", settings.closeLogout, "Beim Schließen abmelden")}
            <label class="cell"><span>Automatisch abmelden</span><select class="cell-select" id="set-idle">${IDLE_OPTIONS.map(([v, l]) => `<option value="${v}" ${v === settings.idle ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          </div>
          <p class="gf">${settings.closeLogout ? "Nach dem Schließen der App musst du dich neu anmelden. " : ""}Ohne Aktivität wirst du nach der eingestellten Zeit abgemeldet, aber nie während eines Scans.</p></section>
        <section><h3 class="gh">Sicherung</h3>
          <div class="group">${link("export", "Backup speichern")}${link("import", "Backup laden")}</div>
          <p class="gf">Deine Sammlung ist in deinem Konto gespeichert. Ein Backup ist eine zusätzliche Kopie als Datei.</p></section>
        ${NATIVE ? `<section><h3 class="gh">App</h3>
          <div class="group"><div class="cell"><span>Version</span><span class="val">${app.build ? `Build ${app.build}` : "–"}</span></div>${app.update ? link("app-update", "Update laden", `Build ${app.update}`) : ""}</div>
          <p class="gf">${app.update ? "Eine neue Version ist da. Lade sie herunter und spiel sie über die alte App; deine Daten bleiben erhalten." : "Du hast die aktuelle Version."}</p></section>` : ""}
        ${isAdmin() ? `<section><h3 class="gh">Admin</h3><div class="group">${link("admin", "Admin-Bereich")}</div></section>` : ""}
        <div class="group"><button class="cell action danger center" type="button" data-act="logout">Abmelden</button></div>
        <p class="fine legal">Preise: Cardmarket über <a href="https://tcgdex.dev" target="_blank" rel="noopener">TCGdex</a>. Pokémon ist eine Marke von Nintendo, Creatures und GAME FREAK. Privates Fanprojekt.</p>
      </div>`;
    } else if (s.type === "welcome") {
      title = "Willkommen";
      body = `<div class="stack">
        <div class="dtitle"><h2>Willkommen${greetName() ? ", " + esc(greetName()) : ""}!</h2><div class="sub">So funktioniert der Kartenscanner:</div></div>
        <div class="steps"><div><b>Scannen</b>Halte eine Karte in den Rahmen, die App erkennt sie und zeigt ihren Wert.</div><div><b>Prüfen</b>Tippe eine Karte an, falls etwas nicht stimmt.</div><div><b>Abschließen</b>Du siehst den Gesamtwert und legst alles in dein Inventar.</div></div>
        ${settings.apiKey ? `<button class="btn primary block" type="button" data-act="close">Los geht's</button>` : `
        <div class="notice">Für die automatische Erkennung brauchst du einmalig einen eigenen Schlüssel. Das dauert etwa 5 Minuten. Bis dahin kannst du Karten über „Suchen“ hinzufügen.</div>
        <div class="actions"><button class="btn" type="button" data-act="close">Später</button><button class="btn primary" type="button" data-act="key-setup">Jetzt einrichten</button></div>`}
      </div>`;
    } else if (s.type === "key") {
      title = "Erkennung einrichten";
      const has = !!settings.apiKey;
      if (has && !s.edit) {
        body = `<div class="stack">
          <div class="notice ok-box">Die Erkennung ist eingerichtet. Du kannst Karten mit der Kamera scannen.</div>
          <div class="group"><button class="cell action" type="button" data-act="key-edit">Neuen Schlüssel eintragen</button><button class="cell action danger" type="button" data-act="key-del">Schlüssel entfernen</button></div>
          <p class="gf">Dein Guthaben und ein Ausgabelimit verwaltest du auf <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noopener">console.anthropic.com</a>.</p>
        </div>`;
      } else {
        body = `<div class="stack">
          <p style="margin:0">Die App erkennt Karten mit der KI <b>Claude</b> von Anthropic. Dafür brauchst du einen eigenen Schlüssel. Jeder Scan kostet dort meist nur wenige Cent von deinem Guthaben.</p>
          <div class="steps">
            <div><b>Konto anlegen</b>Öffne <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a> und registriere dich.</div>
            <div><b>Guthaben aufladen</b>Unter „Billing“ ein paar Euro aufladen. Tipp: Dort auch ein monatliches Limit festlegen.</div>
            <div><b>Schlüssel erstellen</b>Unter „API Keys“ auf „Create Key“ tippen und den Schlüssel kopieren.</div>
            <div><b>Hier einfügen</b>Schlüssel unten einfügen und speichern.</div>
          </div>
          <form class="edit" id="keyForm">
            <label class="full">Dein Schlüssel<input class="field mono" id="key-in" name="key" type="password" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="sk-ant-…" required></label>
            ${s.err ? `<div class="banner full">${esc(s.err)}</div>` : ""}
            <button class="btn primary full" type="submit" ${s.busy ? "disabled" : ""}>${s.busy ? "Wird geprüft …" : "Prüfen und speichern"}</button>
          </form>
          <p class="gf" style="margin:0">Der Schlüssel bleibt nur auf diesem Gerät und gehört zu deinem Konto.</p>
        </div>`;
      }
    } else if (s.type === "name") {
      title = "Name";
      body = `<form class="edit" id="nameForm">
        <label class="full">Wie sollen wir dich nennen?<input class="field" id="name-in" name="name" maxlength="40" autocomplete="nickname" value="${esc(greetName())}" required></label>
        ${s.err ? `<div class="banner full">${esc(s.err)}</div>` : ""}
        <button class="btn primary full" type="submit" ${s.busy ? "disabled" : ""}>Speichern</button>
      </form>`;
    } else if (s.type === "admin") {
      title = "Admin-Bereich";
      body = adminBody(s);
    }
    const prevSheet = root.querySelector(".scrim:not(.leaving) .sheet"), sheetKey = s.type + ":" + (s.id || "");
    const same = !!prevSheet && root.dataset.key === sheetKey;
    const keepScroll = prevSheet && root.dataset.key === sheetKey ? prevSheet.scrollTop : 0;
    const focused = document.activeElement && root.contains(document.activeElement) && document.activeElement.id ? document.activeElement.id : null;
    root.innerHTML = `<div class="scrim${same ? " still" : ""}" data-act="scrim"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-head"><h2>${esc(title)}</h2><button class="x" type="button" data-act="close" aria-label="Schließen">×</button></div>${body}</div></div>`;
    root.dataset.key = sheetKey;
    if (keepScroll) root.querySelector(".sheet").scrollTop = keepScroll;
    if (focused && (focused === "pmin" || focused === "pmax")) { const el = $("#" + focused); if (el) { el.focus(); const n = el.value.length; try { el.setSelectionRange(n, n); } catch (_) {} } }
    if (s.type === "done") playDone(s);
    const sm = $("#set-model"); if (sm) sm.onchange = () => { settings.model = sm.value; toast(sm.value === MODELS[0][0] ? "Modus: genau." : "Modus: schnell & günstig."); };
    const cs = $("#cardSort"); if (cs) cs.onchange = () => { settings.cardSort = cs.value; renderSheet(); };
    for (const idr of ["pmin", "pmax"]) { const el = $("#" + idr); if (el) el.oninput = () => { clearTimeout(rangeTimer); rangeTimer = setTimeout(() => { if (!state.sheet) return; state.sheet[idr === "pmin" ? "min" : "max"] = parsePrice(el.value); renderSheet(); }, 450); }; }
    const ef = $("#editForm"); if (ef) ef.onsubmit = e => { e.preventDefault(); saveEdit(ef); };
    const sf = $("#searchForm"); if (sf) sf.onsubmit = e => { e.preventDefault(); runSearch(sf); };
    const lf = $("#leForm"); if (lf) lf.onsubmit = e => { e.preventDefault(); setLoginEmail(new FormData(lf)); };
    const kf = $("#keyForm"); if (kf) kf.onsubmit = e => { e.preventDefault(); saveKey(String(new FormData(kf).get("key") || "")); };
    const nf = $("#nameForm"); if (nf) nf.onsubmit = e => { e.preventDefault(); saveName(String(new FormData(nf).get("name") || "")); };
    const apf = $("#adminPwForm"); if (apf) apf.onsubmit = e => { e.preventDefault(); adminSetPassword(String(new FormData(apf).get("pw") || "")); };
    const aqf = $("#adminPriceForm"); if (aqf) aqf.onsubmit = e => { e.preventDefault(); adminPriceTest(new FormData(aqf)); };
    const pf = $("#pwForm"); if (pf) pf.onsubmit = e => { e.preventDefault(); changePassword(new FormData(pf)); };
    const si = $("#set-idle"); if (si) si.onchange = () => { settings.idle = Number(si.value); markActive(true); toast(settings.idle ? `Automatische Abmeldung nach ${idleLabel()} ohne Aktivität.` : "Automatische Abmeldung ist aus."); };
    if (s.type === "admin") adminAfterRender(s);
  }

  // ---------- toast ----------
  let toastTimer, toastExpire = null;
  function toast(msg, opts = {}) {
    let t = $("#toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    if (toastExpire) { const f = toastExpire; toastExpire = null; f(); }
    t.textContent = ""; t.dataset.kind = opts.kind || "";
    const sp = document.createElement("span"); sp.textContent = msg; t.appendChild(sp);
    if (opts.action) {
      const b = document.createElement("button"); b.type = "button"; b.className = "toast-btn"; b.textContent = opts.action.label;
      b.onclick = ev => { ev.stopPropagation(); toastExpire = null; clearTimeout(toastTimer); t.hidden = true; opts.action.fn(); };
      t.appendChild(b);
    }
    toastExpire = opts.onExpire || null;
    t.hidden = false; clearTimeout(toastTimer);
    t.classList.remove("pop"); void t.offsetWidth; t.classList.add("pop");
    toastTimer = setTimeout(() => { t.hidden = true; if (toastExpire) { const f = toastExpire; toastExpire = null; f(); } }, opts.duration || 4800);
  }

  // ---------- delete scans (swipe right or trash button), with undo ----------
  async function removeWithUndo(id) {
    const it = getItem(id); if (!it) return;
    try { await remove("items", id); } catch (_) { render(); if (state.sheet) renderSheet(); return; }
    state.running.delete(id); state.stage.delete(id);
    render();
    const sh = state.sheet;
    if (sh) {
      if ((sh.type === "edit" && sh.id === id) || (sh.type === "finish" && !openItems().some(i => i.status === "ok"))) closeSheet();
      else renderSheet();
    }
    const name = (it.card && it.card.name) || "Scan";
    toast(`${name} entfernt`, {
      duration: 6000,
      action: { label: "Rückgängig", fn: async () => { try { await save("items", it); } catch (_) { return; } render(); if (state.sheet) renderSheet(); } },
      onExpire: () => { if (it.imageId && !getItem(id)) Img.del(it.imageId); },
    });
  }

  const SWIPE_ARM = 0.38; // share of the row width that arms the delete
  let sw = null, swallowClick = false;
  document.addEventListener("pointerdown", e => {
    const li = e.target.closest(".swipe[data-swipe-id]");
    if (!li || (e.pointerType === "mouse" && e.button !== 0) || e.target.closest("button, a, input, select")) return;
    const fg = li.querySelector(".swipe-fg"); if (!fg) return;
    sw = { li, fg, id: li.dataset.swipeId, x0: e.clientX, y0: e.clientY, dx: 0, active: false, armed: false, w: li.offsetWidth, pid: e.pointerId };
  });
  document.addEventListener("pointermove", e => {
    if (!sw || e.pointerId !== sw.pid) return;
    const dx = e.clientX - sw.x0, dy = e.clientY - sw.y0;
    if (!sw.active) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { sw = null; return; }
      if (dx > 10 && dx > Math.abs(dy) * 1.2) { sw.active = true; sw.li.classList.add("dragging"); try { sw.li.setPointerCapture(e.pointerId); } catch (_) {} }
      else return;
    }
    e.preventDefault();
    sw.dx = Math.max(0, dx);
    const p = Math.min(1, sw.dx / (sw.w * SWIPE_ARM));
    sw.fg.style.transform = `translateX(${sw.dx}px)`;
    sw.li.style.setProperty("--p", p.toFixed(3));
    const armed = p >= 1;
    if (armed !== sw.armed) { sw.armed = armed; sw.li.classList.toggle("armed", armed); if (armed) haptic("medium"); }
  }, { passive: false });
  function endSwipe(e) {
    if (!sw || (e && e.pointerId !== sw.pid)) return;
    const s = sw; sw = null;
    if (!s.active) return;
    swallowClick = true; setTimeout(() => { swallowClick = false; }, 350);
    s.li.classList.remove("dragging");
    if (s.armed && e.type !== "pointercancel") {
      s.li.style.height = s.li.offsetHeight + "px";
      s.li.classList.add("removing");
      s.fg.style.transform = `translateX(${s.w + 40}px)`;
      requestAnimationFrame(() => requestAnimationFrame(() => { s.li.style.height = "0px"; }));
      setTimeout(() => removeWithUndo(s.id), 340);
    } else {
      s.fg.style.transform = ""; s.li.style.setProperty("--p", "0"); s.li.classList.remove("armed");
    }
  }
  document.addEventListener("pointerup", endSwipe);
  document.addEventListener("pointercancel", endSwipe);

  // ---------- events ----------
  document.addEventListener("click", e => {
    if (swallowClick && e.target.closest(".swipe")) { e.preventDefault(); return; }
    const tabBtn = e.target.closest("[data-tab]");
    if (tabBtn) { state.tab = tabBtn.dataset.tab; closeSheet(); render(); window.scrollTo(0, 0); updateBar(); return; }
    const el = e.target.closest("[data-act]"); if (!el) return;
    const act = el.dataset.act, id = el.dataset.id;
    if (act === "scrim") { if (e.target === el) closeSheet(); return; }
    const it = id ? getItem(id) : null, card = id ? state.cards.find(c => c.id === id) : null;
    const searchFor = c => ({ q: (c && (c.name || "")) || "", n: (c && c.number) || "", lang: c && c.name && c.nameEn === c.name ? "en" : "de" });
    switch (act) {
      case "close": closeSheet(); break;
      case "settings": openSheet({ type: "settings" }); break;
      case "camera": openCamera(); break;
      case "gallery": $("#galIn").click(); break;
      case "manual": addManual(); break;
      case "cam-close": closeCamera(); render(); break;
      case "cam-shot": shoot(false); break;
      case "cam-auto": settings.auto = !settings.auto; updateCamTools(); frameState = "x"; setFrameState(""); toast(settings.auto ? "Automatisch scannen ist an." : "Automatisch scannen ist aus. Tippe auf den Auslöser."); break;
      case "cam-sound": settings.sound = !settings.sound; updateCamTools(); if (settings.sound) { audioUnlock(); cashSound(false); } break;
      case "retry": retryItem(id); break;
      case "remove": case "del-item": removeWithUndo(id); break;
      case "edit-item": openSheet({ type: "edit", kind: "item", id }); break;
      case "search-item": openSheet({ type: "search", target: { kind: "item", id }, ...searchFor(it && it.card) }); break;
      case "search-card": openSheet({ type: "search", target: { kind: "card", id }, ...searchFor(card) }); break;
      case "pick": pickResult(Number(el.dataset.idx)); break;
      case "finish": openSheet({ type: "finish" }); break;
      case "commit": audioUnlock(); commitSession(); break;
      case "discard": openSheet({ type: "discard" }); break;
      case "discard-yes": discardSession(); break;
      case "goinv": closeSheet(); state.tab = "inv"; render(); window.scrollTo(0, 0); break;
      case "detail": openSheet({ type: "detail", id }); break;
      case "img-own": state.sheet.img = "own"; renderSheet(); break;
      case "img-off": state.sheet.img = "official"; renderSheet(); break;
      case "edit-card": openSheet({ type: "edit", kind: "card", id }); break;
      case "refresh-card": refreshCard(id); break;
      case "refresh-all": refreshAll(); break;
      case "delete": state.sheet.confirmDelete = true; renderSheet(); break;
      case "delete-yes": deleteCard(id); break;
      case "key-setup": openSheet({ type: "key" }); break;
      case "key-edit": state.sheet.edit = true; state.sheet.err = null; renderSheet(); setTimeout(() => { const k = $("#key-in"); if (k) k.focus(); }, 50); break;
      case "name": openSheet({ type: "name" }); break;
      case "admin": openSheet({ type: "admin", tab: "users" }); adminLoadUsers(); break;
      case "admin-tab": state.sheet.tab = el.dataset.pane; state.sheet.sel = null; renderSheet(); break;
      case "admin-reload": adminLoadUsers(true); break;
      case "admin-user": Object.assign(state.sheet, { sel: id, confirmDel: false, msg: null, err: null }); renderSheet(); break;
      case "admin-back": Object.assign(state.sheet, { sel: null, msg: null, err: null }); renderSheet(); break;
      case "admin-block": adminBlock(id, true); break;
      case "admin-unblock": adminBlock(id, false); break;
      case "admin-delete": state.sheet.confirmDel = true; renderSheet(); break;
      case "admin-delete-yes": adminDelete(id); break;
      case "admin-conn": adminConn(); break;
      case "admin-scan": adminPickScan(); break;
      case "admin-clear-cache": adminClearCache(); break;
      case "admin-restore": adminRestore(id); break;
      case "admin-log-copy": { const t = readErrLog().map(x => `${new Date(x.t).toLocaleString("de-DE")} [${x.w}] ${x.m}`).join("\n"); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast("Protokoll kopiert."), () => toast("Kopieren ging nicht.")); break; }
      case "admin-log-clear": try { localStorage.removeItem(ERRLOG_KEY); } catch (_) {} renderSheet(); break;
      case "set-closelogout": haptic("light"); settings.closeLogout = !settings.closeLogout; el.setAttribute("aria-checked", String(settings.closeLogout)); break;
      case "set-tech": haptic("light"); settings.tech = !settings.tech; el.setAttribute("aria-checked", String(settings.tech)); render(); break;
      case "set-auto": haptic("light"); settings.auto = !settings.auto; el.setAttribute("aria-checked", String(settings.auto)); break;
      case "set-sound": haptic("light"); settings.sound = !settings.sound; el.setAttribute("aria-checked", String(settings.sound)); if (settings.sound) { audioUnlock(); cashSound(false); } break;
      case "app-update": window.open(RELEASE_PAGE, "_blank"); break;
      case "key-del": settings.apiKey = ""; toast("Schlüssel entfernt."); if (state.sheet) { state.sheet.edit = false; renderSheet(); } render(); break;
      case "export": exportData(); break;
      case "auth-mode": state.authMode = el.dataset.mode; state.authErr = null; state.authMsg = null; render(); break;
      case "logout": closeSheet(); dropDeviceCopy(); sb.auth.signOut({ scope: "local" }).catch(() => {}); break;
      case "migrate": migrateLegacy(); break;
      case "theme-set": setTheme(el.dataset.theme); break;
      case "login-email": openSheet({ type: "login-email" }); break;
      case "pw-change": openSheet({ type: "pw-change" }); break;
      case "copy-sql": { const t = state.sheet && state.sheet.sql; if (t && navigator.clipboard) navigator.clipboard.writeText(t).then(() => toast("SQL kopiert."), () => toast("Kopieren ging nicht. Markiere den Text und kopier ihn von Hand.")); break; }
      case "open-set": openSheet({ type: "set", id, filter: "missing" }); break;
      case "set-filter": state.sheet.filter = el.dataset.f; renderSheet(); break;
      case "set-range": state.sheet.min = el.dataset.min === "" ? null : Number(el.dataset.min); state.sheet.max = el.dataset.max === "" ? null : Number(el.dataset.max); renderSheet(); break;
      case "set-prices": loadMissingPrices(id); break;
      case "set-retry": state.setInfo.delete(id); try { localStorage.removeItem("ks-set2-" + id); localStorage.removeItem("ks-set-" + id); } catch (_) {} renderSheet(); break;
      case "import": $("#importIn").click(); break;
    }
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { if (!$("#camera").hidden) { closeCamera(); render(); } else if (state.sheet) closeSheet(); }
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("[role=button][data-act]")) { e.preventDefault(); e.target.click(); }
  });
  $("#camFallback").addEventListener("change", e => { handleFiles(e.target.files); e.target.value = ""; });
  $("#galIn").addEventListener("change", e => { handleFiles(e.target.files); e.target.value = ""; });
  $("#importIn").addEventListener("change", e => { const f = e.target.files && e.target.files[0]; if (f) importData(f); e.target.value = ""; });
  let searchTimer;
  $("#invSearch").addEventListener("input", e => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.search = e.target.value; renderInv(); }, 120); });
  $("#invSort").value = state.sort;
  $("#invSort").addEventListener("change", e => { state.sort = e.target.value; settings.sort = state.sort; renderInv(); });

  // ---------- appearance (light / dark / automatic) ----------
  const darkMQ = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const isDark = () => settings.theme === "dark" || (settings.theme === "auto" && !!(darkMQ && darkMQ.matches));
  function applyTheme() {
    const t = settings.theme;
    if (t === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", t);
    const dark = isDark();
    document.querySelectorAll('meta[name="theme-color"]').forEach(m => { m.setAttribute("content", dark ? "#0B0D1A" : "#F6F4EF"); m.removeAttribute("media"); });
    if (!camOpen()) statusBar(dark);
  }
  function setTheme(t) { settings.theme = t; applyTheme(); if (state.sheet && state.sheet.type === "settings") renderSheet(); }
  if (darkMQ) { const onChange = () => { if (settings.theme === "auto") applyTheme(); }; darkMQ.addEventListener ? darkMQ.addEventListener("change", onChange) : darkMQ.addListener(onChange); }
  applyTheme();
  // Hairline under the navigation bar once the page scrolls, like iOS.
  // The large title scrolls under the bar; once it is mostly hidden, the small title fades in at the centre.
  // Pulling down past the top stretches the large title slightly, like iOS.
  function updateBar() {
    const t = $("#topbar"), b = $("#brand"); if (!t || !b) return;
    if (b.hidden) { t.classList.remove("scrolled", "titled"); return; }
    const barBottom = t.getBoundingClientRect().bottom, r = b.getBoundingClientRect(), h1 = b.firstElementChild.getBoundingClientRect();
    t.classList.toggle("scrolled", r.top < barBottom - 1);
    t.classList.toggle("titled", h1.top + h1.height * 0.7 < barBottom);
    const y = window.scrollY; b.style.transform = y < 0 ? `scale(${(1 + Math.min(-y, 120) / 600).toFixed(3)})` : "";
  }
  window.addEventListener("scroll", updateBar, { passive: true });
  window.addEventListener("resize", updateBar);
  // Lets :active press states show on iOS.
  document.addEventListener("touchstart", () => {}, { passive: true });

  // ---------- boot ----------
  const SYNC_MARGIN = 10 * 60e3;            // tolerate clock differences between devices
  const FULL_SYNC_EVERY = 24 * 3600e3;      // complete re-download once a day as a safety net
  function applyLists(d) {
    state.cards = d.cards; state.sessions = d.sessions; state.items = d.items; state.history = d.history || [];
    state.open = state.sessions.filter(x => x.status === "open").sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0] || null;
  }
  // Start from the copy on this device (instant), then fetch only what changed on the server.
  function dropCached(uid, t, gone, serverCount) {
    if (!gone.length) return;
    if (KSSync.suspiciousLoss(gone.length, serverCount)) { logErr("Abgleich", `Server meldet ${serverCount} Einträge in ${t}, ${gone.length} bleiben auf dem Gerät`); return; }
    Cache.del(uid, t, gone);
  }
  let syncing = null;
  function loadAll() { return syncing || (syncing = loadAllNow().finally(() => { syncing = null; })); }
  async function loadAllNow() {
    const uid = uidNow(); if (!uid) return;
    let meta = await Cache.getMeta(uid);
    if (!state.loaded && meta) {
      try { applyLists(await Cache.load(uid)); state.loaded = true; state.fromCache = true; render(); } catch (_) { meta = null; }
    }
    const full = !meta || !state.loaded || Date.now() - (meta.full || 0) > FULL_SYNC_EVERY;
    const lists = { cards: state.cards, sessions: state.sessions, items: state.items, history: state.history };
    const nextMeta = { ...(meta || {}), since: { ...((meta && meta.since) || {}) } };
    await Promise.all(["cards", "sessions", "items", "history"].map(async t => {
      try {
        let since = !full && nextMeta.since[t] ? new Date(Date.parse(nextMeta.since[t]) - SYNC_MARGIN).toISOString() : null;
        const [{ rows, max }, ids] = await Promise.all([Store.since(t, since), since ? Store.ids(t) : Promise.resolve(null)]);
        const { list, gone } = KSSync.mergeDelta(lists[t], rows, since ? ids : null);
        if (rows.length) Cache.put(uid, t, rows);
        dropCached(uid, t, gone, since ? ids.length : rows.length);
        lists[t] = list;
        if (max) nextMeta.since[t] = max > (nextMeta.since[t] || "") ? max : nextMeta.since[t];
        if (t === "history") state.historyOk = true;
      } catch (e) {
        if (t === "history" && isMissingTable(e)) { state.historyOk = false; lists.history = []; return; }
        throw e;
      }
    }));
    if (full) nextMeta.full = Date.now();
    applyLists(lists);
    await Cache.setMeta(uid, nextMeta);
    state.fromCache = false;
    // Scans left half-done (app closed mid-recognition) can't finish any more.
    const stale = state.items.filter(it => it.status === "pending" && !state.running.has(it.id) && Date.now() - (it.createdAt || 0) > 3 * 60e3)
      .map(it => ({ ...it, status: it.card ? "ok" : "error", error: it.card ? null : "Die Erkennung wurde unterbrochen. Tippe auf „Erneut erkennen“." }));
    if (stale.length) await saveMany("items", stale).catch(() => {});
    state.loaded = true; state.lastSync = Date.now();
  }
  // Profile from the server: name, admin, blocked. Works without it if the database is not updated yet.
  async function loadProfile(name) {
    try {
      const { data, error } = await sb.rpc("me", { p_name: name || state.pendingName || null });
      state.pendingName = null;
      if (error) throw error;
      state.me = data || null;
    } catch (e) { logErr("Profil", e); state.me = state.me || { admin: false, blocked: false, name: null, missing: true }; }
    if (state.me && state.me.blocked) {
      state.authErr = "Dein Konto ist gesperrt. Wende dich an den Admin der App.";
      await sb.auth.signOut().catch(() => {});
      return false;
    }
    return true;
  }
  // First visit of a new account: a short welcome with the next step.
  function maybeWelcome() {
    const k = "ks-welcomed:" + (state.user && state.user.id);
    let seen = false; try { seen = !!localStorage.getItem(k); } catch (_) {}
    if (seen) return;
    try { localStorage.setItem(k, "1"); } catch (_) {}
    if (state.cards.length || state.sessions.length || state.sheet) return;
    openSheet({ type: "welcome" });
  }
  const greetName = () => (state.me && state.me.name) || "";

  function clearData() {
    state.cards = []; state.sessions = []; state.items = []; state.history = []; state.open = null; state.loaded = false; state.fromCache = false;
    state.imgCache.forEach(u => { try { URL.revokeObjectURL(u); } catch (_) {} }); state.imgCache.clear();
  }
  async function onAuth(event, session) {
    state.authReady = true;
    if (event === "PASSWORD_RECOVERY") { state.recovery = true; state.authErr = null; state.authMsg = null; }
    const user = session ? session.user : null;
    // Start of the app with a stored login: decide once whether it may be resumed. This must not depend on
    // the event name: Supabase reports a restored login as SIGNED_IN or TOKEN_REFRESHED before INITIAL_SESSION.
    const firstEvent = !startupChecked; startupChecked = true;
    if (user && firstEvent && !state.authBusy) {
      if (settings.closeLogout && freshStart) { idleLogout("close"); return; }
      if (idleExpired()) { idleLogout(); return; }
    }
    if (!user) { state.user = null; state.me = null; window.__ksUid = null; state.recovery = false; clearData(); render(); return; }
    if (state.user && state.user.id === user.id) { state.user = user; render(); return; }
    markActive(true);
    window.__ksUid = user.id;
    // Older versions kept one key per device: it now belongs to the first account that signs in here.
    try { const old = localStorage.getItem("ks-apikey"); if (old) { if (!settings.apiKey) settings.apiKey = old; localStorage.removeItem("ks-apikey"); } } catch (_) {}
    state.user = user; state.me = null; clearData(); state.authErr = null; render();
    if (!(await loadProfile())) return;
    try { await loadAll(); } catch (e) { toast(state.loaded ? "Keine Verbindung. Du siehst den zuletzt geladenen Stand." : "Deine Daten ließen sich nicht laden. Prüfe deine Verbindung."); state.loaded = true; }
    render();
    maybeAutoRefresh();
    maybeWelcome();
    const L = await Legacy.read();
    state.legacy = L && ((L.cards || []).length || (L.sessions || []).length || (L.items || []).length) ? L : null;
    render();
  }

  // ---------- automatic logout after inactivity ----------
  // The last activity time is kept in localStorage, so it also counts while the app was closed or in the background.
  const IDLE_OPTIONS = [[0, "Nie"], [5, "5 Minuten"], [15, "15 Minuten"], [30, "30 Minuten"], [60, "1 Stunde"]];
  const IDLE_WARN = 30e3;
  const idleLabel = () => (IDLE_OPTIONS.find(o => o[0] === settings.idle) || [0, settings.idle + " Minuten"])[1];
  let lastActive = Date.now(), lastActiveSaved = 0, idleWarned = false;
  try { lastActive = Number(localStorage.getItem("ks-active")) || Date.now(); } catch (_) {}
  function markActive(force) {
    lastActive = Date.now();
    if (idleWarned) { idleWarned = false; const t = $("#toast"); if (t && t.dataset.kind === "idle") t.hidden = true; }
    if (force || lastActive - lastActiveSaved > 5000) { lastActiveSaved = lastActive; try { localStorage.setItem("ks-active", String(lastActive)); } catch (_) {} }
  }
  const camLive = () => camOpen() && !document.hidden && stream.getTracks().some(t => t.readyState === "live");
  const appBusy = () => camLive() || state.running.size > 0 || !!state.refreshing || !!state.migrating || state.busy || !!state.setPricesBusy || state.authBusy;
  const idleExpired = () => { if (!settings.idle) return false; let t = lastActive; try { t = Math.max(t, Number(localStorage.getItem("ks-active")) || 0); } catch (_) {} return Date.now() - t >= settings.idle * 60e3; };
  // "Closed" = this page was started fresh (sessionStorage is empty after the app was closed or removed from
  // memory; it survives reloads and switching apps).
  let startupChecked = false, freshStart = true;
  try { freshStart = !sessionStorage.getItem("ks-open"); sessionStorage.setItem("ks-open", "1"); } catch (_) {}
  async function idleLogout(reason) {
    if (camOpen()) closeCamera();
    closeSheet();
    idleWarned = false;
    const t = $("#toast"); if (t && t.dataset.kind === "idle") t.hidden = true;
    const label = idleLabel();
    state.authMode = "login"; state.authErr = null;
    dropDeviceCopy();
    try { await sb.auth.signOut({ scope: "local" }); } catch (_) {}
    state.user = null; clearData();
    state.authMsg = reason === "close" ? "Du wurdest abgemeldet, weil die App geschlossen wurde." : `Du wurdest nach ${label} ohne Aktivität abgemeldet.`;
    render();
  }
  function idleCheck() {
    if (!sb || !state.user || state.recovery || !settings.idle) return;
    if (appBusy()) { markActive(); return; }
    const limit = settings.idle * 60e3, idle = Date.now() - lastActive;
    if (idleExpired()) { idleLogout(); return; }
    if (idle >= limit - IDLE_WARN && !idleWarned) {
      idleWarned = true;
      toast(`Du wirst in ${Math.max(1, Math.round((limit - idle) / 1000))} Sekunden wegen Inaktivität abgemeldet.`, { duration: IDLE_WARN + 2000, kind: "idle", action: { label: "Angemeldet bleiben", fn: () => markActive(true) } });
    }
  }
  for (const ev of ["pointerdown", "keydown", "wheel", "touchstart"]) document.addEventListener(ev, () => markActive(), { capture: true, passive: true });
  document.addEventListener("scroll", () => markActive(), { capture: true, passive: true });
  // Coming back to the app (unlocked phone, switched apps, restored page): decide on the stored time
  // before anything still marked as running can count as activity.
  function onReturn() { if (!sb || !state.user || state.recovery || !settings.idle) return; if (idleExpired()) idleLogout(); else idleCheck(); }
  document.addEventListener("visibilitychange", () => { if (document.hidden) { try { localStorage.setItem("ks-active", String(lastActive)); } catch (_) {} } else onReturn(); });
  window.addEventListener("pageshow", onReturn);
  window.addEventListener("focus", onReturn);
  setInterval(idleCheck, 5000);

  render();
  if (!window.supabase || !CFG.supabaseUrl || !CFG.supabaseKey) {
    state.problem = "Die Verbindung zur Datenbank fehlt. Trag die Supabase-Adresse und den Schlüssel in config.js ein (siehe README).";
    render();
  } else {
    sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    // Supabase advises against awaiting other Supabase calls inside this callback, hence the timeout.
    sb.auth.onAuthStateChange((event, session) => { setTimeout(() => onAuth(event, session), 0); });
    // Pick up changes made on another device when the app comes back to the foreground.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden || !state.user || state.recovery || state.busy || state.running.size || state.sheet || camOpen()) return;
      if (Date.now() - state.lastSync < 30e3) return;
      loadAll().then(render).catch(() => {});
    });
  }

  if (NATIVE) {
    requestAnimationFrame(() => requestAnimationFrame(() => { const sp = plug("SplashScreen"); if (sp) try { quiet(sp.hide({ fadeOutDuration: 0 })); } catch (_) {} }));
    setTimeout(checkAppUpdate, 2500);
  }
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
