const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createHarness(initialLightStatus, sensorStatus) {
  let eventHandler = null;
  const calls = [];
  const startupCalls = [];
  const scheduledTimers = [];
  let tracking = startupCalls;
  let lightStatus = initialLightStatus;
  const sensor = sensorStatus;

  const context = {
    print: function () {},
    Shelly: {
      addEventHandler: function (handler) {
        eventHandler = handler;
      },
      getComponentStatus: function (component) {
        if (component === "light:0") return lightStatus;
        if (component === "input:3") return sensor;
        return null;
      },
      call: function (method, params) {
        tracking.push({ method: method, params: params });

        if (method === "Light.Set" && params.id === 0) {
          lightStatus = {
            output: !!params.on,
            brightness: params.brightness !== undefined ? params.brightness : lightStatus && lightStatus.brightness
          };
        }
      }
    },
    Timer: {
      set: function (interval, repeat, callback) {
        scheduledTimers.push({ interval: interval, repeat: repeat, callback: callback });
        return scheduledTimers.length;
      },
      clear: function () {}
    }
  };

  vm.createContext(context);
  // Loading the Shelly script into a sandboxed VM context is how we exercise it without a device.
  // eslint-disable-next-line sonarjs/code-eval
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "src", "shelly", "toiletLight.js"), "utf8"),
    context,
    { filename: "toiletLight.js" }
  );

  tracking = calls;

  return {
    calls: calls,
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
    getLightStatus: function () {
      return lightStatus;
    },
    runScheduledTimers: function () {
      const pending = scheduledTimers.splice(0);
      pending.forEach(function (t) { t.callback(); });
    }
  };
}

test("PIR turns the light on at night brightness with the auto-off timer", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { percent: 10 });

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

test("push button disables PIR so motion no longer turns the light on", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { percent: 10 });

  harness.dispatch("input:1", "single_push");
  harness.dispatch("input:0", "btn_down");

  assert.deepEqual(harness.getCalls(), [
    { method: "Light.Set", params: { id: 1, on: false } },
    { method: "Light.Set", params: { id: 1, on: true } }
  ]);
});

test("motion while PIR disabled flashes the indicator and then resyncs", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { percent: 10 });

  harness.dispatch("input:1", "single_push");
  harness.dispatch("input:0", "btn_down");

  assert.deepEqual(harness.getCalls().slice(-1), [
    { method: "Light.Set", params: { id: 1, on: true } }
  ]);

  harness.runScheduledTimers();

  assert.deepEqual(harness.getCalls().slice(-1), [
    { method: "Light.Set", params: { id: 1, on: false } }
  ]);
});

test("second push button press re-enables PIR", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { percent: 10 });

  harness.dispatch("input:1", "single_push");
  harness.dispatch("input:1", "single_push");
  harness.dispatch("input:0", "btn_down");

  assert.deepEqual(harness.getCalls(), [
    { method: "Light.Set", params: { id: 1, on: false } },
    { method: "Light.Set", params: { id: 1, on: true } },
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

test("push button does not affect the touch button", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { percent: 10 });

  harness.dispatch("input:1", "single_push");
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
  const harness = createHarness({ output: false, brightness: 0 }, { percent: 10 });

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

test("PIR does not turn the light on when the sensor says it is bright", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { percent: 80 });

  harness.dispatch("input:0", "btn_down");

  assert.deepEqual(harness.getCalls(), []);
});

test("long-press on push button turns the light on at full brightness", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { percent: 10 });

  harness.dispatch("input:1", "long_push");

  assert.deepEqual(harness.getCalls(), [
    { method: "Light.Set", params: { id: 0, on: true, brightness: 100 } }
  ]);
});

test("long-press overrides PIR mode to full brightness", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { percent: 10 });

  harness.dispatch("input:0", "btn_down");
  harness.dispatch("input:1", "long_push");

  assert.deepEqual(harness.getCalls().slice(-2), [
    { method: "Light.Set", params: { id: 0, on: false } },
    { method: "Light.Set", params: { id: 0, on: true, brightness: 100 } }
  ]);
});

test("long-press while already at full brightness turns the light off", function () {
  const harness = createHarness({ output: true, brightness: 100 }, { percent: 10 });

  harness.dispatch("input:1", "long_push");

  assert.deepEqual(harness.getCalls(), [
    { method: "Light.Set", params: { id: 0, on: false } }
  ]);
});

test("startup syncs the PIR indicator to the initial enabled state", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { percent: 10 });

  assert.deepEqual(harness.getStartupCalls(), [
    { method: "Light.Set", params: { id: 1, on: true } }
  ]);
});
