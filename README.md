# Brew System v3

A modern web-based brewery control system designed for Raspberry Pi kiosk mode deployment.

## Features

- **Touch-optimized UI** - Large buttons, generous spacing, designed for 14" touchscreen
- **Dark mode interface** - Sleek, modern design optimized for brewery environments
- **Start menu** - Open a brew session in the logbook, or go straight to the rig
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
│   ├── StartMenu/         # Where the app opens: with a session, or without
│   ├── BrewingPanel/      # Main brewing controls
│   │   ├── PotCard        # BK, MLT, HLT temperature control
│   │   ├── PumpCard       # Pump control with flow animation
│   │   └── BrewTimer      # Brew session timer
│   ├── TemperatureChart/  # Live temperature graphing
│   ├── Settings/          # Configuration panel
│   └── BottomNav/         # Bottom navigation bar
├── utils/
│   ├── mockHardware.js    # Hardware abstraction layer (mock)
│   ├── hardwareApi.js     # REST writes to the backend
│   ├── liveState.js       # Live state pushed over one WebSocket
│   └── temperatureColor.js # Temperature gradient utilities
└── App.jsx                # Main application shell
```

## Live state

Reads are pushed, writes are REST.

Every client holds one WebSocket to `/api/ws`. The backend sends a full
snapshot when it opens, and after that only what changed — so a rig nobody is
touching puts nothing on the wire, and a heater toggle is on screen in
milliseconds rather than on the next poll tick. Adding a second client (a phone
watching the boil) costs one more socket, not another stream of requests.

```
sensor sweep / regulation tick / REST write / watchdog
        ↓  (schedules a push — never waits for one)
broadcast loop  →  diff against what clients already have
        ↓  (nothing changed → nothing sent)
   /api/ws  →  every connected client
        ↓
liveState.js  →  merges the diff, notifies subscribers
        ↓
