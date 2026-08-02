# Brew System v3

A modern web-based brewery control system designed for Raspberry Pi kiosk mode deployment.

## Features

- **Touch-optimized UI** - Large buttons, generous spacing, designed for 14" touchscreen
- **Dark mode interface** - Sleek, modern design optimized for brewery environments
- **Real-time monitoring** - Live temperature tracking with visual feedback
- **Brew timer** - Integrated timing system with Start/Pause/Stop/Reset controls
- **Hardware abstraction** - Mock system for development, ready for GPIO integration
- **Screen sleep** - Display powers down after 5 idle minutes; the rig keeps brewing
- **Responsive layout** - Scales cleanly from 1366×768 to 1920×1080

## Technology Stack

### Frontend
- **React 18** - Component-based UI framework
- **Vite** - Fast build tool and dev server
- **Recharts** - Temperature charting
- **CSS Modules** - Scoped component styling

### Backend
- **FastAPI** - Modern Python web framework
- **Uvicorn** - ASGI server
- **Pydantic** - Data validation

## Architecture

```
src/
├── components/
│   ├── BrewingPanel/      # Main brewing controls
│   │   ├── PotCard        # BK, MLT, HLT temperature control
│   │   ├── PumpCard       # Pump control with flow animation
│   │   └── BrewTimer      # Brew session timer
│   ├── TemperatureChart/  # Live temperature graphing
│   ├── Settings/          # Configuration panel
│   └── BottomNav/         # Bottom navigation bar
├── utils/
│   ├── mockHardware.js    # Hardware abstraction layer (mock)
│   └── temperatureColor.js # Temperature gradient utilities
└── App.jsx                # Main application shell
```

## Development

### Prerequisites

- Node.js 18+
- Python 3.9+
- npm or yarn
- pip

### Frontend Setup

```bash
cd brew-system-v3
npm install
npm run dev
```

The application will open at `http://localhost:5173`

### Backend Setup

```bash
# Install Python dependencies
pip install -r requirements.txt

# Run the FastAPI server
python backend/main.py
```

The API server will run at `http://localhost:8000`

**Note:** For development, you can run both frontend (Vite dev server) and backend separately. For production, the backend serves the built frontend.

### Building for Production

```bash
# Build the frontend
npm run build

# This creates optimized static files in the dist/ directory
# The FastAPI backend will serve these files
```

## Raspberry Pi Deployment

### 1. Build the Application

On your development machine:

```bash
npm run build
```

### 2. Transfer to Raspberry Pi

```bash
# Copy entire project to Pi
scp -r . pi@raspberrypi.local:~/brew-system-v3/
```

### 3. Install Python Dependencies

On the Raspberry Pi:

```bash
sudo apt-get update
sudo apt-get install python3-pip
cd ~/brew-system-v3
pip3 install -r requirements.txt
```

### 4. Run the Backend Server

The FastAPI backend serves the React build and provides the settings API:

```bash
cd ~/brew-system-v3
python3 backend/main.py
```

The application will be available at `http://localhost:8000`

### 5. Set Up as System Service (Optional)

Create a systemd service file to auto-start on boot:

```bash
sudo nano /etc/systemd/system/brew-system.service
```

Add the following content:

```ini
[Unit]
Description=Brew System v3
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/brew-system-v3
# The 1-Wire resolution files are root-owned and reappear on every boot, so the
# service can't lower the DS18B20s to 10-bit on its own. The leading "+" runs
# this step as root even though the service itself runs as pi. Without it the
# sensors stay at 12-bit: ~750 ms per read, so a 3-sensor sweep takes ~4.6 s
# against a 1 s loop, and the 10 s stale-sensor watchdog gets uncomfortably close.
ExecStartPre=+/bin/sh -c 'chgrp pi /sys/bus/w1/devices/28-*/resolution && chmod g+w /sys/bus/w1/devices/28-*/resolution || true'
ExecStart=/usr/bin/python3 /home/pi/brew-system-v3/backend/main.py
Restart=always

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
sudo systemctl enable brew-system.service
sudo systemctl start brew-system.service
```

