const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TARGETS,
  extractScripts,
  findFirstUnusedSlot,
  findScriptIdByName,
  getTargetPath,
  getTargetScriptName
} = require("../scripts/deploy.js");

test("named deploy targets include toilet-light", function () {
  assert.equal(TARGETS["toilet-light"], "src/shelly/toiletLight.js");
  assert.equal(getTargetPath("toilet-light"), "src/shelly/toiletLight.js");
});

test("unknown deploy targets return null", function () {
  assert.equal(getTargetPath("missing-target"), null);
});

test("target script names come from the target file basename", function () {
  assert.equal(getTargetScriptName("src/shelly/toiletLight.js"), "toiletLight.js");
});

test("extractScripts accepts a bare script array", function () {
  const scripts = [{ id: 1, name: "toiletLight.js" }];

  assert.deepEqual(extractScripts(scripts), scripts);
});

test("extractScripts accepts Script.List object shapes", function () {
  assert.deepEqual(
    extractScripts({ scripts: [{ id: 1, name: "toiletLight.js" }] }),
    [{ id: 1, name: "toiletLight.js" }]
  );

  assert.deepEqual(
    extractScripts({ result: { scripts: [{ id: 2, name: "other.js" }] } }),
    [{ id: 2, name: "other.js" }]
  );
});

test("findScriptIdByName returns the matching script id", function () {
  assert.equal(
    findScriptIdByName({ scripts: [{ id: 7, name: "toiletLight.js" }] }, "toiletLight.js"),
    7
  );
});

test("findScriptIdByName returns null when no script matches", function () {
  assert.equal(
    findScriptIdByName({ scripts: [{ id: 7, name: "different.js" }] }, "toiletLight.js"),
    null
  );
});

test("findFirstUnusedSlot returns 1 when no scripts exist", function () {
  assert.equal(findFirstUnusedSlot({ scripts: [] }), 1);
});

test("findFirstUnusedSlot fills the lowest gap in existing IDs", function () {
  assert.equal(findFirstUnusedSlot({ scripts: [{ id: 1 }, { id: 2 }, { id: 4 }] }), 3);
});

test("findFirstUnusedSlot returns the next slot after a contiguous run", function () {
  assert.equal(findFirstUnusedSlot({ scripts: [{ id: 1 }, { id: 2 }, { id: 3 }] }), 4);
});
