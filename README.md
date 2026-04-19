# Caravan Automation

Shelly scripts for our caravan, plus tooling to push them to the devices.

## Contents

- `src/shelly/toiletLight.js` — toilet light controller. Handles three action inputs (PIR, push button, touch button) plus a light sensor that gates PIR activation, with configurable brightness levels and auto-off timers.
- `scripts/put_script.py` — official Shelly upload tool ([source](https://github.com/ALLTERCO/shelly-script-examples/blob/main/tools/put_script.py)). Stops the target script, uploads the new code in 1 KB chunks, then restarts it.
- `scripts/deploy.js` — named deploy wrapper so each Shelly script can have a stable npm command.

## Requirements

- A Shelly Gen2+ device (Plus / Pro / Gen3) reachable on the local network.
- `python3` — ships with macOS, no extra install needed.
- `node` 24+ — used for the local test runner.

## Testing

```bash
npm test
```

This runs the local Node-based harness for `src/shelly/toiletLight.js` and checks the event-handling logic without needing a physical Shelly device.

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
  Named deploys use this list automatically to find the script with the expected name. If the script doesn't exist yet, create it once in the web UI (or via `Script.Create`) before the first deploy.

The script name on the device is set to the uploaded filename.
