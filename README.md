# Caravan Automation

Shelly scripts for our caravan, plus tooling to push them to the devices.

## Contents

- `src/shelly/toiletLight.js` — toilet light controller with PIR-driven night lighting, manual brightness controls including a long-press full-brightness override, and a PIR enable/disable toggle.
- `scripts/put_script.py` — Shelly upload helper based on the official tool ([source](https://github.com/ALLTERCO/shelly-script-examples/blob/main/tools/put_script.py)). It reuses an existing script slot when present, creates a new script when the target ID does not exist yet, uploads the code in 1 KB chunks, starts it, and enables run-on-boot.
- `scripts/deploy.js` — named deploy wrapper so each Shelly script can have a stable `npm run` command.
- `tests/` — Node-based test harness for Shelly scripts plus Python unit tests for the upload helper, so the event-handling and deploy logic can be exercised without a device.
- `eslint.config.js` — ESLint + `eslint-plugin-sonarjs` setup with stricter complexity thresholds for `src/` and `scripts/`.

## Hardware

The toilet light system uses a **Shelly Plus RGBW PM** as the controller. Two of its four PWM channels drive lights, and the four physical inputs are wired to a PIR sensor, two buttons, and a light-level sensor.

```mermaid
flowchart LR
    subgraph Inputs
        PIR["input:0<br/>PIR Sensor"]
        PB["input:1<br/>Push Button"]
        TB["input:2<br/>Touch Button"]
        LDR["input:3<br/>Light Sensor (LDR)"]
    end

    subgraph Controller["Shelly Plus RGBW PM<br/>toiletLight.js"]
        SCRIPT[" "]
    end

    subgraph Outputs
        MAIN["light:0<br/>Main Lights"]
        IND["light:1<br/>PIR Indicator LED"]
    end

    PIR --> SCRIPT
    PB --> SCRIPT
    TB --> SCRIPT
    LDR --> SCRIPT
    SCRIPT --> MAIN
    SCRIPT --> IND
```

The push-button input on the Shelly must be configured in **button** mode (in the Shelly web UI) so it emits `single_push` and `long_push` events.

## Shopping list

Reference links (Amazon UK). Pick equivalents if anything goes out of stock.

| Component | Purpose | Link |
|---|---|---|
| Shelly Plus RGBW PM | Main controller | [amazon.co.uk](https://www.amazon.co.uk/dp/B0CXN2B9RS) |
| PIR motion sensor | `input:0` — motion detection | [amazon.co.uk](https://www.amazon.co.uk/dp/B07XLKTQMG) |
| Momentary pushbutton | `input:1` — short/long-press mode control | [amazon.co.uk](https://www.amazon.co.uk/dp/B0B8Z14K3T) |
| Capacitive touch switch | `input:2` — day brightness toggle | [amazon.co.uk](https://www.amazon.co.uk/dp/B0B2RS23ZH) |
| LDR (light-dependent resistor) | `input:3` — ambient light sensing | [amazon.co.uk](https://www.amazon.co.uk/dp/B09VYSKLL6) |
| 5 mm LEDs | `light:1` — PIR indicator (and general use) | [amazon.co.uk](https://www.amazon.co.uk/dp/B0B74B2CWY) |
| 12 V LED strip (bench testing) | `light:0` stand-in during development | [amazon.co.uk](https://www.amazon.co.uk/dp/B0CFZCXL1F) |
| Resistors (assorted) | LED current limiting, LDR voltage divider | [amazon.co.uk](https://www.amazon.co.uk/dp/B0CL6NNZ44) |
| Transistors | Low-side switching for extra loads | [amazon.co.uk](https://www.amazon.co.uk/dp/B0CPBR1FGB) |
| Wago lever connectors | Tidy, reusable wiring | [amazon.co.uk](https://www.amazon.co.uk/dp/B08MYFJXC5) |
| 12 V PSU | Shared supply (any 12 V DC unit sized for your strip will do) | [amazon.co.uk](https://www.amazon.co.uk/dp/B096VPYQ69) |

## Behaviour

| Input | Event | What it does |
|-------|-------|--------------|
| PIR (input:0) | `btn_down` | Turn the main light to **night brightness (25%)** for 5 min, but only when it's dark *and* PIR mode is enabled. |
| Push Button (input:1) | `single_push` | Toggle PIR mode on/off. The indicator LED reflects the current state (on = PIR enabled). |
| Push Button (input:1) | `long_push` | Turn the main light to **full (100%)**, overriding any PIR-driven state. Long-pressing again while already at full turns it off. |
| Touch Button (input:2) | `toggle` | Set **day brightness (75%)**. Toggling while already at 75% turns the light off. |
| Light Sensor (input:3) | (analog) | Gates the PIR — readings above the configured threshold (50%) mean "too bright, ignore motion". |

Brightness levels (`CONFIG.brightnessLevels` in the script):

| Level  | Value |
|--------|-------|
| night  | 25%   |
| day    | 75%   |
| full   | 100%  |

If motion is detected while PIR mode is *disabled*, the main light stays off and the indicator remains in its current state. If PIR is enabled but the light sensor says it is too bright, the indicator briefly pulses off for 300 ms and then resyncs.

The indicator LED's on-state brightness is configurable via `CONFIG.outputs["1"].brightness` (default 100%) so it's visible without being distracting.

## Requirements

- A Shelly Gen2+ device (Plus / Pro / Gen3) reachable on the local network.
- `python3` — ships with macOS, no extra install needed.
- `node` 24+ — used for the local test runner.

## Development

```bash
npm test     # Run the local Node test harness
python3 -m unittest tests.put_script_test # Run Python unit tests for the deploy helper
npm run lint # ESLint + sonarjs (cognitive complexity, max-depth, etc.)
```

The lint config is stricter for `src/` and `scripts/` (cognitive complexity 10, cyclomatic 8, max-depth 3, max function length 40 lines) and looser for tests.

## Deploying

```bash
npm run deploy -- <device-ip> <script-slot-id> "src/shelly/toiletLight.js"
```

Example:

```bash
npm run deploy -- 192.168.1.50 1 "src/shelly/toiletLight.js"
```

If you prefer, you can still call `./scripts/put_script.py` directly with the same arguments.

For named deploys, use:

```bash
npm run deploy:toilet-light -- <device-ip>
```

Example:

```bash
npm run deploy:toilet-light -- 192.168.1.50
```

This looks up the script on the device by name and deploys to the script whose name matches the target file, for example `toiletLight.js`.
The deploy wrapper logs the lookup and the resolved slot before upload starts.

To override the slot explicitly:

```bash
npm run deploy:toilet-light -- 192.168.1.50 2
```

If you add more Shelly scripts later, wire them into `scripts/deploy.js` and they can get their own `npm run deploy:<name>` command.

- `<device-ip>` — IP or hostname of the Shelly device.
- `<script-slot-id>` — the numeric slot on the device. Find it in the Shelly web UI under **Scripts**, or list them with:
  ```bash
  curl http://<device-ip>/rpc/Script.List
  ```
  Named deploys use this list automatically to find the script with the expected name. If no script with that name exists yet, the deploy wrapper falls back to the lowest unused slot ID and `put_script.py` creates a new script automatically. Shelly may return a different numeric ID than the one you requested on first deploy, so pay attention to the slot logged during upload.

The script name on the device is set to the uploaded filename, and deploys also enable the Shelly "run on startup" flag for that script.
