/* Pokémon Kartenscanner – standalone web app (GitHub Pages).
 * Storage: IndexedDB in the phone's browser.
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
  const MODELS = [["claude-sonnet-5-5", "Claude Sonnet 5.5 (genauer)"], ["claude-haiku-5-5", "Claude Haiku 5.5 (günstiger, schneller)"]];
  const condLabel = c => (CONDITIONS.find(x => x[0] === c) || [c, c || "–"])[1];
  const langLabel = c => (LANGS.find(x => x[0] === c) || [c, c || "–"])[1];

  // ---------- settings (localStorage) ----------
  const settings = (() => {
    const read = (k, d) => { try { const v = localStorage.getItem("ks-" + k); return v === null ? d : v; } catch (_) { return d; } };
    const write = (k, v) => { try { if (v === null || v === "") localStorage.removeItem("ks-" + k); else localStorage.setItem("ks-" + k, v); } catch (_) {} };
    return {
      get apiKey() { return read("apikey", ""); }, set apiKey(v) { write("apikey", v); },
      get model() { return read("model", MODELS[0][0]); }, set model(v) { write("model", v); },
      get sort() { return read("sort", "value"); }, set sort(v) { write("sort", v); },
      get sound() { return read("sound", "1") === "1"; }, set sound(v) { write("sound", v ? "1" : "0"); },
      get auto() { return read("auto", "1") === "1"; }, set auto(v) { write("auto", v ? "1" : "0"); },
      get setSort() { return read("setsort", "progress"); }, set setSort(v) { write("setsort", v); },
      get cardSort() { return read("cardsort", "num"); }, set cardSort(v) { write("cardsort", v); },
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

  const Store = {
    async all(t) {
      const out = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from(t).select("id,data").range(from, from + 999);
        if (error) throw error;
        out.push(...data.map(r => ({ ...r.data, id: r.id })));
        if (data.length < 1000) break;
      }
      return out;
    },
    async put(t, obj) {
      const { id, ...rest } = obj;
      const { error } = await sb.from(t).upsert({ id, data: rest, updated_at: new Date().toISOString() });
      if (error) throw error;
    },
    async del(t, id) { const { error } = await sb.from(t).delete().eq("id", id); if (error) throw error; },
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
  };

  async function save(store, obj) {
    if (store === "cards") scheduleSnapshot();
    try { await Store.put(store, clone(obj)); }
    catch (e) { toast("Speichern fehlgeschlagen. Prüfe deine Internetverbindung."); throw e; }
    const list = store === "cards" ? state.cards : store === "sessions" ? state.sessions : store === "items" ? state.items : null;
    if (list) { const i = list.findIndex(x => x.id === obj.id); if (i >= 0) list[i] = obj; else list.push(obj); }
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

  async function identify(blob) {
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
    return extractJSON((j.content || []).filter(b => b.type === "text").map(b => b.text).join("\n"));
  }
  function aiMsg(e) {
    if (!e) return "Die Erkennung ist fehlgeschlagen.";
    if (e.code === "no_key") return "Kein API-Schlüssel eingetragen. Trag ihn in den Einstellungen ein oder such die Karte von Hand.";
    if (e.code === "network") return "Keine Verbindung zur Erkennung. Prüfe dein Internet.";
    if (e.code === "bad_json") return "Die Antwort der Erkennung war unvollständig. Tippe auf „Erneut erkennen“.";
    if (e.code === "http") {
      if (e.status === 401) return "Der API-Schlüssel ist ungültig. Prüfe ihn in den Einstellungen.";
      if (e.status === 403) return "Der API-Schlüssel hat keine Berechtigung für dieses Modell.";
      if (e.status === 400 && /credit|balance/i.test(e.message)) return "Dein API-Guthaben ist aufgebraucht. Lade es in der Anthropic Console auf.";
      if (e.status === 429) return "Zu viele Anfragen. Warte kurz und versuch es erneut.";
      if (e.status === 529 || e.status >= 500) return "Die Erkennung ist gerade überlastet. Versuch es gleich erneut.";
      return "Erkennung abgelehnt (" + e.status + "): " + String(e.message || "").slice(0, 120);
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
  const tcgCache = new Map();
  async function tcgFetch(url, fresh) {
    const hit = tcgCache.get(url);
    if (!fresh && hit && Date.now() - hit.t < 30 * 60e3) return hit.v;
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
    if (e && e.code === "tcg_network") { state.marketDown = "Die Preisdatenbank TCGdex ist nicht erreichbar. Prüfe dein Internet."; return state.marketDown; }
    if (e && e.code === "tcg_http") return "Die Preisdatenbank antwortet gerade nicht (" + e.status + "). Versuch es später erneut.";
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
      if (!briefs.length) return { error: "Karte nicht in der Preisdatenbank gefunden. Prüfe Name und Nummer oder such sie von Hand." };
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
      let merged = 0, added = 0;
      for (const it of ok) {
        const ex = state.cards.find(c => cardKey(c) === cardKey(it.card));
        const qty = it.qty || 1;
        if (ex) {
          const upd = { ...ex, qty: (ex.qty || 1) + qty };
          if (ex.priceSource !== "hand" && num(it.card.priceEur) !== null) Object.assign(upd, { priceEur: it.card.priceEur, priceSource: it.card.priceSource, priceDate: it.card.priceDate, market: it.card.market || null, marketError: it.card.marketError || null });
          await save("cards", upd);
          if (it.imageId && it.imageId !== ex.imageId) await Img.del(it.imageId);
          merged++;
        } else {
          await save("cards", { id: it.id, ...it.card, qty, thumb: it.thumb || null, imageId: it.imageId || null, addedAt: Date.now(), sessionId: sess.id });
          added++;
        }
      }
      const summary = ok.map(i => ({ name: i.card.name, set: i.card.set || null, number: i.card.number || null, qty: i.qty || 1, priceEur: num(i.card.priceEur), priceSource: i.card.priceSource || null }));
      const total = r2(sessionTotal(ok)) || 0;
      const count = ok.reduce((s, i) => s + (i.qty || 1), 0);
      await save("sessions", { ...sess, status: "done", finishedAt: Date.now(), total, count, summary });
      for (const it of all) { await remove("items", it.id); if (it.status !== "ok" && it.imageId) await Img.del(it.imageId); }
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
    for (const it of openItems()) { await remove("items", it.id); if (it.imageId) await Img.del(it.imageId); }
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
  async function refreshAll(opts = {}) {
    if (state.refreshing || !state.cards.length) return;
    const cards = state.cards.slice();
    state.refreshing = { done: 0, total: cards.length, failed: 0 }; renderInv();
    let failed = 0, saveErrors = 0; const total = cards.length;
    try {
      for (const c of cards) {
        if (!state.user) break; // logged out meanwhile
        const res = await lookupMarket(c, { fresh: true });
        const cur = state.cards.find(x => x.id === c.id);
        if (cur) { try { await save("cards", { ...applyMarket(cur, res), id: c.id }); } catch (_) { saveErrors++; } }
        if (state.refreshing) state.refreshing.done++;
        if (!res.market) failed++;
        render();
        if (state.marketDown || saveErrors >= 3) break;
        await sleep(120);
      }
    } finally { state.refreshing = null; render(); }
    if (saveErrors) toast("Preise konnten nicht gespeichert werden. Prüfe deine Internetverbindung.");
    else if (!opts.silent || state.marketDown) toast(state.marketDown || (failed ? `Preise aktualisiert. ${failed} von ${total} ohne Marktpreis.` : "Alle Preise aktualisiert."));
    scheduleSnapshot();
  }
  async function testConnections() {
    state.test = { running: true }; render();
    const out = [];
    try {
      const d = await tcgFetch(detailUrl("en", "swsh3-136"), true);
      const m = d && buildMarket(d, { variant: "Normal" }, "en", false);
      out.push(d ? { ok: true, msg: `Preisdatenbank erreichbar: ${d.name} (${(d.set && d.set.name) || "?"}) kostet aktuell ${m && m.market ? money(m.market.trend ?? m.priceEur) : "–"} (Cardmarket-Trend).` } : { ok: false, msg: "Preisdatenbank antwortet, aber ohne Kartendaten." });
    } catch (e) { out.push({ ok: false, msg: tcgMsg(e) }); }
    if (!settings.apiKey) out.push({ ok: false, msg: "Kein API-Schlüssel eingetragen: Erkennung per Foto ist aus, die manuelle Suche funktioniert." });
    else {
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": settings.apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }, body: JSON.stringify({ model: settings.model, max_tokens: 5, messages: [{ role: "user", content: "Antworte nur mit OK." }] }) });
        if (res.ok) out.push({ ok: true, msg: "API-Schlüssel funktioniert, Erkennung ist bereit." });
        else { let message = ""; try { message = ((await res.json()).error || {}).message || ""; } catch (_) {} out.push({ ok: false, msg: aiMsg({ code: "http", status: res.status, message }) }); }
      } catch (e) { out.push({ ok: false, msg: aiMsg({ code: "network" }) }); }
    }
    state.test = { results: out }; render();
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
    for (const k of ["cards", "sessions", "items"]) for (const v of (data[k] || [])) { if (v && v.id) await Store.put(k, v); tick(); }
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
    } catch (e) { toast("Die Datei ist kein gültiges Kartenscanner-Backup."); }
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
  const dupChips = d => !d ? "" : (d.ses ? '<span class="chip warn">Doppelt gescannt</span>' : "") + (d.inv ? `<span class="chip own">Schon ${d.inv}× im Inventar</span>` : "");

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
    $("#camera").hidden = false;
    camShots = 0; prevG = null; lastG = null; stableSince = performance.now(); lastShot = performance.now(); frameState = "x";
    $("#camFeed").innerHTML = ""; $("#camPrice").classList.remove("on");
    updateCamTools(); setFrameState(""); updateCamSum();
    try { await v.play(); } catch (_) {}
    clearInterval(camTimer); camTimer = setInterval(camTick, AUTO.TICK);
  }
  function closeCamera() {
    clearInterval(camTimer); camTimer = null;
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null; $("#camera").hidden = true; $("#camVideo").srcObject = null;
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
      if (d.ses) dupSound(); else if (price !== null) cashSound(price >= BIG_PRICE);
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
  const srcLabel = c => c.priceSource === "hand" ? "eigener Preis" : c.priceSource === "markt" ? "Cardmarket-Trend" : (num(c.priceEur) !== null ? "KI-Schätzung" : "kein Preis");
  const priceChip = c => c.priceSource === "hand" ? '<span class="chip hand">eigener Preis</span>' : c.priceSource === "markt" ? '<span class="chip mk">Cardmarket</span>' : (num(c.priceEur) !== null ? '<span class="chip ai">KI-Schätzung</span>' : "");
  const imgTag = (src, alt) => src ? `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy">` : "";
  const thumbOf = (thumb, card) => thumb || officialImg(card, "low");

  function render() {
    const authed = !!state.user && !state.recovery;
    $("#view-auth").hidden = authed; $("#nav").hidden = !authed; $("#topRight").hidden = !authed;
    if (!authed) { ["#view-scan", "#view-inv", "#view-sets", "#view-value", "#view-hist"].forEach(q => { $(q).hidden = true; }); renderAuth(); return; }
    document.querySelectorAll(".nav button").forEach(b => { if (b.dataset.tab === state.tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    $("#navDot").innerHTML = state.open && state.tab !== "scan" ? '<span class="dot" title="Offene Session"></span>' : "";
    $("#view-scan").hidden = state.tab !== "scan";
    $("#view-inv").hidden = state.tab !== "inv";
    $("#view-hist").hidden = state.tab !== "hist";
    $("#view-sets").hidden = state.tab !== "sets";
    $("#view-value").hidden = state.tab !== "value";
    $("#worth").textContent = state.loaded ? money(state.cards.reduce((s, c) => s + (num(c.priceEur) || 0) * (c.qty || 1), 0)) : "–";
    if (state.tab === "scan") renderScan();
    if (state.tab === "inv") renderInv();
    if (state.tab === "hist") renderHist();
    if (state.tab === "sets") renderSets();
    if (state.tab === "value") renderValue();
  }

  // ---------- login with a user name instead of an e-mail address ----------
  // Supabase needs an e-mail-shaped login. The app turns the user name into a one-way hash
  // ("u-<sha256>@kartenscanner.invalid"), so the database never contains a real address.
  // The same formula is used in supabase/username-migration.sql.
  const UNAME_RE = /^[a-z0-9._-]{3,32}$/;
  const PSEUDO_DOMAIN = "kartenscanner.invalid";
  const normUser = u => String(u || "").trim().toLowerCase();
  async function loginIdOf(input) {
    const u = normUser(input);
    if (u.includes("@")) return u; // older accounts that still use an e-mail address
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("kartenscanner:" + u));
    return "u-" + [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, "0")).join("") + "@" + PSEUDO_DOMAIN;
  }
  const isPseudo = email => String(email || "").endsWith("@" + PSEUDO_DOMAIN);
  const shownUser = () => { let n = ""; try { n = localStorage.getItem("ks-username") || ""; } catch (_) {} return n || (state.user && !isPseudo(state.user.email) ? state.user.email : "dein Benutzerkonto"); };

  function authMsg(e) {
    const code = (e && (e.code || e.error_code)) || "", msg = String((e && e.message) || "");
    if (code === "invalid_credentials" || /invalid login/i.test(msg)) return "Benutzername oder Passwort ist falsch.";
    if (code === "email_not_confirmed" || /not confirmed/i.test(msg)) return "Dieses Konto ist noch nicht bestätigt. Schalte in Supabase unter Authentication → Sign In / Providers „Confirm email“ aus und lege das Konto neu an.";
    if (code === "user_already_exists" || /already registered/i.test(msg)) return "Diesen Benutzernamen gibt es schon. Melde dich an oder wähle einen anderen.";
    if (code === "weak_password" || /password should/i.test(msg)) return "Das Passwort ist zu schwach. Nimm mindestens 8 Zeichen.";
    if (code === "same_password") return "Das neue Passwort muss sich vom alten unterscheiden.";
    if (/rate.?limit/i.test(code + " " + msg) || (e && e.status === 429)) return "Zu viele Versuche in kurzer Zeit. Warte ein paar Minuten.";
    if (code === "signup_disabled" || /signups not allowed/i.test(msg)) return "Neue Konten sind für diese App deaktiviert.";
    if (/sending.*email|confirmation email/i.test(msg)) return "Supabase will eine Bestätigungs-E-Mail schicken. Schalte unter Authentication → Sign In / Providers „Confirm email“ aus und versuch es erneut.";
    if (/fetch|network/i.test(msg)) return "Keine Verbindung zum Server. Prüfe dein Internet.";
    return msg || "Das hat nicht geklappt. Versuch es erneut.";
  }

  function renderAuth() {
    const v = $("#view-auth");
    if (state.problem) { v.innerHTML = `<div class="notice"><strong>App noch nicht eingerichtet.</strong><br>${esc(state.problem)}</div>`; return; }
    if (!sb || !state.authReady) { v.innerHTML = `<div class="notice">Wird geladen …</div>`; return; }
    const m = state.recovery ? "newpw" : (state.authMode === "reset" ? "login" : state.authMode);
    const T = {
      login: ["Anmelden", "Melde dich mit deinem Benutzernamen an.", "Anmelden"],
      signup: ["Konto erstellen", "Du brauchst nur einen Benutzernamen und ein Passwort. Eine E-Mail-Adresse wird nicht gespeichert.", "Konto erstellen"],
      newpw: ["Neues Passwort", "Leg ein neues Passwort für dein Konto fest.", "Passwort speichern"],
    }[m];
    const user = m !== "newpw" ? `<label class="full">Benutzername<input class="field" id="a-user" name="user" type="text" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required value="${esc(state.authEmail)}"></label>` : "";
    const pw = `<label class="full">${m === "newpw" ? "Neues Passwort (mind. 8 Zeichen)" : m === "signup" ? "Passwort (mind. 8 Zeichen)" : "Passwort"}<input class="field" id="a-pw" name="pw" type="password" autocomplete="${m === "login" ? "current-password" : "new-password"}" required></label>`;
    const links = {
      login: `<button class="btn ghost small" type="button" data-act="auth-mode" data-mode="signup">Noch kein Konto? Registrieren</button>`,
      signup: `<button class="btn ghost small" type="button" data-act="auth-mode" data-mode="login">Schon ein Konto? Anmelden</button>`,
      newpw: "",
    }[m];
    v.innerHTML = `<section class="start auth">
        <img class="auth-logo" src="icons/icon.svg" alt="" width="64" height="64">
        <h2>${T[0]}</h2><p>${T[1]}</p>
        ${state.authMsg ? `<div class="notice ok-box">${esc(state.authMsg)}</div>` : ""}
        ${state.authErr ? `<div class="banner">${esc(state.authErr)}</div>` : ""}
        <form class="edit" id="authForm" novalidate>
          ${user}${pw}
          <button class="btn primary full" type="submit" ${state.authBusy ? "disabled" : ""}>${state.authBusy ? "Einen Moment …" : T[2]}</button>
        </form>
        <div class="auth-links">${links}</div>
        ${m === "login" ? `<p class="fine" style="margin:0">Passwort vergessen? Ohne E-Mail-Adresse gibt es keinen Link per Mail. Ein neues Passwort setzt du im Supabase-Dashboard (Anleitung in der README).</p>` : ""}
        ${m === "signup" ? `<p class="fine" style="margin:0">Benutzername: 3–32 Zeichen, nur Kleinbuchstaben, Ziffern, Punkt, Minus und Unterstrich. Groß- und Kleinschreibung spielt keine Rolle.</p>` : ""}
      </section>`;
    $("#authForm").onsubmit = e => { e.preventDefault(); submitAuth(new FormData(e.target), m); };
  }

  async function submitAuth(f, m) {
    const raw = String(f.get("user") || "").trim(), pw = String(f.get("pw") || "");
    if (m !== "newpw") state.authEmail = raw;
    const fail = msg => { state.authErr = msg; state.authMsg = null; render(); };
    const u = normUser(raw);
    if (m !== "newpw" && !u.includes("@") && !UNAME_RE.test(u)) return fail("Benutzername: 3–32 Zeichen, nur Buchstaben a–z, Ziffern, Punkt, Minus und Unterstrich.");
    if (m === "signup" && u.includes("@")) return fail("Bitte einen Benutzernamen statt einer E-Mail-Adresse verwenden.");
    if ((m === "signup" || m === "newpw") && pw.length < 8) return fail("Das Passwort braucht mindestens 8 Zeichen.");
    if (m === "login" && !pw) return fail("Gib dein Passwort ein.");
    state.authBusy = true; state.authErr = null; state.authMsg = null; render();
    try {
      if (m === "login") {
        const { error } = await sb.auth.signInWithPassword({ email: await loginIdOf(u), password: pw }); if (error) throw error;
        try { localStorage.setItem("ks-username", u.includes("@") ? "" : u); } catch (_) {}
      } else if (m === "signup") {
        const { data, error } = await sb.auth.signUp({ email: await loginIdOf(u), password: pw }); if (error) throw error;
        try { localStorage.setItem("ks-username", u); } catch (_) {}
        if (!data.session) { state.authMode = "login"; state.authErr = "Das Konto wurde angelegt, wartet aber auf eine E-Mail-Bestätigung, die nie ankommt. Schalte in Supabase „Confirm email“ aus, lösche den Nutzer und registriere dich erneut."; }
      } else if (m === "newpw") {
        const { error } = await sb.auth.updateUser({ password: pw }); if (error) throw error;
        state.recovery = false; toast("Neues Passwort gespeichert.");
      }
    } catch (e) { state.authErr = authMsg(e); }
    state.authBusy = false; render();
  }

  function renderScan() {
    const v = $("#view-scan");
    if (state.problem) { v.innerHTML = `<div class="notice"><strong>Speicher nicht verfügbar.</strong><br>${esc(state.problem)}</div>`; return; }
    if (!state.loaded) { v.innerHTML = `<div class="notice">Wird geladen …</div>`; return; }
    const keyBanner = !settings.apiKey ? `<div class="banner"><span>Für die Erkennung per Foto brauchst du einen Anthropic-API-Schlüssel. Ohne Schlüssel kannst du Karten über die Suche hinzufügen.</span><button class="btn small" type="button" data-act="settings">Schlüssel eintragen</button></div>` : "";
    const down = (state.marketDown ? `<div class="banner">${esc(state.marketDown)}</div>` : "") + legacyBanner();
    const scanButtons = `
      <div class="scanrow">
        <button class="btn primary" type="button" data-act="camera">${I.cam}<span>Karte scannen</span></button>
        <button class="btn" type="button" data-act="gallery">${I.pics}<span>Fotos</span></button>
        <button class="btn" type="button" data-act="manual">${I.find}<span>Suchen</span></button>
      </div>`;
    if (!state.open) {
      const last = state.sessions.filter(s => s.status === "done").sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0))[0];
      const t = state.test;
      v.innerHTML = `${keyBanner}${down}
        <section class="start">
          <div class="eyebrow">Neue Scan-Session</div>
          <h2>Karten scannen, Marktwert sehen, ins Inventar legen</h2>
          <p>Jede Karte wird einzeln erkannt und mit dem aktuellen Cardmarket-Preis bewertet. Am Ende siehst du den Endbetrag der Session und übernimmst alles mit einem Tipp ins Inventar.</p>
          <div class="steps"><div><b>1 · Scannen</b>Karte flach, gut beleuchtet, in den Rahmen legen.</div><div><b>2 · Prüfen</b>Antippen, um Karte, Variante, Zustand oder Preis zu ändern.</div><div><b>3 · Abschließen</b>Endbetrag ansehen und übernehmen.</div></div>
          ${scanButtons}
        </section>
        ${last ? `<div class="notice">Letzte Session am ${esc(dOnly(last.finishedAt))}: <strong>${last.count || 0} Karten</strong> · <strong class="mono">${money(last.total)}</strong></div>` : ""}
        <section class="notice stack" style="gap:8px">
          <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap"><div><strong>Preisquelle:</strong> Cardmarket-Trendpreis aus der Datenbank TCGdex.</div>
          <button class="btn small" type="button" data-act="test" ${t && t.running ? "disabled" : ""}>${t && t.running ? "Teste …" : "Verbindung testen"}</button></div>
          ${t && t.results ? t.results.map(r => `<div class="${r.ok ? "ok-txt" : "bad-txt"}">${esc(r.msg)}</div>`).join("") : ""}
        </section>`;
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
      ${(state.dupView = sessionDupes(), "")}${items.length ? `<ul class="list">${items.slice().reverse().map(rowHTML).join("")}</ul><p class="fine" style="margin:-6px 0 0">Doppelt gescannt? Karte nach rechts wischen, um sie zu entfernen.</p>` : `<div class="empty">Noch keine Karte in dieser Session. Tippe auf „Karte scannen“.</div>`}
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
      <div class="chips">${c.rarity ? `<span class="chip">${esc(c.rarity)}</span>` : ""}${c.variant && c.variant !== "Normal" ? `<span class="chip">${esc(c.variant)}</span>` : ""}<span class="chip">${esc(c.condition || "NM")}</span>${lowConf ? '<span class="chip warn">unsicher – prüfen</span>' : ""}${c.market && c.market.ambiguous ? '<span class="chip warn">Set prüfen</span>' : ""}${dupChips(state.dupView && state.dupView.get(it.id))}</div>
      ${noMarket && c.marketError ? `<div class="erractions"><span class="fine">${esc(c.marketError)}</span><button class="btn small" type="button" data-act="search-item" data-id="${esc(it.id)}">Karte suchen</button></div>` : ""}</div>
      <div class="px">${money(num(c.priceEur) === null ? null : c.priceEur * (it.qty || 1))}<small>${(it.qty || 1) > 1 ? `${it.qty} × ${money(c.priceEur)}` : esc(srcLabel(c))}</small></div></li>`;
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
      <div class="fine">${mk.length} von ${cards.length} mit Cardmarket-Preis${isFinite(oldest) ? ` · ältester Stand ${dOnly(oldest)}` : ""}${ki ? ` · ${ki} ohne Marktpreis` : ""}</div>
      <button class="btn small" type="button" data-act="refresh-all" ${rf ? "disabled" : ""}>${rf ? `Aktualisiere ${rf.done}/${rf.total} …` : "Alle Preise aktualisieren"}</button></div>` : "";
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
    if (!cards.length) { g.innerHTML = `<div class="empty"><div>Dein Inventar ist noch leer. Scanne Karten in einer Session und schließe sie ab, dann erscheinen sie hier mit Bild und Marktwert.</div><button class="btn primary" type="button" data-tab="scan">Zur Scan-Session</button></div>`; return; }
    if (!list.length) { g.innerHTML = `<div class="empty">Keine Karte passt zu „${esc(state.search)}“.</div>`; return; }
    g.innerHTML = `<div class="grid">${list.map(c => `
      <button class="tile" type="button" data-act="detail" data-id="${esc(c.id)}">
        <div class="art">${imgTag(thumbOf(c.thumb, c), c.name)}${(c.qty || 1) > 1 ? `<span class="qty">×${c.qty}</span>` : ""}</div>
        <div class="info"><div class="nm">${esc(c.name)}</div><div class="num">${esc([c.setCode || c.set, c.number].filter(Boolean).join(" · ") || "–")}</div>
        <div class="price">${money(c.priceEur)}${c.priceSource === "markt" ? "" : c.priceSource === "hand" ? '<span class="src">eigen</span>' : (num(c.priceEur) !== null ? '<span class="src">KI</span>' : "")}</div></div>
      </button>`).join("")}</div>`;
  }

  const SET_SORTS = [["progress", "Fortschritt"], ["value", "Dein Wert"], ["missing", "Wenigste fehlend"], ["name", "Name"], ["new", "Neueste zuerst"], ["old", "Älteste zuerst"]];
  function renderSets() {
    const v = $("#view-sets");
    if (!state.loaded) { v.innerHTML = `<div class="notice">Wird geladen …</div>`; return; }
    const ids = [...new Set(state.cards.map(setIdOf).filter(Boolean))];
    const unassigned = state.cards.filter(c => !setIdOf(c)).length;
    if (!ids.length) { v.innerHTML = `<div class="empty">Noch keine Sets. Sobald Karten mit Marktpreis im Inventar sind, siehst du hier, wie viele Karten dir pro Set fehlen.</div>`; return; }
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
      ${unassigned ? `<p class="fine">${unassigned} Karte${unassigned === 1 ? " ist" : "n sind"} noch keinem Set zugeordnet (ohne Marktpreis). Ordne sie in der Kartenansicht über „Andere Karte zuordnen“ zu.</p>` : ""}
      <p class="fine">Set- und Kartennamen auf Deutsch, soweit TCGdex sie kennt; sonst Englisch.</p>`;
    $("#setSort").onchange = e => { settings.setSort = e.target.value; renderSets(); };
  }

  function renderValue() {
    const v = $("#view-value");
    if (!state.loaded) { v.innerHTML = `<div class="notice">Wird geladen …</div>`; return; }
    if (!state.historyOk) {
      v.innerHTML = `<div class="notice stack" style="gap:8px"><strong>Wertentwicklung noch nicht eingerichtet</strong><span>In deiner Datenbank fehlt die Tabelle für den Verlauf. Führe im Supabase SQL Editor einmal den Abschnitt „history“ aus supabase/schema.sql aus und lade die App neu.</span></div>`;
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
      ${base ? `<div class="notice">Davon durch Preisänderungen am Markt: <strong class="${deltaCls(marketDelta)}">${signed(marketDelta)}</strong> seit ${esc(dOnly(Date.parse(base.id + "T12:00:00")))}. Der Rest kommt von neu hinzugefügten oder entfernten Karten.</div>` : ""}
      ${up.length ? `<h3 class="sec">Gewinner</h3><ul class="movers">${up.map(mv).join("")}</ul>` : ""}
      ${down.length ? `<h3 class="sec">Verlierer</h3><ul class="movers">${down.map(mv).join("")}</ul>` : ""}
      ${base && !movers.length ? `<p class="fine">Seit ${esc(dOnly(Date.parse(base.id + "T12:00:00")))} haben sich die Preise deiner Karten nicht verändert.</p>` : ""}
      <p class="fine">Die Preise werden einmal am Tag beim Öffnen der App automatisch aktualisiert (Cardmarket-Trend über TCGdex).</p>`;
  }

  function renderHist() {
    const v = $("#view-hist");
    const done = state.sessions.filter(s => s.status === "done").sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
    if (!done.length) { v.innerHTML = `<div class="empty">Noch keine abgeschlossene Session. Hier steht später jede Session mit Datum, Kartenzahl und Endbetrag.</div>`; return; }
    const sum = done.reduce((s, x) => s + (x.total || 0), 0);
    v.innerHTML = `<div class="notice">${done.length} Session${done.length === 1 ? "" : "s"} · zusammen <strong class="mono">${money(sum)}</strong> zum Zeitpunkt des Scans</div>` +
      done.map(s => `<details class="hist"><summary><div><div class="t">${esc(dt(s.finishedAt))}</div><div class="sub">${s.count || 0} Karte${s.count === 1 ? "" : "n"}</div></div><div class="px">${money(s.total)}</div></summary>
        <ul>${(s.summary || []).map(x => `<li><span>${esc(x.name)}${x.qty > 1 ? ` ×${x.qty}` : ""} <span class="muted">${esc([x.set, x.number].filter(Boolean).join(" · "))}${x.priceSource && x.priceSource !== "markt" ? ` · ${x.priceSource === "hand" ? "eigen" : "KI"}` : ""}</span></span><span class="mono">${money(num(x.priceEur) === null ? null : x.priceEur * (x.qty || 1))}</span></li>`).join("")}</ul></details>`).join("");
  }

  // ---------- sheets ----------
  function openSheet(s) { state.sheet = s; renderSheet(); }
  function closeSheet() { state.sheet = null; const r = $("#sheetRoot"); r.innerHTML = ""; r.dataset.key = ""; document.body.style.overflow = ""; }

  function marketBox(c, s) {
    const m = c.market;
    const head = c.priceSource === "hand" ? "Dein Preis pro Karte" : c.priceSource === "markt" ? `Cardmarket-Trendpreis${m && m.foil ? " (Reverse Holo)" : ""}` : "Wert pro Karte";
    let inner = `<div class="eyebrow">${head} ${priceChip(c)}</div><div class="big">${money(c.priceEur)}</div>`;
    if (m) {
      const cell = (k, v) => `<div><div class="k">${k}</div><div class="v">${v}</div></div>`;
      inner += `<div class="mgrid">${cell("Trend", money(m.trend))}${cell("Ab", money(m.low))}${cell("Ø 1 Tag", money(m.avg1))}${cell("Ø 7 Tage", money(m.avg7))}${cell("Ø 30 Tage", money(m.avg30))}${m.usd != null ? cell("TCGplayer", usd(m.usd)) : ""}</div>
        <div class="fine">Stand ${esc(dOnly(m.updated || m.fetchedAt))} · Quelle: Cardmarket über TCGdex</div>
        <div class="fine">Zugeordnet: ${esc(m.matchName || "?")} · ${esc(m.matchSet || "?")} · Nr. <span class="mono">${esc(m.matchLocal || "?")}${m.matchOfficial ? "/" + esc(m.matchOfficial) : ""}</span>${m.ambiguous ? ' <span class="bad-txt">– mehrere Treffer, bitte prüfen</span>' : ""}</div>`;
    } else {
      inner += `<div class="fine">${c.priceSource === "hand" ? "Von dir eingetragen." : num(c.priceEur) !== null ? "Grobe KI-Schätzung, kein Marktpreis." : "Noch kein Preis."}${c.marketError ? " " + esc(c.marketError) : ""}</div>`;
    }
    const hist = cardHistory(c.id);
    if (hist.length >= 2) {
      const dv = hist[hist.length - 1].y - hist[0].y;
      inner += `<div class="spark"><div><div class="k">Preisverlauf seit ${esc(dOnly(hist[0].x))}</div><div class="v ${deltaCls(dv)}">${signed(dv)}${pct(dv, hist[0].y)}</div></div>${lineChart(hist, { w: 140, h: 40, compact: true, label: "Preisverlauf" })}</div>`;
    }
    return `<div class="pricebox">${inner}<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn small" type="button" data-act="refresh-card" data-id="${esc(c.id)}" ${s.refreshing ? "disabled" : ""}>${s.refreshing ? "Rufe Preis ab …" : "Marktpreis aktualisieren"}</button><button class="btn small" type="button" data-act="search-card" data-id="${esc(c.id)}">Andere Karte zuordnen</button></div></div>`;
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
        ${(dv = sessionDupes(), "")}<ul class="compact">${ok.map(i => swipeWrap(i.id, `<div class="cline swipe-fg"><span>${esc(i.card.name)}${(i.qty || 1) > 1 ? ` ×${i.qty}` : ""} <span class="muted">${esc(i.card.number || "")} · ${esc(srcLabel(i.card))}</span>${(dv.get(i.id) || {}).ses ? ' <span class="chip warn">doppelt</span>' : ""}</span><span class="mono">${money(num(i.card.priceEur) === null ? null : i.card.priceEur * (i.qty || 1))}</span><button class="icon-del" type="button" data-act="del-item" data-id="${esc(i.id)}" aria-label="${esc(i.card.name)} entfernen">${I.trash}</button></div>`)).join("")}</ul>
        <p class="fine" style="margin:0">Doppelt gescannt? Nach rechts wischen oder auf den Mülleimer tippen.</p>
        <p class="fine">Grundlage ist der Cardmarket-Trendpreis (Near Mint) aus TCGdex.${ki ? ` ${ki} Karte${ki === 1 ? "" : "n"} ohne Marktpreis ${ki === 1 ? "ist" : "sind"} mit der KI-Schätzung oder ohne Wert eingerechnet.` : ""} Der Zustand deiner Karte kann den erzielbaren Preis senken.</p>
        <button class="btn primary block" type="button" data-act="commit" ${state.busy ? "disabled" : ""}>${state.busy ? "Wird übernommen …" : "Zum Inventar hinzufügen"}</button>
      </div>`;
    } else if (s.type === "done") {
      title = "Session abgeschlossen";
      body = `<div class="stack">
        <div class="endbetrag"><div class="eyebrow">Endbetrag</div><div class="big">${money(s.total)}</div><div>${s.count} Karte${s.count === 1 ? "" : "n"} übernommen</div></div>
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
        ["KI-Schätzung", num(c.kiPriceEur) === null ? null : `<span class="mono">${money(c.kiPriceEur)}</span>`, true],
        ["Kartentyp", c.cardType], ["Typ", c.pokemonType], ["KP", c.hp ? String(c.hp) : null],
        ["Erkennung", num(c.confidence) === null || c.confidence === 1 ? null : `${Math.round(c.confidence * 100)} % sicher`],
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
          <div class="stack" style="gap:6px;min-width:0"><div class="fine">Falsche Karte erkannt? Such die richtige in der Datenbank, das übernimmt Name, Set, Nummer und Preis.</div>
          <button class="btn small" type="button" data-act="${isItem ? "search-item" : "search-card"}" data-id="${esc(src.id)}">${I.find}<span>In Datenbank suchen</span></button></div></div>
        <label class="full">Name<input class="field" id="f-name" name="name" value="${esc(c.name || "")}" required></label>
        <label class="full">Englischer Name (für die Preissuche)<input class="field" id="f-nameEn" name="nameEn" value="${esc(c.nameEn || "")}" placeholder="z. B. Charizard ex"></label>
        <label class="full">Set / Erweiterung<input class="field" id="f-set" name="set" value="${esc(c.set || "")}"></label>
        <label>Set-Kürzel<input class="field" id="f-setCode" name="setCode" value="${esc(c.setCode || "")}"></label>
        <label>Nummer<input class="field" id="f-number" name="number" value="${esc(c.number || "")}" placeholder="025/165"></label>
        <label>Seltenheit<input class="field" id="f-rarity" name="rarity" value="${esc(c.rarity || "")}"></label>
        <label>Variante<input class="field" id="f-variant" name="variant" value="${esc(c.variant || "")}" list="variants"></label>
        <label>Sprache<select class="field" id="f-language" name="language"><option value="">–</option>${opt(LANGS, c.language)}</select></label>
        <label>Zustand<select class="field" id="f-condition" name="condition">${opt(CONDITIONS, c.condition || "NM")}</select></label>
        <label>Eigener Preis (€)<input class="field mono" id="f-price" name="priceEur" inputmode="decimal" value="${esc(priceInput(c.priceEur))}" placeholder="0,00"></label>
        <label>Menge<input class="field mono" id="f-qty" name="qty" type="number" min="1" max="999" value="${src.qty || 1}"></label>
        <datalist id="variants"><option value="Normal"><option value="Holo"><option value="Reverse Holo"><option value="1st Edition"><option value="Shadowless"><option value="Promo"></datalist>
        <p class="fine full" style="margin:0">Änderst du den Preis, gilt er als dein eigener Preis und wird bei Aktualisierungen nicht überschrieben. Leer lassen setzt ihn zurück. Änderst du Name, Set, Nummer oder Variante, wird der Marktpreis neu gesucht.</p>
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
          <div class="px">${b.market ? money(b.market.trend ?? b.priceEur) : "–"}<small>${b.market ? "Trend" : "kein Preis"}</small></div></button></li>`;
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
            ${known.length ? `<div class="fine">Geschätzt zum Vervollständigen: <strong>${money(missSum)}</strong> (Cardmarket-Trend, ${known.length} von ${missing.length} Preisen geladen)</div>` : `<div class="fine">Lade die Preise, um zu sehen, was das Vervollständigen kosten würde.</div>`}
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
          <p class="fine" style="margin:0">Preise: Cardmarket-Trend (Normalversion). Fehlende Karten öffnen die Cardmarket-Suche. Gezählt werden Karten mit Marktpreis-Zuordnung, unabhängig von Sprache und Variante.</p>
        </div>`;
      }
    } else if (s.type === "settings") {
      title = "Einstellungen";
      const key = settings.apiKey;
      body = `<div class="stack">
        <form class="edit" id="settingsForm">
          <label class="full">Anthropic-API-Schlüssel<input class="field mono" id="set-key" name="key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${key ? "gespeichert – zum Ändern neu eingeben" : "sk-ant-…"}"></label>
          <label class="full">Modell für die Erkennung<select class="field" id="set-model" name="model">${MODELS.map(([v, l]) => `<option value="${v}" ${v === settings.model ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          <p class="fine full" style="margin:0">Der Schlüssel wird nur im Browser dieses Geräts gespeichert, nicht in deinem Konto, und direkt an api.anthropic.com geschickt. Jeder Scan verbraucht API-Guthaben. Einen Schlüssel erstellst du in der <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Anthropic Console</a>. Tipp: Leg dort ein Ausgabelimit fest.</p>
          <button class="btn primary" type="submit">Speichern</button>
          <button class="btn danger" type="button" data-act="key-del" ${key ? "" : "disabled"}>Schlüssel löschen</button>
        </form>
        <div class="notice stack" style="gap:8px"><strong>Konto</strong>
          <span>Angemeldet als <strong>${esc(shownUser())}</strong>. Inventar, Sessions und Fotos sind in deinem Konto gespeichert und auf jedem Gerät verfügbar, auf dem du dich anmeldest.</span>
          ${state.user && isPseudo(state.user.email) ? `<span class="fine ok-txt">In der Datenbank ist keine E-Mail-Adresse von dir gespeichert, nur ein Hash deines Benutzernamens.</span>` : `<span class="fine bad-txt">Dein Konto nutzt noch eine echte E-Mail-Adresse. So stellst du auf einen Benutzernamen um: README → „Auf Benutzernamen umstellen“.</span>`}
          <label class="setrowlbl" for="set-idle">Automatisch abmelden nach
            <select class="field" id="set-idle">${IDLE_OPTIONS.map(([v, l]) => `<option value="${v}" ${v === settings.idle ? "selected" : ""}>${l} ohne Aktivität</option>`).join("").replace(">Nie ohne Aktivität<", ">Nie<")}</select></label>
          <span class="fine">Während du scannst oder die App Preise lädt, wirst du nicht abgemeldet. 30 Sekunden vorher kommt eine Warnung.${settings.idle ? ` Ohne weitere Aktivität: Abmeldung um ${esc(new Date(Date.now() + settings.idle * 60e3).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }))} Uhr.` : ""}</span>
          <button class="btn" type="button" data-act="logout">Abmelden</button>
        </div>
        <div class="notice stack" style="gap:8px"><strong>Sicherungsdatei</strong>
          <span>Zusätzlich kannst du Inventar und Verlauf als Datei sichern (ohne Fotos).</span>
          <div class="actions"><button class="btn" type="button" data-act="export">Backup speichern</button><button class="btn" type="button" data-act="import">Backup laden</button></div>
        </div>
        <p class="fine" style="margin:0">Preisdaten: <a href="https://tcgdex.dev" target="_blank" rel="noopener">TCGdex</a> (Cardmarket, täglich aktualisiert). Pokémon und Pokémon-Kartennamen sind Marken von Nintendo, Creatures und GAME FREAK; diese App ist ein privates Fanprojekt.</p>
      </div>`;
    }
    const prevSheet = root.querySelector(".sheet"), sheetKey = s.type + ":" + (s.id || "");
    const keepScroll = prevSheet && root.dataset.key === sheetKey ? prevSheet.scrollTop : 0;
    const focused = document.activeElement && root.contains(document.activeElement) && document.activeElement.id ? document.activeElement.id : null;
    root.innerHTML = `<div class="scrim" data-act="scrim"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-head"><h2>${esc(title)}</h2><button class="x" type="button" data-act="close" aria-label="Schließen">×</button></div>${body}</div></div>`;
    root.dataset.key = sheetKey;
    if (keepScroll) root.querySelector(".sheet").scrollTop = keepScroll;
    if (focused && (focused === "pmin" || focused === "pmax")) { const el = $("#" + focused); if (el) { el.focus(); const n = el.value.length; try { el.setSelectionRange(n, n); } catch (_) {} } }
    const cs = $("#cardSort"); if (cs) cs.onchange = () => { settings.cardSort = cs.value; renderSheet(); };
    for (const idr of ["pmin", "pmax"]) { const el = $("#" + idr); if (el) el.oninput = () => { clearTimeout(rangeTimer); rangeTimer = setTimeout(() => { if (!state.sheet) return; state.sheet[idr === "pmin" ? "min" : "max"] = parsePrice(el.value); renderSheet(); }, 450); }; }
    const ef = $("#editForm"); if (ef) ef.onsubmit = e => { e.preventDefault(); saveEdit(ef); };
    const sf = $("#searchForm"); if (sf) sf.onsubmit = e => { e.preventDefault(); runSearch(sf); };
    const si = $("#set-idle"); if (si) si.onchange = () => { settings.idle = Number(si.value); markActive(true); toast(settings.idle ? `Automatische Abmeldung nach ${idleLabel()} ohne Aktivität.` : "Automatische Abmeldung ist aus."); };
    const st = $("#settingsForm"); if (st) st.onsubmit = e => {
      e.preventDefault();
      const k = String(new FormData(st).get("key") || "").trim();
      if (k) settings.apiKey = k;
      settings.model = String(new FormData(st).get("model") || MODELS[0][0]);
      toast(k ? "Schlüssel gespeichert." : "Einstellungen gespeichert."); closeSheet(); render();
    };
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
    if (armed !== sw.armed) { sw.armed = armed; sw.li.classList.toggle("armed", armed); if (armed && navigator.vibrate) navigator.vibrate(12); }
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
    if (tabBtn) { state.tab = tabBtn.dataset.tab; closeSheet(); render(); window.scrollTo(0, 0); return; }
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
      case "commit": commitSession(); break;
      case "discard": openSheet({ type: "discard" }); break;
      case "discard-yes": discardSession(); break;
      case "goinv": closeSheet(); state.tab = "inv"; render(); window.scrollTo(0, 0); break;
      case "detail": openSheet({ type: "detail", id }); break;
      case "img-own": state.sheet.img = "own"; renderSheet(); break;
      case "img-off": state.sheet.img = "official"; renderSheet(); break;
      case "edit-card": openSheet({ type: "edit", kind: "card", id }); break;
      case "refresh-card": refreshCard(id); break;
      case "refresh-all": refreshAll(); break;
      case "test": testConnections(); break;
      case "delete": state.sheet.confirmDelete = true; renderSheet(); break;
      case "delete-yes": deleteCard(id); break;
      case "key-del": settings.apiKey = ""; toast("Schlüssel gelöscht."); renderSheet(); render(); break;
      case "export": exportData(); break;
      case "auth-mode": state.authMode = el.dataset.mode; state.authErr = null; state.authMsg = null; render(); break;
      case "logout": closeSheet(); sb.auth.signOut({ scope: "local" }).catch(() => {}); break;
      case "migrate": migrateLegacy(); break;
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

  // ---------- boot ----------
  async function loadAll() {
    const [cards, sessions, items] = await Promise.all([Store.all("cards"), Store.all("sessions"), Store.all("items")]);
    state.cards = cards; state.sessions = sessions; state.items = items;
    state.open = sessions.filter(x => x.status === "open").sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0] || null;
    // Scans left half-done (app closed mid-recognition) can't finish any more.
    for (const it of items) if (it.status === "pending" && !state.running.has(it.id) && Date.now() - (it.createdAt || 0) > 3 * 60e3)
      await save("items", { ...it, status: it.card ? "ok" : "error", error: it.card ? null : "Die Erkennung wurde unterbrochen. Tippe auf „Erneut erkennen“." }).catch(() => {});
    try { state.history = await Store.all("history"); state.historyOk = true; }
    catch (e) { state.history = []; state.historyOk = !isMissingTable(e); }
    state.loaded = true; state.lastSync = Date.now();
  }
  function clearData() {
    state.cards = []; state.sessions = []; state.items = []; state.open = null; state.loaded = false;
    state.imgCache.forEach(u => { try { URL.revokeObjectURL(u); } catch (_) {} }); state.imgCache.clear();
  }
  async function onAuth(event, session) {
    state.authReady = true;
    if (event === "PASSWORD_RECOVERY") { state.recovery = true; state.authErr = null; state.authMsg = null; }
    const user = session ? session.user : null;
    if (!user) { state.user = null; state.recovery = false; clearData(); render(); return; }
    if (state.user && state.user.id === user.id) { state.user = user; render(); return; }
    // App reopened after a long break: the old login is not resumed.
    if (event === "INITIAL_SESSION" && idleExpired()) { idleLogout(); return; }
    markActive(true);
    state.user = user; clearData(); state.authMsg = null; state.authErr = null; render();
    try { await loadAll(); } catch (e) { toast("Deine Daten ließen sich nicht laden. Prüfe deine Verbindung."); }
    maybeAutoRefresh();
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
  async function idleLogout() {
    if (camOpen()) closeCamera();
    closeSheet();
    idleWarned = false;
    const t = $("#toast"); if (t && t.dataset.kind === "idle") t.hidden = true;
    const label = idleLabel();
    state.authMode = "login"; state.authErr = null;
    try { await sb.auth.signOut({ scope: "local" }); } catch (_) {}
    state.user = null; clearData();
    state.authMsg = `Du wurdest nach ${label} ohne Aktivität abgemeldet.`;
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

  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
