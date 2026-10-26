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
    };
  })();

  // ---------- IndexedDB ----------
  const DB = (() => {
    let opening;
    const open = () => opening || (opening = new Promise((res, rej) => {
      const r = indexedDB.open("kartenscanner", 1);
      r.onupgradeneeded = () => { const d = r.result; for (const s of ["cards", "sessions", "items", "images"]) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: "id" }); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
    const run = async (store, mode, fn) => {
      const d = await open();
      return new Promise((res, rej) => {
        const t = d.transaction(store, mode); const req = fn(t.objectStore(store));
        t.oncomplete = () => res(req ? req.result : undefined);
        t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
      });
    };
    return {
      all: s => run(s, "readonly", st => st.getAll()),
      get: (s, id) => run(s, "readonly", st => st.get(id)),
      put: (s, v) => run(s, "readwrite", st => { st.put(v); return null; }),
      del: (s, id) => run(s, "readwrite", st => { st.delete(id); return null; }),
    };
  })();

  const state = {
    cards: [], sessions: [], items: [], open: null, loaded: false, problem: null,
    running: new Set(), stage: new Map(), tab: "scan", search: "", sort: settings.sort,
    sheet: null, imgCache: new Map(), busy: false, refreshing: null, test: null, marketDown: null,
  };

  async function save(store, obj) {
    await DB.put(store, clone(obj));
    const list = store === "cards" ? state.cards : store === "sessions" ? state.sessions : store === "items" ? state.items : null;
    if (list) { const i = list.findIndex(x => x.id === obj.id); if (i >= 0) list[i] = obj; else list.push(obj); }
    if (store === "sessions") state.open = state.sessions.find(s => s.status === "open") || null;
    persistOnce();
  }
  async function remove(store, id) {
    await DB.del(store, id);
    const list = store === "cards" ? state.cards : store === "sessions" ? state.sessions : store === "items" ? state.items : null;
    if (list) { const i = list.findIndex(x => x.id === id); if (i >= 0) list.splice(i, 1); }
    if (store === "sessions") state.open = state.sessions.find(s => s.status === "open") || null;
  }
  let persistAsked = false;
  function persistOnce() { if (persistAsked) return; persistAsked = true; try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (_) {} }
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
      thumb: drawTo(src, sw, sh, 300, crop).toDataURL("image/jpeg", 0.7),
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

  async function addFromVersions(v) {
    const sid = await ensureSession();
    const id = uid();
    await DB.put("images", { id, data: v.main });
    await save("items", { id, sessionId: sid, status: "pending", thumb: v.thumb, imageId: id, qty: 1, createdAt: Date.now() });
    render();
    recognize(id, v.ai);
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
    if (!settings.apiKey) { await patchItem(id, { status: "error", error: aiMsg({ code: "no_key" }) }); render(); return; }
    state.running.add(id); setStage(id, "Karte wird erkannt …");
    let patch;
    try {
      const r = await identify(blob);
      if (!r || typeof r !== "object" || r.isCard === false) patch = { status: "error", error: "Auf dem Foto wurde keine Pokémon-Karte erkannt. Nimm sie neu auf oder such sie von Hand." };
      else {
        let card = normalizeCard(r);
        setStage(id, `${card.name}: Marktpreis wird gesucht …`);
        card = applyMarket(card, await lookupMarket(card));
        patch = { status: "ok", card, error: null };
      }
    } catch (e) { patch = { status: "error", error: aiMsg(e) }; }
    await patchItem(id, patch);
    state.running.delete(id); setStage(id, null);
  }
  async function relookupItem(id, useId) {
    const it = getItem(id); if (!it || !it.card) return;
    state.running.add(id); await patchItem(id, { status: "pending" }); setStage(id, `${it.card.name}: Marktpreis wird gesucht …`);
    const card = applyMarket(it.card, await lookupMarket(it.card, { useId }));
    await patchItem(id, { status: "ok", error: null, card });
    state.running.delete(id); setStage(id, null);
  }
  async function retryItem(id) {
    const it = getItem(id); if (!it || !it.imageId) return;
    const img = await DB.get("images", it.imageId);
    if (!img) { toast("Das Foto ist nicht mehr vorhanden."); return; }
    await patchItem(id, { status: "pending", error: null });
    recognize(id, dataURLtoBlob(img.data));
  }
  async function removeItem(id) {
    const it = getItem(id); if (!it) return;
    await remove("items", id); if (it.imageId) await DB.del("images", it.imageId);
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
          if (it.imageId && it.imageId !== ex.imageId) await DB.del("images", it.imageId);
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
      for (const it of all) { await remove("items", it.id); if (it.status !== "ok" && it.imageId) await DB.del("images", it.imageId); }
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
    for (const it of openItems()) { await remove("items", it.id); if (it.imageId) await DB.del("images", it.imageId); }
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
    const res = await lookupMarket(c, { fresh: true, useId: opts.useId });
    const cur = state.cards.find(x => x.id === id) || c;
    await save("cards", { ...applyMarket(cur, res), id });
    toast(res.market ? `Marktpreis: ${money(res.priceEur)} (Cardmarket-Trend)` : res.error);
    if (state.sheet && state.sheet.id === id) { state.sheet.refreshing = false; renderSheet(); }
    render();
  }
  async function refreshAll() {
    if (state.refreshing || !state.cards.length) return;
    const cards = state.cards.slice();
    state.refreshing = { done: 0, total: cards.length, failed: 0 }; renderInv();
    for (const c of cards) {
      const res = await lookupMarket(c, { fresh: true });
      const cur = state.cards.find(x => x.id === c.id); if (cur) await save("cards", { ...applyMarket(cur, res), id: c.id });
      state.refreshing.done++; if (!res.market) state.refreshing.failed++;
      render();
      if (state.marketDown) break;
      await sleep(120);
    }
    const { failed, total } = state.refreshing;
    state.refreshing = null; render();
    toast(state.marketDown || (failed ? `Preise aktualisiert. ${failed} von ${total} ohne Marktpreis.` : "Alle Preise aktualisiert."));
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
    await remove("cards", id); if (c.imageId) await DB.del("images", c.imageId);
    closeSheet(); render(); toast("Karte gelöscht.");
  }

  // ---------- backup ----------
  async function exportData() {
    const data = { app: "pokemon-kartenscanner", version: 1, exportedAt: new Date().toISOString(), cards: state.cards, sessions: state.sessions, items: state.items, images: await DB.all("images") };
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
      for (const s of ["images", "cards", "sessions", "items"]) for (const v of (data[s] || [])) if (v && v.id) await DB.put(s, v);
      await loadAll(); closeSheet(); render();
      toast(`Backup eingespielt: ${(data.cards || []).length} Karten.`);
    } catch (e) { toast("Die Datei ist kein gültiges Kartenscanner-Backup."); }
  }

  // ---------- camera ----------
  let stream = null, camShots = 0;
  async function openCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $("#camFallback").click(); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    } catch (e) {
      toast("Kein Kamerazugriff. Ich öffne stattdessen die Foto-Aufnahme.");
      $("#camFallback").click(); return;
    }
    const v = $("#camVideo"); v.srcObject = stream;
    $("#camera").hidden = false; camShots = 0; $("#camCount").textContent = "Karte in den Rahmen legen";
    try { await v.play(); } catch (_) {}
  }
  function closeCamera() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null; $("#camera").hidden = true; $("#camVideo").srcObject = null;
  }
  async function shoot() {
    const v = $("#camVideo"); if (!v.videoWidth) return;
    const box = v.getBoundingClientRect(), fr = $("#camFrame").getBoundingClientRect();
    const scale = Math.max(box.width / v.videoWidth, box.height / v.videoHeight);
    const ox = (box.width - v.videoWidth * scale) / 2, oy = (box.height - v.videoHeight * scale) / 2;
    const pad = 0.06;
    let x = (fr.left - box.left - ox) / scale, y = (fr.top - box.top - oy) / scale, w = fr.width / scale, h = fr.height / scale;
    x -= w * pad; y -= h * pad; w *= 1 + 2 * pad; h *= 1 + 2 * pad;
    x = Math.max(0, x); y = Math.max(0, y); w = Math.min(v.videoWidth - x, w); h = Math.min(v.videoHeight - y, h);
    const flash = $("#camFlash"); flash.classList.add("on"); setTimeout(() => flash.classList.remove("on"), 60);
    const vers = await makeVersions(v, v.videoWidth, v.videoHeight, { x, y, w, h });
    camShots++; $("#camCount").textContent = `${camShots} Karte${camShots === 1 ? "" : "n"} erfasst – nächste Karte`;
    addFromVersions(vers).catch(() => toast("Der Scan ließ sich nicht speichern."));
  }

  // ---------- rendering ----------
  const I = {
    cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    pics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-8 8"/></svg>',
    find: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  };
  const subLine = c => [c.set, c.number].filter(Boolean).map((v, i, a) => (i === a.length - 1 && c.number) ? `<span class="mono">${esc(v)}</span>` : esc(v)).join(" · ") || "Set unbekannt";
  const srcLabel = c => c.priceSource === "hand" ? "eigener Preis" : c.priceSource === "markt" ? "Cardmarket-Trend" : (num(c.priceEur) !== null ? "KI-Schätzung" : "kein Preis");
  const priceChip = c => c.priceSource === "hand" ? '<span class="chip hand">eigener Preis</span>' : c.priceSource === "markt" ? '<span class="chip mk">Cardmarket</span>' : (num(c.priceEur) !== null ? '<span class="chip ai">KI-Schätzung</span>' : "");
  const imgTag = (src, alt) => src ? `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy">` : "";
  const thumbOf = (thumb, card) => thumb || officialImg(card, "low");

  function render() {
    document.querySelectorAll(".nav button").forEach(b => { if (b.dataset.tab === state.tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    $("#navDot").innerHTML = state.open && state.tab !== "scan" ? '<span class="dot" title="Offene Session"></span>' : "";
    $("#view-scan").hidden = state.tab !== "scan";
    $("#view-inv").hidden = state.tab !== "inv";
    $("#view-hist").hidden = state.tab !== "hist";
    $("#worth").textContent = state.loaded ? money(state.cards.reduce((s, c) => s + (num(c.priceEur) || 0) * (c.qty || 1), 0)) : "–";
    if (state.tab === "scan") renderScan();
    if (state.tab === "inv") renderInv();
    if (state.tab === "hist") renderHist();
  }

  function renderScan() {
    const v = $("#view-scan");
    if (state.problem) { v.innerHTML = `<div class="notice"><strong>Speicher nicht verfügbar.</strong><br>${esc(state.problem)}</div>`; return; }
    if (!state.loaded) { v.innerHTML = `<div class="notice">Wird geladen …</div>`; return; }
    const keyBanner = !settings.apiKey ? `<div class="banner"><span>Für die Erkennung per Foto brauchst du einen Anthropic-API-Schlüssel. Ohne Schlüssel kannst du Karten über die Suche hinzufügen.</span><button class="btn small" type="button" data-act="settings">Schlüssel eintragen</button></div>` : "";
    const down = state.marketDown ? `<div class="banner">${esc(state.marketDown)}</div>` : "";
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
      ${items.length ? `<ul class="list">${items.slice().reverse().map(rowHTML).join("")}</ul>` : `<div class="empty">Noch keine Karte in dieser Session. Tippe auf „Karte scannen“.</div>`}
      <div class="session-foot">
        <button class="btn primary" type="button" data-act="finish" ${ok.length && !pending ? "" : "disabled"}>${pending ? "Warte auf Erkennung …" : "Session abschließen"}</button>
        <button class="btn ghost danger" type="button" data-act="discard">Verwerfen</button>
      </div>
      ${errors && !pending ? `<p class="fine">Offene Scans werden beim Abschließen nicht übernommen.</p>` : ""}`;
  }

  function rowHTML(it) {
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
      <div class="chips">${c.rarity ? `<span class="chip">${esc(c.rarity)}</span>` : ""}${c.variant && c.variant !== "Normal" ? `<span class="chip">${esc(c.variant)}</span>` : ""}<span class="chip">${esc(c.condition || "NM")}</span>${lowConf ? '<span class="chip warn">unsicher – prüfen</span>' : ""}${c.market && c.market.ambiguous ? '<span class="chip warn">Set prüfen</span>' : ""}</div>
      ${noMarket && c.marketError ? `<div class="erractions"><span class="fine">${esc(c.marketError)}</span><button class="btn small" type="button" data-act="search-item" data-id="${esc(it.id)}">Karte suchen</button></div>` : ""}</div>
      <div class="px">${money(num(c.priceEur) === null ? null : c.priceEur * (it.qty || 1))}<small>${(it.qty || 1) > 1 ? `${it.qty} × ${money(c.priceEur)}` : esc(srcLabel(c))}</small></div></li>`;
  }

  function renderInv() {
    const cards = state.cards;
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
  function closeSheet() { state.sheet = null; $("#sheetRoot").innerHTML = ""; document.body.style.overflow = ""; }

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
    return `<div class="pricebox">${inner}<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn small" type="button" data-act="refresh-card" data-id="${esc(c.id)}" ${s.refreshing ? "disabled" : ""}>${s.refreshing ? "Rufe Preis ab …" : "Marktpreis aktualisieren"}</button><button class="btn small" type="button" data-act="search-card" data-id="${esc(c.id)}">Andere Karte zuordnen</button></div></div>`;
  }

  function renderSheet() {
    const s = state.sheet, root = $("#sheetRoot");
    if (!s) { root.innerHTML = ""; return; }
    document.body.style.overflow = "hidden";
    let title = "", body = "";
    if (s.type === "finish") {
      const ok = openItems().filter(i => i.status === "ok");
      const total = sessionTotal(ok), count = ok.reduce((a, i) => a + (i.qty || 1), 0);
      const ki = ok.filter(i => i.card.priceSource !== "markt" && i.card.priceSource !== "hand").length;
      title = "Session abschließen";
      body = `<div class="stack">
        <div class="endbetrag"><div class="eyebrow">Endbetrag dieser Session</div><div class="big">${money(total)}</div><div>${count} Karte${count === 1 ? "" : "n"}</div></div>
        <ul class="compact">${ok.map(i => `<li><span>${esc(i.card.name)}${(i.qty || 1) > 1 ? ` ×${i.qty}` : ""} <span class="muted">${esc(i.card.number || "")} · ${esc(srcLabel(i.card))}</span></span><span class="mono">${money(num(i.card.priceEur) === null ? null : i.card.priceEur * (i.qty || 1))}</span></li>`).join("")}</ul>
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
        ["Set", [c.set, c.setCode ? `(${c.setCode})` : ""].filter(Boolean).join(" ")],
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
          <button class="btn danger" type="button" data-act="${s.confirmDelete ? "delete-yes" : "delete"}" data-id="${esc(c.id)}">${s.confirmDelete ? "Wirklich löschen?" : "Löschen"}</button>
        </div>
      </div>`;
      if (c.imageId && !state.imgCache.has(c.imageId)) {
        DB.get("images", c.imageId).then(d => {
          if (!d) return; state.imgCache.set(c.imageId, d.data);
          const el = $("#bigImg"); if (el && state.sheet && state.sheet.id === c.id && state.sheet.img !== "official") el.src = d.data;
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
    } else if (s.type === "settings") {
      title = "Einstellungen";
      const key = settings.apiKey;
      body = `<div class="stack">
        <form class="edit" id="settingsForm">
          <label class="full">Anthropic-API-Schlüssel<input class="field mono" id="set-key" name="key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${key ? "gespeichert – zum Ändern neu eingeben" : "sk-ant-…"}"></label>
          <label class="full">Modell für die Erkennung<select class="field" id="set-model" name="model">${MODELS.map(([v, l]) => `<option value="${v}" ${v === settings.model ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          <p class="fine full" style="margin:0">Der Schlüssel wird nur im Browser dieses Geräts gespeichert und direkt an api.anthropic.com geschickt. Jeder Scan verbraucht API-Guthaben. Einen Schlüssel erstellst du in der <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Anthropic Console</a>. Tipp: Leg dort ein Ausgabelimit fest.</p>
          <button class="btn primary" type="submit">Speichern</button>
          <button class="btn danger" type="button" data-act="key-del" ${key ? "" : "disabled"}>Schlüssel löschen</button>
        </form>
        <div class="notice stack" style="gap:8px"><strong>Backup</strong>
          <span>Deine Daten liegen nur auf diesem Gerät. Sichere sie ab und zu, z. B. in iCloud Drive.</span>
          <div class="actions"><button class="btn" type="button" data-act="export">Backup speichern</button><button class="btn" type="button" data-act="import">Backup laden</button></div>
          <span class="fine" id="storageInfo"></span>
        </div>
        <p class="fine" style="margin:0">Preisdaten: <a href="https://tcgdex.dev" target="_blank" rel="noopener">TCGdex</a> (Cardmarket, täglich aktualisiert). Pokémon und Pokémon-Kartennamen sind Marken von Nintendo, Creatures und GAME FREAK; diese App ist ein privates Fanprojekt.</p>
      </div>`;
      if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(e => { const el = $("#storageInfo"); if (el && e.usage != null) el.textContent = `Belegter Speicher: ${(e.usage / 1048576).toFixed(1)} MB`; }).catch(() => {});
    }
    root.innerHTML = `<div class="scrim" data-act="scrim"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-head"><h2>${esc(title)}</h2><button class="x" type="button" data-act="close" aria-label="Schließen">×</button></div>${body}</div></div>`;
    const ef = $("#editForm"); if (ef) ef.onsubmit = e => { e.preventDefault(); saveEdit(ef); };
    const sf = $("#searchForm"); if (sf) sf.onsubmit = e => { e.preventDefault(); runSearch(sf); };
    const st = $("#settingsForm"); if (st) st.onsubmit = e => {
      e.preventDefault();
      const k = String(new FormData(st).get("key") || "").trim();
      if (k) settings.apiKey = k;
      settings.model = String(new FormData(st).get("model") || MODELS[0][0]);
      toast(k ? "Schlüssel gespeichert." : "Einstellungen gespeichert."); closeSheet(); render();
    };
  }

  // ---------- toast ----------
  let toastTimer;
  function toast(msg) {
    let t = $("#toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.setAttribute("role", "status");
      t.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:calc(var(--nav-h) + env(safe-area-inset-bottom,0px) + 14px);z-index:40;background:var(--ink);color:var(--bg);padding:10px 16px;border-radius:12px;font-size:14px;max-width:min(92vw,520px);box-shadow:var(--shadow)";
      document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4800);
  }

  // ---------- events ----------
  document.addEventListener("click", e => {
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
      case "cam-shot": shoot(); break;
      case "retry": retryItem(id); break;
      case "remove": removeItem(id); break;
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
      case "import": $("#importIn").click(); break;
    }
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { if (!$("#camera").hidden) { closeCamera(); render(); } else if (state.sheet) closeSheet(); }
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("li[data-act]")) { e.preventDefault(); e.target.click(); }
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
    const [cards, sessions, items] = await Promise.all([DB.all("cards"), DB.all("sessions"), DB.all("items")]);
    state.cards = cards; state.sessions = sessions; state.items = items;
    state.open = sessions.filter(s => s.status === "open").sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0] || null;
    // Scans that were still running when the app was closed can't finish any more.
    for (const it of items) if (it.status === "pending") await save("items", { ...it, status: it.card ? "ok" : "error", error: it.card ? null : "Die Erkennung wurde unterbrochen. Tippe auf „Erneut erkennen“." });
    state.loaded = true;
  }
  render();
  if (!("indexedDB" in window)) { state.problem = "Dein Browser unterstützt keinen lokalen Speicher."; render(); }
  else loadAll().then(render).catch(() => { state.problem = "Der lokale Speicher ließ sich nicht öffnen. Im privaten Modus funktioniert die App nicht."; render(); });

  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
