const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createLightStatus(params, currentStatus) {
  return {
    output: !!params.on,
    brightness: params.brightness !== undefined ? params.brightness : currentStatus && currentStatus.brightness
  };
}

function createHarness(initialLightStatus, initialSecondaryLightStatus, sensorStatus, initialPirEnabled) {
  let eventHandler = null;
  const calls = [];
  const startupCalls = [];
  const scheduledTimers = [];
  let nextTimerId = 1;
  const storage = {};
  let tracking = startupCalls;
  let lightStatus = initialLightStatus;
  let secondaryLightStatus = initialSecondaryLightStatus;
  const sensor = sensorStatus;

  if (typeof initialPirEnabled === "boolean") {
    storage.pirEnabled = initialPirEnabled ? "true" : "false";
  }

  const context = {
    print: function () {},
    Shelly: {
      addEventHandler: function (handler) {
        eventHandler = handler;
      },
      getComponentStatus: function (component) {
        if (component === "light:0") return lightStatus;
        if (component === "light:2") return secondaryLightStatus;
        if (component === "input:3") return sensor;
        return null;
      },
      call: function (method, params) {
        tracking.push({ method: method, params: params });

        if (method !== "Light.Set") return;
        if (params.id === 0) {
          lightStatus = createLightStatus(params, lightStatus);
          return;
        }
        if (params.id === 2) {
          secondaryLightStatus = createLightStatus(params, secondaryLightStatus);
        }
      }
    },
    Script: {
      storage: {
        getItem: function (key) {
          return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null;
        },
        setItem: function (key, value) {
          storage[key] = value;
        }
      }
    },
    Timer: {
      set: function (interval, repeat, callback) {
        const timerId = nextTimerId;
        nextTimerId += 1;
        scheduledTimers.push({ id: timerId, interval: interval, repeat: repeat, callback: callback, cleared: false });
        return timerId;
      },
      clear: function (timerId) {
        scheduledTimers.forEach(function (timer) {
          if (timer.id === timerId) {
            timer.cleared = true;
          }
        });
      }
    }
  };

  vm.createContext(context);
  // eslint-disable-next-line sonarjs/code-eval
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "src", "shelly", "toiletLight.js"), "utf8"),
    context,
    { filename: "toiletLight.js" }
  );

  tracking = calls;

  return {
    dispatch: function (component, eventName) {
      assert.ok(eventHandler, "event handler was not registered");
      eventHandler({
        component: component,
        info: { event: eventName }
      });
    },
    getCalls: function () {
      return JSON.parse(JSON.stringify(calls));
    },
    getStartupCalls: function () {
      return JSON.parse(JSON.stringify(startupCalls));
    },
    getContextValue: function (name) {
      return context[name];
    },
    setContextValue: function (name, value) {
      context[name] = value;
    },
    getStorageSnapshot: function () {
      return JSON.parse(JSON.stringify(storage));
    },
    runScheduledTimers: function () {
      const pending = scheduledTimers.splice(0);
      pending.forEach(function (t) {
        if (!t.cleared) t.callback();
      });
    }
  };
}

test("PIR turns the light on at night brightness with the auto-off timer", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { output: false, brightness: 0 }, { percent: 10 });

  harness.dispatch("input:0", "btn_down");

  assert.deepEqual(harness.getCalls(), [
    {
      method: "Light.Set",
      params: {
        id: 0,
        on: true,
        brightness: 25,
        toggle_after: 300
      }
    }
  ]);
});

test("long-press on push button disables PIR so motion no longer turns the light on", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { output: false, brightness: 0 }, { percent: 10 });

  harness.dispatch("input:1", "long_push");
  harness.dispatch("input:0", "btn_down");

  assert.deepEqual(harness.getCalls(), [
    { method: "Light.Set", params: { id: 1, on: false } }
  ]);
});

test("second long-press on push button re-enables PIR", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { output: false, brightness: 0 }, { percent: 10 });

  harness.dispatch("input:1", "long_push");
  harness.dispatch("input:1", "long_push");
  harness.dispatch("input:0", "btn_down");

  assert.deepEqual(harness.getCalls(), [
    { method: "Light.Set", params: { id: 1, on: false } },
    { method: "Light.Set", params: { id: 1, on: true, brightness: 5 } },
    {
      method: "Light.Set",
      params: {
        id: 0,
        on: true,
        brightness: 25,
        toggle_after: 300
      }
    }
  ]);
});

test("long-press on push button does not affect the touch button", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { output: false, brightness: 0 }, { percent: 10 });

  harness.dispatch("input:1", "long_push");
  harness.dispatch("input:2", "toggle");

  assert.deepEqual(harness.getCalls(), [
    { method: "Light.Set", params: { id: 1, on: false } },
    {
      method: "Light.Set",
      params: {
        id: 0,
        on: true,
        brightness: 75
      }
    }
  ]);
});

