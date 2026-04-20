var CONFIG = {
  debug: false,
  inputs: {
    "0": {
      name: "PIR",
      events: {
        "btn_down": {
          type: "action",
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
        "single_push": {
          type: "pir-toggle"
        },
        "long_push": {
          type: "action",
          mode: "manual",
          desiredBrightnessLevel: "full",
          turnLightOffAfter: null,
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
          type: "action",
          mode: "manual",
          desiredBrightnessLevel: "day",
          turnLightOffAfter: null,
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
  pirEnabled: true
};

var MAPPING = {
  inputHandlers: {}
};

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

function getOutputIdByRole(role) {
  var outputId;
  for (outputId in CONFIG.outputs) {
    if (CONFIG.outputs[outputId].active && CONFIG.outputs[outputId].role === role) {
      return Number(outputId);
    }
  }
  return null;
}

function getLightOutputId() {
  return getOutputIdByRole("main");
}

function getPirIndicatorOutputId() {
  return getOutputIdByRole("pirIndicator");
}

function setPirIndicator(on) {
  var id = getPirIndicatorOutputId();
  if (id === null) return;
  var params = { id: id, on: on };
  if (on) {
    var brightness = CONFIG.outputs[String(id)].brightness;
    if (isDefined(brightness)) params.brightness = brightness;
  }
  Shelly.call("Light.Set", params);
}

function syncPirIndicator() {
  setPirIndicator(STATE.pirEnabled);
}

function flashPirIndicator() {
  setPirIndicator(true);
  Timer.set(300, false, syncPirIndicator);
}

function getLightStatus() {
  var lightId = getLightOutputId();
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

// If no sensor is configured, or its reading is unavailable, fail open
// (treat as dark) so a broken/missing sensor never blocks manual control
// being gated on darkness. Callers that truly require darkness still get
// it when the sensor reports a reading above threshold.
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
  setLightState(false, null, null);
  setLightState(true, brightness, null);
}

function syncModeWithLightStatus(lightStatus) {
  if (!lightStatus || !lightStatus.output) {
    STATE.currentLightMode = null;
  }
}

function setCurrentLightMode(mode) {
  STATE.currentLightMode = mode || null;
}

function setLightState(on, brightness, autoOffSeconds) {
  var lightId = getLightOutputId();
  var params;

  if (lightId === null) {
    log("No active light output configured");
    return;
  }

  params = {
    id: lightId,
    on: on
  };

  if (on && isDefined(brightness)) {
    params.brightness = brightness;
  }

  if (on && isDefined(autoOffSeconds)) {
    params.toggle_after = autoOffSeconds;
  }

  Shelly.call("Light.Set", params);
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

  if (event.component.substring(0, 6) === "input:" && inputConfig) {
    log("Event from " + inputConfig.name + " with event: " + eventName);
    return;
  }

  log("Event from component: " + event.component + " with event: " + eventName);
}

function handleAlreadyAtRequestedBrightness(inputConfig, brightness) {
  if (inputConfig.toggleOffIfAlreadySet) {
    log(inputConfig.name + ": already at requested brightness, turning off");
    setLightState(false, null, null);
    return;
  }

  if (isDefined(inputConfig.turnLightOffAfter)) {
    log(inputConfig.name + ": resetting timer at " + brightness + "%");
    setLightState(true, brightness, inputConfig.turnLightOffAfter);
    return;
  }

  log(inputConfig.name + ": no action needed");
}

function shouldSkipAction(inputConfig, lightStatus) {
  if (inputConfig.mode === "pir" && !STATE.pirEnabled) {
    log(inputConfig.name + ": ignored, PIR is disabled");
    flashPirIndicator();
    return true;
  }

  if (!lightStatus) {
    log("Light status unavailable");
    return true;
  }

  if (isBlockedByDaylight(inputConfig, lightStatus)) {
    log(inputConfig.name + ": ignored, not dark enough to turn light on");
    return true;
  }

  return false;
}

function performAction(inputConfig, brightness, lightStatus) {
  var pirActive = isPirModeActive(lightStatus);

  if (!lightStatus.output) {
    log(inputConfig.name + ": light off, turning on to " + brightness + "%");
    setCurrentLightMode(inputConfig.mode);
    setLightState(true, brightness, inputConfig.turnLightOffAfter);
    return;
  }

  if (inputConfig.onlyWhenOffOrPirMode && !pirActive) {
    log(inputConfig.name + ": ignored, manual mode already active");
    return;
  }

  if (pirActive && inputConfig.canOverridePir) {
    log(inputConfig.name + ": overriding PIR mode to " + brightness + "% and clearing timer");
    setCurrentLightMode(inputConfig.mode);
    restartLightWithoutTimer(brightness);
    return;
  }

  if (lightStatus.brightness === brightness) {
    handleAlreadyAtRequestedBrightness(inputConfig, brightness);
    return;
  }

  log(inputConfig.name + ": setting brightness to " + brightness + "%");
  setCurrentLightMode(inputConfig.mode);
  setLightState(true, brightness, inputConfig.turnLightOffAfter);
}

function handleAction(inputConfig) {
  var lightStatus = getLightStatus();
  var brightness = getBrightness(inputConfig.desiredBrightnessLevel);

  if (shouldSkipAction(inputConfig, lightStatus)) return;
  syncModeWithLightStatus(lightStatus);
  performAction(inputConfig, brightness, lightStatus);
}

function handleTogglePir(inputConfig) {
  STATE.pirEnabled = !STATE.pirEnabled;
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

function dispatchInputEvent(event) {
  if (event.component.substring(0, 6) !== "input:") return;
  if (!event.info || !event.info.event) return;

  var inputId = getInputId(event.component);
  if (inputId === null) return;

  var inputConfig = getInputConfig(inputId);
  var eventConfig = getInputEventConfig(inputConfig, event.info.event);
  if (!eventConfig) return;

  var handler = MAPPING.inputHandlers[eventConfig.type];
  if (handler) handler(buildEffectiveConfig(inputConfig, eventConfig));
}

MAPPING.inputHandlers["action"] = handleAction;
MAPPING.inputHandlers["pir-toggle"] = handleTogglePir;

Shelly.addEventHandler(function (event) {
  identifyEvent(event);
  dispatchInputEvent(event);
});

syncPirIndicator();