BrewingPanel · TemperatureChart
```

Worth knowing:

- **Commands still go over REST** (`POST /api/hardware/...`). Only the read
  path moved. `GET /api/hardware/state` remains as the one-shot form of the
  same data, for callers that want an answer rather than a subscription.
- **Two values are deliberately not diffed**: a running timer's seconds and how
  long a heating fault has stood both tick on their own, and diffing them would
  put a frame on the wire every second on an idle rig. They resync every 10 s
  and the browser counts in between.
- **Silence is reported**: with nothing to say the backend heartbeats every
  10 s, because a quiet rig and a socket that died mid-frame look identical
  otherwise. A client that hears nothing for 25 s reconnects; one that has been
  disconnected for 3 s puts a warning across the brewing screen rather than
  leaving stale temperatures on a device that drives heaters.
- **Chart points are pushed as they are logged.** The history endpoint is still
  there, used for the first paint and to fill whatever a dropped connection
  missed.

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

### Tests

```bash
cd backend
pip install -r requirements-dev.txt
pytest
```

They run in a few seconds against a throwaway config with the GPIO layer
mocked, so they are safe to run on the rig itself — nothing they do can reach a
relay, the real `config.json`, or the session logs.

What they cover is the code that is hard to check by looking at it: the shared
power budget (two elements totalling 13.5 kW on an 11 kW supply, and who
yields), the regulation curve and the safety cutoffs that override it, the
timer state machine, and calibration. Where it matters they assert on the
*pin*, not on the state dict — the bug worth catching is the one where the two
disagree.

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

#### Getting back in — the desktop icon

Ctrl+Shift+Q drops you to the desktop, and until the next reboot there is no
obvious way back. Install a **Brew System** icon that opens the GUI again:

```bash
~/brew-system-v3/install-desktop-icon.sh
```

That writes a desktop entry (and a matching menu entry) pointing at
`brew-system-gui.sh` in the checkout, so a `git pull` updates what the icon does
and the installer only ever needs running once.

What it does when double-clicked:

- **Already running** → raises that window instead of starting a second kiosk,
  and wakes the panel if it has gone to sleep. Two Electron windows driving the
  same 8.5 kW elements is not a state worth allowing, so this is a check, not a
  courtesy.
- **Not running** → starts it exactly as the autostart line does, via
  `electron/launch.js` (so unclutter comes with it). If node isn't on the
  launcher's `PATH` — a desktop entry gets no login shell — it falls back to
  Electron's own binary.
- **Backend stopped** → tries `sudo -n systemctl start brew-system.service`
  first, since a stopped backend otherwise leaves the kiosk on its "waiting for
  the backend" page indefinitely. If that isn't permitted it opens the GUI
  anyway and logs why: the waiting page naming the address it can't reach is
  more use than an icon that appears to do nothing.

**It never touches the hardware, and never restarts a backend that is already
running** — closing and reopening the GUI mid-boil is safe; the rig carries on
regardless of whether anything is looking at it.

Anything that goes wrong is logged to
`~/.local/state/brew-system/gui-launcher.log`, and reported on screen through
`notify-send`/`zenity` if either is installed.

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
- **Atomic writes**: written to a temp file, flushed to the card, then renamed
  into place — a power cut takes the old config or the new one, never half of
  one. If `config.json` turns out to be unreadable at startup the backend boots
  on `config.default.json` and says so on screen, rather than refusing to start
  on a brew day.

### Which settings are shared with BrewPlanner

Most settings belong to exactly one machine and stay there. The rule for the few
that don't: **whichever machine owns the thing owns the setting for it**, and the
other one follows at runtime. Neither ever writes to the other's settings.

| Setting | Owned by | Followed by |
|---|---|---|
| Power budget (`max_watts`, element watts) | This rig | BrewPlanner's Brew System page, so its sliders enforce the same budget |
| Auto-efficiency curves | This rig | Same |
| Theme colours, including the three vessel colours | This rig | BrewPlanner's mirrored panel, rig card and temperature chart |
| Keg content colours | BrewPlanner (Settings → Keg content colours) | This rig's Keg Info page |

Both directions fail soft. BrewPlanner draws the rig's panel in the rig's shipped
defaults when it can't reach it — which is most of the year, since the rig is
powered off between brews — and the Keg Info page here keeps its built-in palette
when there's no web server to ask. Those built-in values are BrewPlanner's own
shipped palette, so a rig on the bench looks right rather than looking broken.

Kegs are worth a word: both machines read the *same* published Google Sheet, so a
keg has to look the same on both screens. BrewPlanner has the editor for the
palette, so it owns it; this rig reads it through
`GET /api/brew-planner/keg-colors`. The recipe→contents matching rules
(`src/utils/kegContent.js`) are kept in step with BrewPlanner's for the same
reason — linking the same recipe in either place should label the keg the same.

Everything else is deliberately one-sided: GPIO pins, sensor serials and
calibration are this rig's wiring and are never exposed remotely; screen sleep
and cursor visibility are this panel's own display; and BrewPlanner's fermenter,
device-fleet, notification and account settings have nothing to say about a
brewing rig.

### Sensor calibration

Settings → Hardware → Temperature Sensors carries a per-probe offset in °C,
shown next to that probe's live reading. To calibrate, put the probe somewhere
you know the temperature of — ice water is 0 °C, boiling is 100 °C less about
0.3 °C per 100 m of altitude — wait for the reading to settle, and adjust the
offset until it reads right.

The offset is applied once, in the backend's read loop, so regulation, the
safety cutoffs, the chart and the logs all act on the same corrected number.
Offsets are clamped to ±5 °C: a probe further out than that is broken or is not
in the pot it is labelled with, and quietly correcting for it would hide the
fault the heating watcher exists to catch.

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
truth, and it pushes changes to whoever is connected (see
[Live state](#live-state)).

### SSH access — hop via the BrewPlanner Pi

There is no direct way in from outside: this rig sits on the brewery LAN and,
per rule 1 above, is never exposed. The BrewPlanner Pi is the only
internet-reachable machine, so shell access is a two-hop affair.

```
dev machine ──▶ BrewPlanner Pi (web server) ──▶ this rig
                brewplanner@192.168.3.3        pi@192.168.3.4
