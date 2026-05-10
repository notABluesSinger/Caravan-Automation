var CONFIG = {
  debug: false,
  inputs: {
    "0": {
      name: "PIR",
      events: {
        "btn_down": {
          eventHandler: "applyInputAction",
          mode: "pir",
          desiredBrightnessLevel: "night",
          turnLightOffAfter: 300,
          requiresDarkness: true,
          canOverridePir: false,
          toggleOffIfAlreadySet: false,
          onlyWhenOffOrPirMode: true
        }
      }
    },
    "1": {
      name: "Push Button",
      events: {
        "long_push": {
          eventHandler: "togglePirEnabled"
        },
        "single_push": {
          eventHandler: "applyButtonAction",
          mode: "manual",
          desiredBrightnessLevel: "full",
          turnLightOffAfter: null,
          linkedRoles: ["secondary"],
          linkedOutputMode: "follow",
          requiresDarkness: false,
          canOverridePir: true,
          toggleOffIfAlreadySet: true,
          onlyWhenOffOrPirMode: false
        }
      }
    },
    "2": {
      name: "Touch Button",
      events: {
        "toggle": {
          eventHandler: "applyButtonAction",
          mode: "manual",
          desiredBrightnessLevel: "day",
          turnLightOffAfter: null,
          linkedRoles: ["secondary"],
          linkedOutputMode: "off_only",
          requiresDarkness: false,
          canOverridePir: true,
          toggleOffIfAlreadySet: true,
          onlyWhenOffOrPirMode: false
        }
      }
    },
    "3": {
      name: "Light Sensor",
      type: "measure",
      threshold: 50
    }
  },
  outputs: {
    "0": {
      active: true,
      name: "Lights",
      type: "light",
      role: "main"
    },
    "1": {
      active: true,
      name: "PIR Indicator",
      type: "light",
      role: "pirIndicator",
      brightness: 100
    },
    "2": {
      active: true,
      name: "Secondary Light",
      type: "light",
      role: "secondary",
      brightness: 100
    }
  },
  brightnessLevels: {
    night: 25,
    day: 75,
    full: 100
  }
};

var STATE = {
  currentLightMode: null,
  pirEnabled: true,
  pulseTimer: null
};

var OUTPUTS_BY_ROLE = {};
var CONFIG_VALID = false;

function log(message) {
  if (!CONFIG.debug) return;
  print(message);
}

function isDefined(value) {
  return value !== null && value !== undefined;
}

function getInputId(component) {
  var parts = component.split(":");
  return parts.length > 1 ? parts[1] : null;
}

function getInputConfig(inputId) {
  return CONFIG.inputs[inputId];
}

function buildOutputsByRole() {
  var outputsByRole = {};
  var outputId;
  var outputConfig;

  for (outputId in CONFIG.outputs) {
    outputConfig = CONFIG.outputs[outputId];
    if (!outputConfig.active || !outputConfig.role) continue;
    outputsByRole[outputConfig.role] = {
      id: Number(outputId),
      config: outputConfig
    };
  }

  return outputsByRole;
}

function getOutputByRole(role) {
  return OUTPUTS_BY_ROLE[role] || null;
}

function getOutputIdByRole(role) {
  var output = getOutputByRole(role);
  return output ? output.id : null;
}

function getOutputConfigByRole(role) {
  var output = getOutputByRole(role);
  return output ? output.config : null;
}

function getScriptStorage() {
  if (typeof Script === "undefined") return null;
  if (!Script.storage) return null;
  return Script.storage;
}

function buildLightParams(id, on, brightness, autoOffSeconds) {
  var params = {
    id: id,
    on: on
  };

  if (on && isDefined(brightness)) {
    params.brightness = brightness;
  }

  if (on && isDefined(autoOffSeconds)) {
    params.toggle_after = autoOffSeconds;
  }

  return params;
}

function setOutputRoleState(role, on, brightness, autoOffSeconds) {
  var outputId = getOutputIdByRole(role);
  if (outputId === null) {
    log("No active " + role + " output configured");
    return;
  }
  Shelly.call("Light.Set", buildLightParams(outputId, on, brightness, autoOffSeconds));
}

function syncPirIndicator() {
  var outputConfig = getOutputConfigByRole("pirIndicator");
  setOutputRoleState("pirIndicator", STATE.pirEnabled, outputConfig && outputConfig.brightness, null);
}

function pulsePirIndicator() {
  var outputConfig = getOutputConfigByRole("pirIndicator");
  if (STATE.pulseTimer) {
    Timer.clear(STATE.pulseTimer);
    STATE.pulseTimer = null;
  }
  setOutputRoleState("pirIndicator", false, outputConfig && outputConfig.brightness, null);
  STATE.pulseTimer = Timer.set(300, false, function () {
    STATE.pulseTimer = null;
    syncPirIndicator();
  });
}

