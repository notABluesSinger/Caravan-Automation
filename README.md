# Caravan Automation

Shelly scripts for our caravan, plus tooling to push them to the devices.

## Contents

- `shellyCode/toiletLight.js` — toilet light controller. Handles three inputs (PIR, push button, touch button) with configurable brightness levels, dark-only triggering, and auto-off timers.
- `put_script.py` — official Shelly upload tool ([source](https://github.com/ALLTERCO/shelly-script-examples/blob/main/tools/put_script.py)). Stops the target script, uploads the new code in 1 KB chunks, then restarts it.

## Requirements

- A Shelly Gen2+ device (Plus / Pro / Gen3) reachable on the local network.
- `python3` — ships with macOS, no extra install needed.

## Deploying

```bash
./put_script.py <device-ip> <script-slot-id> "shellyCode/toiletLight.js"
```

Example:

```bash
./put_script.py 192.168.1.50 1 "shellyCode/toiletLight.js"
```

- `<device-ip>` — IP or hostname of the Shelly device.
- `<script-slot-id>` — the numeric slot on the device. Find it in the Shelly web UI under **Scripts**, or list them with:
  ```bash
  curl http://<device-ip>/rpc/Script.List
  ```
  If the slot doesn't exist yet, create it once in the web UI (or via `Script.Create`) before the first deploy.

The script name on the device is set to the uploaded filename.