### 6. Set Up Kiosk Mode (Electron)

Install unclutter-xfixes to hide the mouse cursor (works during slider drag):

```bash
sudo apt-get install unclutter-xfixes
```

Electron is installed as a project dependency. Create autostart script (`~/.config/lxsession/LXDE-pi/autostart`):

```bash
@xset s off
@xset s noblank
@xset +dpms
@xset dpms 0 0 0
@unclutter --start-hidden --hide-on-touch
@/home/pi/brew-system-v3/node_modules/.bin/electron /home/pi/brew-system-v3
```

X is told not to blank the screen on its own (`s off`, `s noblank`, and DPMS
timeouts of zero) while leaving DPMS *enabled*, which is what lets the app power
the panel down itself — see [Screen Sleep](#screen-sleep). Electron re-applies
these four settings at startup, so an older autostart file carrying `@xset
-dpms` only disables sleep until the app launches.

Press **Ctrl+Shift+Q** to exit kiosk mode for maintenance.

### 7. Enable Auto-login (Optional)

```bash
sudo raspi-config
# Select: System Options -> Boot / Auto Login -> Desktop Autologin
```

### 8. Reboot

```bash
sudo reboot
```

The application will launch in fullscreen kiosk mode on boot.

## Settings Management

The system now includes a comprehensive settings panel for hardware configuration:

### Configuration File

Settings are stored in `config.json` at the project root. This file is read by both the backend API and can be accessed by your hardware control scripts.

`config.json` is **per-install and not tracked in git** — it holds this rig's GPIO
pins, DS18B20 serials and tuned regulation curves, which must survive a deploy.
The backend creates it from the tracked `config.default.json` on first start, and
the Settings panel edits it in place. So:

- **Changing a default for every install** → edit `config.default.json` and commit.
- **Changing this rig** → use the Settings panel (or edit `config.json`); it stays local.
- **Deploying** → `git pull` never touches `config.json`. Back it up before
  reimaging anyway: it is the only record of your pin map and sensor serials.

```json
{
  "gpio": {
    "pot": { "bk": 17, "hlt": 18 },
    "pump": { "p1": 27, "p2": 21 },
    "pwm_heating": { "bk": 12, "hlt": 13 },
    "pwm_pump": { "p1": 5, "p2": 6 }
  },
  "pwm": {
    "frequency": 200,
    "software_frequency": 200
  },
  "sensors": {
    "ds18b20": {
      "bk": "28-00000b80089a",
      "mlt": "28-00000b81425c",
      "hlt": "28-00000b80bee4",
      "pin": 7
    }
  }
}
```

### Accessing Settings in Your Code

Python example:

```python
import json

def load_config():
    with open('config.json', 'r') as f:
        return json.load(f)

config = load_config()
bk_pin = config['gpio']['pot']['bk']
```

### Settings Panel Features

- **Auto-save**: Changes are saved automatically
- **Collapsible sections**: Organize settings by category
- **No validation**: Trust user input for flexibility
- **Atomic writes**: Safe file updates prevent corruption

## Hardware Integration

The current implementation uses a mock hardware layer (`src/utils/mockHardware.js`).

To integrate with real hardware:

1. Build your GPIO control scripts in Python
2. Read GPIO pins and sensor IDs from `config.json`
3. Configure pins in the Settings panel (accessible via the app)
4. Implement SSR control for heaters
5. Implement PWM for pump speed control
6. Connect DS18B20 or similar temperature sensors

The settings configured in the UI will be automatically available to your hardware control code by reading `config.json`.

## Remote Access via BrewPlanner

The BrewPlanner server (the internet-facing Pi) mirrors this system's main
brewing screen on its **Brew System** page and proxies control commands to this
backend over the LAN (`/api/brew-system/*` → `http://<this-pi>:8000/api/...`).
BrewPlanner's login + admin role gate all remote access; this backend needs no
changes for it and stays unauthenticated by design.

Two operational rules keep that safe:

1. **LAN-only**: never port-forward or tunnel this Pi's port 8000 directly —
   the API has no auth. BrewPlanner is the only remote door.
2. **Stable address**: give this Pi a static IP or DHCP reservation, and point
   BrewPlanner's `BREW_SYSTEM_URL` env var at it (see
   `BrewPlanner/deploy/brewplanner.env.example`).

