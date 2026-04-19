#!/usr/bin/env node

const path = require("node:path");
const http = require("node:http");
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

  return match && match.id !== undefined ? String(match.id) : null;
}

function fetchScriptList(host) {
  return new Promise(function (resolve, reject) {
    const request = http.get("http://" + host + "/rpc/Script.List", function (response) {
      let body = "";

      response.setEncoding("utf8");
      response.on("data", function (chunk) {
        body += chunk;
      });
      response.on("end", function () {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error("Script.List failed with HTTP " + response.statusCode));
          return;
        }

        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error("Failed to parse Script.List response: " + error.message));
        }
      });
    });

    request.on("error", function (error) {
      reject(new Error("Failed to reach Shelly device: " + error.message));
    });
    request.setTimeout(5000, function () {
      request.destroy(new Error("Timed out calling Script.List"));
    });
  });
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
  if (explicitScriptId) {
    console.error("Using explicit script slot " + explicitScriptId + " for " + targetPath);
    return explicitScriptId;
  }

  const scriptName = getTargetScriptName(targetPath);
  console.error("Looking up Shelly script named '" + scriptName + "' on " + host);
  const payload = await fetchScriptList(host);
  const scriptId = findScriptIdByName(payload, scriptName);

  if (!scriptId) {
    throw new Error("Could not find a Shelly script named '" + scriptName + "' on " + host);
  }

  console.error("Resolved script '" + scriptName + "' to slot " + scriptId);
  return scriptId;
}

async function run() {
  const [targetName, host, explicitScriptId] = process.argv.slice(2);
  const targetPath = getTargetPath(targetName);

  if (!targetPath || !host) {
    printUsage();
    process.exit(1);
  }

  let scriptId;
  try {
    scriptId = await resolveScriptId(host, targetPath, explicitScriptId);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  console.error("Deploying " + targetPath + " to " + host + " using slot " + scriptId);

  const result = spawnSync(
    "python3",
    [
      path.join(__dirname, "put_script.py"),
      host,
      scriptId,
      targetPath
    ],
    { stdio: "inherit" }
  );

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  process.exit(result.status === null ? 1 : result.status);
}

if (require.main === module) {
  run();
}

module.exports = {
  TARGETS,
  extractScripts,
  findScriptIdByName,
  getTargetPath,
  getTargetScriptName
};
