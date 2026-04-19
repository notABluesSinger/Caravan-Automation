const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  TARGETS,
  extractScripts,
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
    "7"
  );
});

test("findScriptIdByName returns null when no script matches", function () {
  assert.equal(
    findScriptIdByName({ scripts: [{ id: 7, name: "different.js" }] }, "toiletLight.js"),
    null
  );
});

test("README documents name-based lookup and explicit slot override", function () {
  const readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");

  assert.match(readme, /looks up the script on the device by name/i);
  assert.match(readme, /npm run deploy:toilet-light -- 192\.168\.1\.50\n/);
  assert.match(readme, /To override the slot explicitly:/);
});