Both UIs stay consistent automatically — this backend is the single source of
truth, and each UI polls it.

### Speaking through Bruce

Traffic also runs the other way. Bruce — the voice assistant wired to the brewery
speaker — lives on the BrewPlanner Pi, and this backend can push spoken
announcements to him, so something it notices on its own is heard rather than
only logged.

Set the web server's address in this rig's `.env` and restart the backend:

```bash
BREW_PLANNER_URL=http://192.168.3.3:3000
```

Leave it unset and the backend simply stays quiet — a rig on the bench with no
web server is a normal way to run it, not a misconfiguration.

The route out is `POST /api/bruce/speak {"message": "..."}` on this backend,
which forwards to BrewPlanner's `/api/bruce/speak` and on to Bruce's own
loopback API. Everything on the rig that wants to be heard goes through that one
endpoint rather than holding its own copy of the web server's address.

No credential is needed: BrewPlanner admits any request from a private LAN
address as admin (its `isLocalRequest`), and this rig is one. If that ever stops
being true — `TRUST_LOCAL=false` over there, or the two Pis on separate subnets —
set `BREW_PLANNER_TOKEN` here to a full-access token from BrewPlanner's
`/api/auth/login`. Its read-only `WATCH_API_TOKEN` will not work; control routes
refuse it by design.

Speech never affects control. Every failure — no address set, web server
rebooting, `bruce.service` stopped, speaker unplugged — is logged and dropped,
because none of them is a reason to disturb a brew.

Note this is separate from the Bruce that Electron starts on this rig
(`electron/bruce.js`, wake word and microphone). That one is untouched.

### Heating fault detection

The backend watches for an element that is switched on but isn't heating its pot
— unplugged after cleaning, a dead relay, or a sensor sitting in a different pot
than the one it's labelled with. When a pot calls for heat for `timeout_seconds`
without gaining `min_rise_c`, Bruce says so out loud and the brewing screen shows
an amber banner.

Only pots **under regulation** are watched, and only while they sit more than
`min_headroom_c` (5 °C) below their set value. That is the one case where a flat
sensor proves something: at that distance the auto-efficiency curve's top step is
asking for 100 % power, so the pot has to climb. Nearer the set value the curve
throttles back and a flat temperature is the system working; in manual mode the
duty cycle is whatever the brewer chose, and a pot creeping along at 20 % is not
a fault.

It **warns only** — the element keeps running. Unlike the over-temperature cutoff
and the stalled-sensor watchdog, which cut power because they are certain, this
is an inference from a temperature that hasn't moved yet, and a false positive on
a big cold mash would end a brew day for nothing. The brewer decides.

Configured under Settings → Program → Heating Fault Detection:

| Setting | Default | Meaning |
|---|---|---|
| `timeout_seconds` | 120 | How long an element may call for heat without the sensor moving |
| `min_rise_c` | 1.0 | The rise that counts as "it is heating" |
| `min_headroom_c` | 5.0 | How far below its set value a regulating pot must be before it is judged |
| `min_efficiency` | 25.0 | Duty cycles below this are ignored — too little power to prove anything |
| `renotify_seconds` | 600 | How often to repeat the spoken warning |

Keep `min_headroom_c` at or above the top auto-efficiency threshold (also 5 °C by
default) so the two agree. At 100 % power BK's 8.5 kW element moves a full 100 L
kettle a degree in about 50 s, comfortably inside the 2-minute window; lengthen
it if you brew bigger volumes.