test("manual night-brightness state is not treated as PIR mode", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { output: false, brightness: 0 }, { percent: 10 });

  harness.dispatch("input:2", "toggle");
  harness.dispatch("input:0", "btn_down");

  assert.deepEqual(harness.getCalls(), [
    {
      method: "Light.Set",
      params: {
        id: 0,
        on: true,
        brightness: 75
      }
    }
  ]);
});

test("PIR blinks the indicator off and back on when the sensor says it is bright", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { output: false, brightness: 0 }, { percent: 80 });

  harness.dispatch("input:0", "btn_down");

  assert.deepEqual(harness.getCalls(), [
    { method: "Light.Set", params: { id: 1, on: false } }
  ]);

  harness.runScheduledTimers();

  assert.deepEqual(harness.getCalls().slice(-1), [
    { method: "Light.Set", params: { id: 1, on: true, brightness: 25 } }
  ]);
});

test("PIR bright pulse restarts instead of stacking indicator restore timers", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { output: false, brightness: 0 }, { percent: 80 });

  harness.dispatch("input:0", "btn_down");
  harness.dispatch("input:0", "btn_down");
  harness.runScheduledTimers();

  assert.deepEqual(harness.getCalls(), [
    { method: "Light.Set", params: { id: 1, on: false } },
    { method: "Light.Set", params: { id: 1, on: true, brightness: 25 } }
  ]);
});

test("PIR resets the auto-off timer when the light is already in PIR mode", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { output: false, brightness: 0 }, { percent: 10 });

  harness.dispatch("input:0", "btn_down");
  harness.dispatch("input:0", "btn_down");

  assert.deepEqual(harness.getCalls().slice(-1), [
    {
      method: "Light.Set",
      params: {
        id: 0,
        on: true,
        brightness: 25,
        toggle_after: 300
      }
    }
  ]);
});

test("single-push on push button turns the main and secondary light on", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { output: false, brightness: 0 }, { percent: 10 });

  harness.dispatch("input:1", "single_push");

  assert.deepEqual(harness.getCalls(), [
    { method: "Light.Set", params: { id: 0, on: true, brightness: 100 } },
    { method: "Light.Set", params: { id: 2, on: true, brightness: 100 } }
  ]);
});

test("single-push overrides PIR mode to full brightness and enables the secondary light", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { output: false, brightness: 0 }, { percent: 10 });

  harness.dispatch("input:0", "btn_down");
  harness.dispatch("input:1", "single_push");

  assert.deepEqual(harness.getCalls().slice(-3), [
    { method: "Light.Set", params: { id: 0, on: false } },
    { method: "Light.Set", params: { id: 0, on: true, brightness: 100 } },
    { method: "Light.Set", params: { id: 2, on: true, brightness: 100 } }
  ]);
});

test("single-push while already at full brightness turns the main and secondary light off", function () {
  const harness = createHarness({ output: true, brightness: 100 }, { output: true, brightness: 100 }, { percent: 10 });

  harness.dispatch("input:1", "single_push");

  assert.deepEqual(harness.getCalls(), [
    { method: "Light.Set", params: { id: 0, on: false } },
    { method: "Light.Set", params: { id: 2, on: false } }
  ]);
});

test("touch button turns on only the main light", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { output: false, brightness: 0 }, { percent: 10 });

  harness.dispatch("input:2", "toggle");

  assert.deepEqual(harness.getCalls(), [
    { method: "Light.Set", params: { id: 0, on: true, brightness: 75 } }
  ]);
});

test("touch button changes only the main light brightness when the secondary light is on", function () {
  const harness = createHarness({ output: true, brightness: 100 }, { output: true, brightness: 100 }, { percent: 10 });

  harness.dispatch("input:2", "toggle");

  assert.deepEqual(harness.getCalls(), [
    { method: "Light.Set", params: { id: 0, on: true, brightness: 75 } }
  ]);
});

test("touch button turns off the secondary light when it turns off the main light", function () {
  const harness = createHarness({ output: true, brightness: 75 }, { output: true, brightness: 100 }, { percent: 10 });

  harness.dispatch("input:2", "toggle");

  assert.deepEqual(harness.getCalls(), [
    { method: "Light.Set", params: { id: 0, on: false } },
    { method: "Light.Set", params: { id: 2, on: false } }
  ]);
});

test("PIR is skipped silently when light status is unavailable", function () {
  const harness = createHarness(null, { output: false, brightness: 0 }, { percent: 10 });

  harness.dispatch("input:0", "btn_down");

  assert.deepEqual(harness.getCalls(), []);
});

test("PIR fires when sensor status is unavailable", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { output: false, brightness: 0 }, null);

  harness.dispatch("input:0", "btn_down");

  assert.deepEqual(harness.getCalls(), [
    {
      method: "Light.Set",
      params: {
        id: 0,
        on: true,
        brightness: 25,
        toggle_after: 300
      }
    }
  ]);
});

