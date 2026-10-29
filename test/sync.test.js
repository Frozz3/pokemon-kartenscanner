const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeDelta, suspiciousLoss } = require("../sync.js");

const ids = list => list.map(o => o.id);

test("delta sync: changed rows replace, new rows join, deleted rows go", () => {
  const local = [{ id: "a", v: 1 }, { id: "b", v: 1 }, { id: "c", v: 1 }];
  const { list, gone } = mergeDelta(local, [{ id: "b", v: 2 }, { id: "d", v: 1 }], ["a", "b", "d"]);
  assert.deepEqual(ids(list), ["a", "b", "d"]);
  assert.equal(list.find(o => o.id === "b").v, 2);
  assert.deepEqual(gone, ["c"]);
});

test("full sync: the server list wins", () => {
  const { list, gone } = mergeDelta([{ id: "a" }, { id: "x" }], [{ id: "a", v: 3 }, { id: "b" }], null);
  assert.deepEqual(ids(list), ["a", "b"]);
  assert.equal(list[0].v, 3);
  assert.deepEqual(gone, ["x"]);
});

test("safety net keeps the device copy only on suspicious losses", () => {
  assert.equal(suspiciousLoss(0, 0), false);
  assert.equal(suspiciousLoss(3, 0), true);     // server empty
  assert.equal(suspiciousLoss(90, 10), true);   // 90 of 100 would vanish
  assert.equal(suspiciousLoss(5, 1), false);    // small clean-ups still go through
  assert.equal(suspiciousLoss(20, 80), false);  // normal deletion
});
