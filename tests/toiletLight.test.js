const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createHarness(initialLightStatus, sensorStatus) {
  let eventHandler = null;
  const calls = [];
  const startupCalls = [];
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
        brightness: 20,
        toggle_after: 300
      }
    }
  ]);
});

test("push button disables PIR so motion no longer turns the light on", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { percent: 10 });

  harness.dispatch("input:1", "btn_down");
  harness.dispatch("input:0", "btn_down");

  assert.deepEqual(harness.getCalls(), [
    {
      method: "Light.Set",
      params: { id: 1, on: false }
    }
  ]);
});

test("second push button press re-enables PIR", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { percent: 10 });

  harness.dispatch("input:1", "btn_down");
  harness.dispatch("input:1", "btn_down");
  harness.dispatch("input:0", "btn_down");

  assert.deepEqual(harness.getCalls(), [
    { method: "Light.Set", params: { id: 1, on: false } },
    { method: "Light.Set", params: { id: 1, on: true } },
    {
      method: "Light.Set",
      params: {
        id: 0,
        on: true,
        brightness: 20,
        toggle_after: 300
      }
    }
  ]);
});

test("push button does not affect the touch button", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { percent: 10 });

  harness.dispatch("input:1", "btn_down");
  harness.dispatch("input:2", "toggle");

  assert.deepEqual(harness.getCalls(), [
    { method: "Light.Set", params: { id: 1, on: false } },
    {
      method: "Light.Set",
      params: {
        id: 0,
        on: true,
        brightness: 60
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
        brightness: 60
      }
    }
  ]);
});

test("PIR does not turn the light on when the sensor says it is bright", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { percent: 80 });

  harness.dispatch("input:0", "btn_down");

  assert.deepEqual(harness.getCalls(), []);
});

test("startup syncs the PIR indicator to the initial enabled state", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { percent: 10 });

  assert.deepEqual(harness.getStartupCalls(), [
    { method: "Light.Set", params: { id: 1, on: true } }
  ]);
});
