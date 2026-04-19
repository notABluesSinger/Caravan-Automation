const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createHarness(initialLightStatus, sensorStatus) {
  let eventHandler = null;
  const calls = [];
  let lightStatus = initialLightStatus;
  const sensor = sensorStatus;

  const context = {
    print: function () {},
    Shelly: {
      addEventHandler: function (handler) {
        eventHandler = handler;
      },
      getComponentStatus: function (component) {
        if (component === "light:3") return lightStatus;
        if (component === "input:3") return sensor;
        return null;
      },
      call: function (method, params) {
        calls.push({ method: method, params: params });

        if (method === "Light.Set") {
          lightStatus = {
            output: !!params.on,
            brightness: params.brightness !== undefined ? params.brightness : lightStatus && lightStatus.brightness
          };
        }
      }
    }
  };

  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "src", "shelly", "toiletLight.js"), "utf8"),
    context,
    { filename: "toiletLight.js" }
  );

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
        id: 3,
        on: true,
        brightness: 20,
        toggle_after: 300
      }
    }
  ]);
});

test("manual override from PIR mode clears the timer by cycling off then on", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { percent: 10 });

  harness.dispatch("input:0", "btn_down");
  harness.dispatch("input:1", "btn_down");

  assert.deepEqual(harness.getCalls().slice(-2), [
    {
      method: "Light.Set",
      params: {
        id: 3,
        on: false
      }
    },
    {
      method: "Light.Set",
      params: {
        id: 3,
        on: true,
        brightness: 100
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
        id: 3,
        on: true,
        brightness: 60
      }
    }
  ]);
});

test("PIR ignores new motion while manual mode is already active", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { percent: 10 });

  harness.dispatch("input:1", "btn_down");
  harness.dispatch("input:0", "btn_down");

  assert.deepEqual(harness.getCalls(), [
    {
      method: "Light.Set",
      params: {
        id: 3,
        on: true,
        brightness: 100
      }
    }
  ]);
});

test("PIR does not turn the light on when the sensor says it is bright", function () {
  const harness = createHarness({ output: false, brightness: 0 }, { percent: 80 });

  harness.dispatch("input:0", "btn_down");

  assert.deepEqual(harness.getCalls(), []);
});
