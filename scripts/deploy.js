#!/usr/bin/env node

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const TARGETS = {
  "toilet-light": "src/shelly/toiletLight.js"
};

function getTargetPath(targetName) {
  return TARGETS[targetName] || null;
}

function getTargetScriptName(targetPath) {
  return path.basename(targetPath);
}

function extractScripts(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.scripts)) return payload.scripts;
  if (payload && payload.result && Array.isArray(payload.result.scripts)) return payload.result.scripts;
  return [];
}

function findScriptIdByName(payload, scriptName) {
  const scripts = extractScripts(payload);
  const match = scripts.find(function (script) {
    return script && script.name === scriptName;
  });

  return match && match.id !== undefined ? match.id : null;
}

async function fetchScriptList(host) {
  // Shelly devices only expose their local RPC API over plain HTTP.
  // eslint-disable-next-line sonarjs/no-clear-text-protocols
  const response = await fetch("http://" + host + "/rpc/Script.List", {
    signal: AbortSignal.timeout(5000)
  });

  if (!response.ok) {
    throw new Error("Script.List failed with HTTP " + response.status);
  }

  return response.json();
}

function printUsage() {
  console.error("Usage: node ./scripts/deploy.js <target-name> <device-ip> [script-slot-id]");
  console.error("");
  console.error("Available targets:");
  Object.keys(TARGETS).forEach(function (name) {
    console.error("  - " + name + " -> " + TARGETS[name]);
  });
  console.error("");
  console.error("If script-slot-id is omitted, the device is queried for a script whose name matches the target file.");
}

async function resolveScriptId(host, targetPath, explicitScriptId) {
  if (explicitScriptId !== undefined) {
    const parsed = Number(explicitScriptId);
    if (!Number.isInteger(parsed)) {
      throw new Error("Script slot id must be an integer, got: " + explicitScriptId);
    }
    console.log("Using explicit script slot " + parsed + " for " + targetPath);
    return parsed;
  }

  const scriptName = getTargetScriptName(targetPath);
  console.log("Looking up Shelly script named '" + scriptName + "' on " + host);
  const payload = await fetchScriptList(host);
  const scriptId = findScriptIdByName(payload, scriptName);

  if (scriptId === null) {
    throw new Error("Could not find a Shelly script named '" + scriptName + "' on " + host);
  }

  console.log("Resolved script '" + scriptName + "' to slot " + scriptId);
  return scriptId;
}

async function run() {
  const [targetName, host, explicitScriptId] = process.argv.slice(2);
  const targetPath = getTargetPath(targetName);

  if (!targetPath || !host) {
    printUsage();
    process.exit(1);
  }

  const scriptId = await resolveScriptId(host, targetPath, explicitScriptId);

  console.log("Deploying " + targetPath + " to " + host + " using slot " + scriptId);

  const result = spawnSync(
    // Resolve python3 via PATH so contributors can use whichever interpreter they have installed.
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    "python3",
    [
      path.join(__dirname, "put_script.py"),
      host,
      String(scriptId),
      targetPath
    ],
    { stdio: "inherit" }
  );

  if (result.error) {
    throw result.error;
  }

  process.exit(result.status === null ? 1 : result.status);
}

if (require.main === module) {
  run().catch(function (error) {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  TARGETS,
  extractScripts,
  findScriptIdByName,
  getTargetPath,
  getTargetScriptName
};