function getLightStatus() {
  var lightId = getOutputIdByRole("main");
  if (lightId === null) return null;
  return Shelly.getComponentStatus("light:" + lightId);
}

function getBrightness(levelName) {
  return CONFIG.brightnessLevels[levelName];
}

function getSensorInputId() {
  var inputId;
  for (inputId in CONFIG.inputs) {
    if (CONFIG.inputs[inputId].type === "measure") {
      return inputId;
    }
  }
  return null;
}

function getSensorValue(inputId) {
  var status = Shelly.getComponentStatus("input:" + inputId);
  if (!status) return null;
  if (status.percent !== undefined) return status.percent;
  if (status.value !== undefined) return status.value;
  return null;
}

function isDarkEnough() {
  var sensorId = getSensorInputId();
  var sensorConfig = sensorId ? CONFIG.inputs[sensorId] : null;
  var value;
  if (!sensorConfig) return true;

  value = getSensorValue(sensorId);
  if (value === null) {
    log("Light sensor value unavailable, assuming dark");
    return true;
  }
  log("Light sensor: " + value);
  return value <= sensorConfig.threshold;
}

function restartLightWithoutTimer(brightness) {
  setOutputRoleState("main", false, null, null);
  setOutputRoleState("main", true, brightness, null);
}

function clearModeIfLightOff(lightStatus) {
  if (!lightStatus || !lightStatus.output) {
    STATE.currentLightMode = null;
  }
}

function setCurrentLightMode(mode) {
  STATE.currentLightMode = mode || null;
}

function isPirModeActive(lightStatus) {
  return !!(lightStatus && lightStatus.output && STATE.currentLightMode === "pir");
}

function isBlockedByDaylight(inputConfig, lightStatus) {
  if (!inputConfig.requiresDarkness) return false;
  if (lightStatus.output) return false;
  return !isDarkEnough();
}

function identifyEvent(event) {
  var eventName = event.info && event.info.event ? event.info.event : "unknown";
  var inputId = getInputId(event.component);
  var inputConfig = inputId !== null ? getInputConfig(inputId) : null;

  if (event.component.substring(0, 6) !== "input:" || !inputConfig) {
    log("Event from component: " + event.component + " with event: " + eventName);
    return;
  }

  log("Event from " + inputConfig.name + " with event: " + eventName);
}

function handleMatchingBrightness(inputConfig, brightness) {
  if (inputConfig.toggleOffIfAlreadySet) {
    log(inputConfig.name + ": already at requested brightness, turning off");
    setOutputRoleState("main", false, null, null);
    return "turned_off";
  }

  if (isDefined(inputConfig.turnLightOffAfter)) {
    log(inputConfig.name + ": resetting timer at " + brightness + "%");
    setOutputRoleState("main", true, brightness, inputConfig.turnLightOffAfter);
    return "kept_on";
  }

  log(inputConfig.name + ": no action needed");
  return "no_change";
}

function shouldSkipAction(inputConfig, lightStatus) {
  if (inputConfig.mode === "pir" && !STATE.pirEnabled) {
    log(inputConfig.name + ": ignored, PIR is disabled");
    return true;
  }

  if (!lightStatus) {
    log("Light status unavailable");
    return true;
  }

  if (isBlockedByDaylight(inputConfig, lightStatus)) {
    log(inputConfig.name + ": ignored, not dark enough to turn light on");
    pulsePirIndicator();
    return true;
  }

  return false;
}

function applyMainLightAction(inputConfig, brightness, lightStatus) {
  var pirActive = isPirModeActive(lightStatus);

  if (!lightStatus.output) {
    log(inputConfig.name + ": light off, turning on to " + brightness + "%");
    setCurrentLightMode(inputConfig.mode);
    setOutputRoleState("main", true, brightness, inputConfig.turnLightOffAfter);
    return "turned_on";
  }

  if (inputConfig.onlyWhenOffOrPirMode && !pirActive) {
    log(inputConfig.name + ": ignored, manual mode already active");
    return "no_change";
  }

  if (pirActive && inputConfig.canOverridePir) {
    log(inputConfig.name + ": overriding PIR mode to " + brightness + "% and clearing timer");
    setCurrentLightMode(inputConfig.mode);
    restartLightWithoutTimer(brightness);
    return "turned_on";
  }

  if (lightStatus.brightness === brightness) {
    return handleMatchingBrightness(inputConfig, brightness);
  }

  log(inputConfig.name + ": setting brightness to " + brightness + "%");
  setCurrentLightMode(inputConfig.mode);
  setOutputRoleState("main", true, brightness, inputConfig.turnLightOffAfter);
  return "turned_on";
}