```

**1. Get onto the BrewPlanner Pi.** On the same LAN:

```bash
ssh brewplanner@brewplanner.local      # or @192.168.3.3 on the brewery LAN
```

From anywhere else it answers over its Cloudflare Tunnel at
`ssh.konfusbrewing.com`, gated by Cloudflare Access — use
`cloudflared access ssh --hostname ssh.konfusbrewing.com` as the ProxyCommand.
The Access login opens a browser (JWT cached ~7 days), so the first connection
can't be done non-interactively. Credentials are not kept in this repo; see the
BrewPlanner repo's `deploy/README-ssh.md`.

**2. Hop to this rig.** From a shell on the BrewPlanner Pi:

```bash
ssh pi@192.168.3.4
ssh pi@192.168.3.4 'systemctl status brew-system.service'   # or one-shot
```

That hop should be passwordless: `brewplanner`'s ed25519 key is already in this
rig's `~/.ssh/authorized_keys`, installed for the dashboard's "Update brew
system" button. If it asks for a password, the key step in BrewPlanner's
`deploy/README-brew-system-update.md` needs redoing.

Once you're on the rig: the backend runs as `brew-system.service` (FastAPI on
`:8000`), and its checkout is wherever that unit points —

```bash
cd "$(systemctl show brew-system.service -p WorkingDirectory --value)"
```

Addresses come from the brewery LAN map in BrewPlanner's `IP.md`
(`192.168.3.x`: `.3` web server, `.4` this rig). The rig has no dependable mDNS
name yet — see [TODO.md](TODO.md) — so use the IP for the second hop.

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

## Start Menu

The app opens on a menu rather than on the brewing screen, because there are two
different things a brewer walks up to this rig to do.

**Start a new brew session** asks for a recipe and a date, then opens a row in
BrewPlanner's logbook and goes to the brewing screen. That row is what makes the
batch a *batch*: BrewPlanner snapshots the recipe as it reads today, puts the
beer in the fermenter, and starts sampling this rig's pot temperatures every 30 s
for as long as the session says `brewing` — so the day comes out with a mash and
boil curve filed against it. The Recipe tab opens straight into that recipe too.

**Go to the brewing system** is the rest of the year. Cleaning, a water test, a
boil to season a new element and chasing a sensor fault are all brewing, and none
of them belongs in the logbook.

Worth knowing:

- **A restart mid-brew doesn't ask again.** On launch the app checks whether
  BrewPlanner already has a session in progress, and if it does, goes straight to
  the brewing screen. A kiosk that reloads during the mash comes back to the
  screen you were looking at, not to a menu offering to start a second session.
- **The recipes are BrewPlanner's.** The session is filed against a recipe in its
  library, and the picker reads that same library — the one the [Recipe
  tab](#recipes) shows. Import from Brewer's Friend on BrewPlanner's own Recipes
  page.
- **No web server, no sessions — but still a rig.** With `BREW_PLANNER_URL`
  unset or the other Pi rebooting, the first choice greys out and says why. The
  second always works. A rig on the bench must never be stopped from brewing by a
  web server being down.
- **Starting a session rolls this rig's temperature log**, the same way
  `/api/hardware/initialize` does — a new CSV, and a `session_reset` to the
  connected charts. Otherwise a brew day's curve would open with however many
  hours of idle bench readings the rig had taken since it was last switched on.
- **The date is for back-dating only.** It defaults to today and won't go past
  it. Left at today, no timestamp is sent at all and BrewPlanner stamps the real
  clock time the brew started.

The menu is reachable again at any time from **Home** in the bottom nav.

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

## Recipes

The Recipe tab reads **BrewPlanner's library**, not Brewer's Friend. That means
one library across the brewery: what the Recipe tab shows, what the start menu
offers to brew, and what a keg can be linked to are the same list, and a recipe
written in BrewPlanner is visible here rather than only existing on the web
server. It also means the brew sheet arrives with the figures BrewPlanner works
out and this rig has no way to:

- **What the batch costs** — the total, per litre, and split by malt / hops /
  yeast / other, with a price on each ingredient line. From BrewPlanner's
  scraped price catalogue, so it can only be read here, never edited. Lines the
  catalogue doesn't cover are counted as "unpriced" rather than silently
  omitted, because the total is short of them.
- **A colour for a grain bill that reports none** — Brewer's Friend returns 0
  EBC for this account, so BrewPlanner calculates from the grain bill (Morey);
  the tile says "EBC (est.)" rather than passing an estimate off as the recipe's
  own figure.
- **The hop schedule in brew order** — additions grouped by Mash / First Wort /
  Boil / Whirlpool / Dry Hop, and each contact time in the unit it was recorded
  in. Dry hops are stored in *days*: this page used to render a 5-day dry hop as
  "5 min".
- **Fermentable flags** — "late" (added after the boil, so it stays out of the
  gravity the hops are utilized against) and "unfermentable" (lactose and
  friends: they raise the gravity and land in the FG).
- **Brew history** — every batch brewed from the sheet, with what it measured
  and how it was rated, and a ×N badge on the list.

Two things are worked out here rather than fetched, both ported from BrewPlanner
so a recipe reads the same in either place:

- **What the beer actually pours.** The malt colour restained by any fruit in
  the other-ingredients list, so a fruited sour shows red rather than the straw
  its grain bill implies (`src/utils/beerColorPrediction.js`).
- **Roughly how long it will ferment**, from the strain, the temperature and the
  gravity (`src/utils/fermentationEstimate.js`). A planning figure for when the
  fermenter comes free — the tooltip says so, and says to confirm with a
  hydrometer.

The style banner down the left of a recipe is the keg palette's colour for that
beer, so a batch wears one colour on the keg board, in this list and on its
sheet — see [Which settings are shared with BrewPlanner](#which-settings-are-shared-with-brewplanner).

**No BrewPlanner, no recipes.** The tab says so and everything else on the rig
keeps working; the hardware has never needed a recipe to run. The rig no longer
talks to Brewer's Friend at all, so `BREWERSFRIEND_API_KEY` is unused — importing
from Brewer's Friend is now BrewPlanner's job, on its own Recipes page.

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
- Sensor sweep: 1 s (the backend's own loop, independent of any UI)
- UI updates: pushed as they happen; an idle rig sends nothing but a
  10 s heartbeat

## License

MIT

## Support

For issues or questions about deployment, refer to:
- Raspberry Pi documentation: https://www.raspberrypi.org/documentation/
- Vite documentation: https://vitejs.dev/
- React documentation: https://react.dev/
