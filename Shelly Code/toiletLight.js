var CONFIG = {
  debug: false,
  inputs: {
    "0": {
      name: "PIR",
      type: "action",
      eventType: "btn_down",
      desiredBrightnessLevel: "night",
      turnLightOffAfter: 300,
      requiresDarkness: true,
      canOverridePir: false,
      toggleOffIfAlreadySet: false,
      onlyWhenOffOrPirMode: true
    },
    "1": {
      name: "Push Button",
      type: "action",
      eventType: "btn_down",
      desiredBrightnessLevel: "full",
      turnLightOffAfter: null,
      requiresDarkness: false,
      canOverridePir: true,
      toggleOffIfAlreadySet: true,
      onlyWhenOffOrPirMode: false
    },
    "2": {
      name: "Touch Button",
      type: "action",
      eventType: "toggle",
      desiredBrightnessLevel: "day",
      turnLightOffAfter: null,
      requiresDarkness: false,
      canOverridePir: true,
      toggleOffIfAlreadySet: true,
      onlyWhenOffOrPirMode: false
    },
    "3": {
      name: "Light Sensor",
      type: "measure",
      threshold: 50
    }
  },
  outputs: {
    "3": {
      active: true,
      name: "Lights",
      type: "light"
    }
  },
  brightnessLevels: {
    night: 20,
    day: 60,
    full: 100
  }
};

function log(message) {
  if (!CONFIG.debug) return;
  print(message);
}

function getInputId(component) {
  var parts = component.split(":");
  return parts.length > 1 ? parts[1] : null;
}

function getInputConfig(inputId) {
  return CONFIG.inputs[inputId];
}

function getActiveOutputId(type) {
  var outputId;
  for (outputId in CONFIG.outputs) {
    if (CONFIG.outputs[outputId].active && CONFIG.outputs[outputId].type === type) {
      return Number(outputId);
    }
  }
  return null;
}

function getLightOutputId() {
  return getActiveOutputId("light");
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

  if (on && brightness !== null && brightness !== undefined) {
    params.brightness = brightness;
  }

  if (on && autoOffSeconds !== null && autoOffSeconds !== undefined) {
    params.toggle_after = autoOffSeconds;
  }

  Shelly.call("Light.Set", params);
}

function isPirModeActive(lightStatus) {
  if (!lightStatus) return false;
  return lightStatus.output && lightStatus.brightness === getBrightness("night");
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

function handleAction(inputConfig) {
  var lightStatus = getLightStatus();
  var brightness = getBrightness(inputConfig.desiredBrightnessLevel);
  var pirActive;
  var alreadyAtRequestedBrightness;

  if (!lightStatus) {
    log("Light status unavailable");
    return;
  }
  if (inputConfig.requiresDarkness && !lightStatus.output && !isDarkEnough()) {
    log(inputConfig.name + ": ignored, not dark enough to turn light on");
    return;
  }

  pirActive = isPirModeActive(lightStatus);
  alreadyAtRequestedBrightness = lightStatus.output && lightStatus.brightness === brightness;

  if (!lightStatus.output) {
    log(inputConfig.name + ": light off, turning on to " + brightness + "%");
    setLightState(true, brightness, inputConfig.turnLightOffAfter);
    return;
  }

  if (inputConfig.onlyWhenOffOrPirMode && !pirActive) {
    log(inputConfig.name + ": ignored, manual mode already active");
    return;
  }

  if (pirActive && inputConfig.canOverridePir) {
    log(inputConfig.name + ": overriding PIR mode to " + brightness + "% and clearing timer");
    restartLightWithoutTimer(brightness);
    return;
  }

  if (alreadyAtRequestedBrightness) {
    if (inputConfig.toggleOffIfAlreadySet) {
      log(inputConfig.name + ": already at requested brightness, turning off");
      setLightState(false, null, null);
      return;
    }

    if (inputConfig.turnLightOffAfter !== null && inputConfig.turnLightOffAfter !== undefined) {
      log(inputConfig.name + ": resetting timer at " + brightness + "%");
      setLightState(true, brightness, inputConfig.turnLightOffAfter);
      return;
    }

    log(inputConfig.name + ": no action needed");
    return;
  }

  log(inputConfig.name + ": setting brightness to " + brightness + "%");
  setLightState(true, brightness, inputConfig.turnLightOffAfter);

}

Shelly.addEventHandler(function (event) {
  var inputId;
  var inputConfig;

  identifyEvent(event);

  if (event.component.substring(0, 6) !== "input:") return;
  if (!event.info || !event.info.event) return;

  inputId = getInputId(event.component);
  if (inputId === null) return;
  inputConfig = getInputConfig(inputId);

  if (!inputConfig || inputConfig.type !== "action") return;
  if (event.info.event !== inputConfig.eventType) return;

  handleAction(inputConfig);
});