function applyInputAction(inputConfig) {
  var lightStatus = getLightStatus();
  var brightness = getBrightness(inputConfig.desiredBrightnessLevel);

  if (shouldSkipAction(inputConfig, lightStatus)) return;
  clearModeIfLightOff(lightStatus);
  applyMainLightAction(inputConfig, brightness, lightStatus);
}

function togglePirEnabled(inputConfig) {
  STATE.pirEnabled = !STATE.pirEnabled;
  persistPirEnabledState();
  log(inputConfig.name + ": PIR " + (STATE.pirEnabled ? "enabled" : "disabled"));
  syncPirIndicator();
}

function buildEffectiveConfig(inputConfig, eventConfig) {
  var merged = { name: inputConfig.name };
  var key;
  for (key in eventConfig) {
    merged[key] = eventConfig[key];
  }
  return merged;
}

function getInputEventConfig(inputConfig, eventName) {
  if (!inputConfig || !inputConfig.events) return null;
  return inputConfig.events[eventName] || null;
}

function getLinkedOutputState(actionResult, linkedOutputMode) {
  if (actionResult === "no_change") return null;
  if (actionResult === "turned_off") return false;
  if (linkedOutputMode === "off_only") return null;
  return true;
}

function syncLinkedOutputs(linkedRoles, on) {
  var linkedRoleIndex;
  var linkedRole;
  var linkedOutputConfig;
  var linkedBrightness;

  for (linkedRoleIndex = 0; linkedRoleIndex < linkedRoles.length; linkedRoleIndex++) {
    linkedRole = linkedRoles[linkedRoleIndex];
    linkedOutputConfig = getOutputConfigByRole(linkedRole);
    linkedBrightness = linkedOutputConfig && linkedOutputConfig.brightness;
    setOutputRoleState(linkedRole, on, linkedBrightness, null);
  }
}

function applyButtonAction(inputConfig) {
  var lightStatus = getLightStatus();
  var brightness = getBrightness(inputConfig.desiredBrightnessLevel);
  var actionResult;
  var linkedRoles;
  var linkedOutputState;

  if (shouldSkipAction(inputConfig, lightStatus)) return;
  clearModeIfLightOff(lightStatus);
  actionResult = applyMainLightAction(inputConfig, brightness, lightStatus);
  linkedRoles = inputConfig.linkedRoles || [];
  linkedOutputState = getLinkedOutputState(actionResult, inputConfig.linkedOutputMode);

  if (!linkedRoles.length || !isDefined(linkedOutputState)) return;
  syncLinkedOutputs(linkedRoles, linkedOutputState);
}

function loadPirEnabledState() {
  var storedValue;
  var storage = getScriptStorage();
  if (!storage || !storage.getItem) return true;

  storedValue = storage.getItem("pirEnabled");
  if (storedValue === "false") return false;
  if (storedValue === "true") return true;
  return true;
}

function persistPirEnabledState() {
  var storage = getScriptStorage();
  if (!storage || !storage.setItem) return;
  storage.setItem("pirEnabled", STATE.pirEnabled ? "true" : "false");
}

function validateConfig() {
  if (getOutputByRole("main")) return true;
  print("Config error: missing required active output role 'main'");
  return false;
}

function initialize() {
  OUTPUTS_BY_ROLE = buildOutputsByRole();
  CONFIG_VALID = validateConfig();
  STATE.pirEnabled = loadPirEnabledState();
  if (!CONFIG_VALID) return;
  syncPirIndicator();
}

var EVENT_HANDLERS = {
  applyInputAction: applyInputAction,
  togglePirEnabled: togglePirEnabled,
  applyButtonAction: applyButtonAction
};

function isInputEvent(event) {
  if (event.component.substring(0, 6) !== "input:") return false;
  if (!event.info) return false;
  return !!event.info.event;
}

function getEventHandler(eventConfig) {
  if (!eventConfig || !eventConfig.eventHandler) return null;
  return EVENT_HANDLERS[eventConfig.eventHandler] || null;
}

function dispatchInputEvent(event) {
  var eventConfig;
  var eventHandler;
  var inputId;
  var inputConfig;

  if (!CONFIG_VALID) return;
  if (!isInputEvent(event)) return;

  inputId = getInputId(event.component);
  if (inputId === null) return;

  inputConfig = getInputConfig(inputId);
  eventConfig = getInputEventConfig(inputConfig, event.info.event);
  eventHandler = getEventHandler(eventConfig);
  if (!eventHandler) return;
  eventHandler(buildEffectiveConfig(inputConfig, eventConfig));
}

Shelly.addEventHandler(function (event) {
  identifyEvent(event);
  dispatchInputEvent(event);
});

initialize();