test("startup syncs the PIR indicator to the initial enabled state", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { output: false, brightness: 0 }, { percent: 10 });

  assert.deepEqual(harness.getStartupCalls(), [
    { method: "Light.Set", params: { id: 1, on: true, brightness: 5 } }
  ]);
});

test("startup keeps the PIR indicator bright during daylight", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { output: false, brightness: 0 }, { percent: 80 });

  assert.deepEqual(harness.getStartupCalls(), [
    { method: "Light.Set", params: { id: 1, on: true, brightness: 25 } }
  ]);
});

test("LDR analog change events dim the PIR-enabled indicator", function () {
  const sensorStatus = { percent: 80 };
  const harness = createHarness({ output: false, brightness: 0 }, { output: false, brightness: 0 }, sensorStatus);

  sensorStatus.percent = 10;
  harness.dispatch("input:3", "analog_change");

  assert.deepEqual(harness.getCalls(), [
    { method: "Light.Set", params: { id: 1, on: true, brightness: 5 } }
  ]);
});

test("LDR analog measurement events brighten the PIR-enabled indicator", function () {
  const sensorStatus = { percent: 10 };
  const harness = createHarness({ output: false, brightness: 0 }, { output: false, brightness: 0 }, sensorStatus);

  sensorStatus.percent = 80;
  harness.dispatch("input:3", "analog_measurement");

  assert.deepEqual(harness.getCalls(), [
    { method: "Light.Set", params: { id: 1, on: true, brightness: 25 } }
  ]);
});

test("startup syncs the PIR indicator to the persisted disabled state", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { output: false, brightness: 0 }, { percent: 10 }, false);

  assert.deepEqual(harness.getStartupCalls(), [
    { method: "Light.Set", params: { id: 1, on: false } }
  ]);
});

test("long-press persists the PIR enabled state to storage", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { output: false, brightness: 0 }, { percent: 10 });

  harness.dispatch("input:1", "long_push");

  assert.deepEqual(harness.getStorageSnapshot(), {
    pirEnabled: "false"
  });
});

test("buildOutputsByRole skips inactive outputs", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { output: false, brightness: 0 }, { percent: 10 });
  const config = harness.getContextValue("CONFIG");
  const buildOutputsByRole = harness.getContextValue("buildOutputsByRole");
  var outputsByRole;

  config.outputs["2"].active = false;
  outputsByRole = buildOutputsByRole();

  assert.equal(outputsByRole.secondary, undefined);
  assert.equal(outputsByRole.main.id, 0);
  assert.equal(outputsByRole.main.config, config.outputs["0"]);
});

test("dispatchInputEvent ignores events when config validation fails", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { output: false, brightness: 0 }, { percent: 10 });
  const config = harness.getContextValue("CONFIG");
  const buildOutputsByRole = harness.getContextValue("buildOutputsByRole");
  const validateConfig = harness.getContextValue("validateConfig");

  config.outputs["0"].active = false;
  harness.setContextValue("OUTPUTS_BY_ROLE", buildOutputsByRole());
  harness.setContextValue("CONFIG_VALID", validateConfig());
  harness.dispatch("input:0", "btn_down");

  assert.deepEqual(harness.getCalls(), []);
});

test("configured event handlers are stored as string names", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { output: false, brightness: 0 }, { percent: 10 });
  const config = harness.getContextValue("CONFIG");

  assert.equal(typeof config.inputs["0"].events.btn_down.eventHandler, "string");
  assert.equal(typeof config.inputs["1"].events.long_push.eventHandler, "string");
  assert.equal(typeof config.inputs["1"].events.single_push.eventHandler, "string");
  assert.equal(typeof config.inputs["2"].events.toggle.eventHandler, "string");
  assert.equal(typeof config.inputs["3"].events.analog_change.eventHandler, "string");
  assert.equal(typeof config.inputs["3"].events.analog_measurement.eventHandler, "string");
});

test("every configured event handler resolves through the runtime handler registry", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { output: false, brightness: 0 }, { percent: 10 });
  const config = harness.getContextValue("CONFIG");
  const eventHandlers = harness.getContextValue("EVENT_HANDLERS");

  assert.equal(typeof eventHandlers[config.inputs["0"].events.btn_down.eventHandler], "function");
  assert.equal(typeof eventHandlers[config.inputs["1"].events.long_push.eventHandler], "function");
  assert.equal(typeof eventHandlers[config.inputs["1"].events.single_push.eventHandler], "function");
  assert.equal(typeof eventHandlers[config.inputs["2"].events.toggle.eventHandler], "function");
  assert.equal(typeof eventHandlers[config.inputs["3"].events.analog_change.eventHandler], "function");
  assert.equal(typeof eventHandlers[config.inputs["3"].events.analog_measurement.eventHandler], "function");
});