The watcher is deliberately quiet everywhere an answer would mean nothing: a pot
not under regulation, one within `min_headroom_c` of its set value, a duty cycle
under `min_efficiency`, and a failed sensor — which is the regulation loop's
business, and already forces the heater off.

## Screen Sleep

The kiosk display powers itself down after 5 minutes without a touch, and any
touch brings it straight back. That first touch only wakes the screen — a black
overlay catches it, so nobody switches an 8.5 kW element on by reaching for a
dark panel.

**The rig never sleeps, only the screen does.** A Raspberry Pi has no
suspend-to-RAM, and suspending the machine mid-brew would be the wrong thing
anyway: sensor reads, regulation, the over-temperature cutoff, the stalled-sensor
watchdog and heating-fault detection all keep running exactly as before. Nothing
about a sleeping display reaches the hardware.

The screen also stays lit whenever the rig is doing something — a heater on, a
pump running, or the brew timer counting — so a long boil you aren't touching
stays readable from across the room. Idle means *idle*: everything off. The rig's
state is checked once, when the idle timer runs out; if it turns out to be busy
the check repeats every 30 s. There is no extra polling the rest of the time.

Configured under Settings → Program → Screen Sleep:

| Setting | Default | Meaning |
|---|---|---|
| `enabled` | true | Whether the display sleeps at all |
| `timeout_seconds` | 300 | Idle time before the panel powers down (edited in minutes in the UI) |

Implementation: the frontend owns the idle timer, since it is the only part that
sees touches, and asks Electron over IPC to cut the panel (`xset dpms force off`,
falling back to `vcgencmd display_power 0`). This needs DPMS enabled in X — see
the autostart file above. Quitting the app always wakes the display first, so
Ctrl+Shift+Q can never leave a Pi that looks bricked. Outside Electron (a plain
browser during development) the overlay still appears; only the backlight stays on.

## Temperature Regulation

The system implements automatic efficiency control:
- **> 5°C from target**: 100% power
- **2-5°C from target**: 60% power
- **0.5-2°C from target**: 30% power
- **< 0.5°C from target**: 0% power

Manual efficiency control is disabled when regulation is enabled.

## Component Details

### Pot Cards (BK, HLT)
- On/Off toggle
- Regulation enable/disable
- Large PV (current temperature) display
- SV (target temperature) when regulation enabled
- Set temperature slider (0-100°C) with dynamic color
- Efficiency slider (0-100%)
- Orange glow effect when heating

### MLT Card
- Current temperature (PV) only
- No heating controls
- Simplified display

### Pump Cards
- On/Off toggle
- Speed slider (0-100%)
- Animated flow indicator when active
- Flow speed matches pump speed

### Brew Timer
- Counts up from 00:00:00
- Start/Pause/Stop/Reset controls
- Persistent across panel switches

### Temperature Chart
- Live plotting of all three pots
- Toggle visibility per pot
- 2-minute rolling window
- Dark theme optimized

## Customization

### Colors

Edit `src/utils/temperatureColor.js` to adjust temperature gradient.

### Layout

Adjust component spacing in CSS modules:
- `BrewingPanel.module.css` - Main panel grid
- `PotCard.module.css` - Card styling
- `PumpCard.module.css` - Pump controls

### Hardware Mock Parameters

Edit `src/utils/mockHardware.js`:
- `heatingRate` - Heating speed (°C/s at 100%)
- `coolingRate` - Cooling speed (°C/s)
- `ambientTemp` - Room temperature
- `tempNoise` - Sensor noise

## Browser Compatibility

Tested and optimized for:
- Chromium (Raspberry Pi)
- Chrome (desktop development)
- Firefox (desktop development)

## Performance

- Bundle size: ~150KB gzipped
- 60 FPS animations
- Low CPU usage (~5% on Pi 4)
- Temperature update: 500ms interval
- Chart update: 1s interval

## License

MIT

## Support

For issues or questions about deployment, refer to:
- Raspberry Pi documentation: https://www.raspberrypi.org/documentation/
- Vite documentation: https://vitejs.dev/
- React documentation: https://react.dev/
