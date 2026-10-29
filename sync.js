// Sync rules shared by app.js and the tests (test/sync.test.js).

// Merges what the server sent into the list on this device. ids = every id on the server (delta sync),
// or null when rows is the complete table. Returns the new list and the ids the server no longer has.
function mergeDelta(local, rows, ids) {
  const alive = new Set(ids || rows.map(o => o.id));
  const byId = new Map(ids ? local.filter(o => alive.has(o.id)).map(o => [o.id, o]) : []);
  rows.forEach(o => byId.set(o.id, o));
  return { list: [...byId.values()], gone: local.filter(o => !alive.has(o.id)).map(o => o.id) };
}

// Safety net: if the server suddenly has nothing, or far fewer entries than would disappear here,
// keep the device copy (it can be restored in the admin area) instead of wiping it.
const suspiciousLoss = (gone, serverCount) => gone > 0 && (serverCount === 0 || (gone >= 10 && gone > serverCount));

const KSSync = { mergeDelta, suspiciousLoss };
if (typeof module === "object") module.exports = KSSync;
