# Brew System v3

A modern web-based brewery control system designed for Raspberry Pi kiosk mode deployment.

## Features

- **Touch-optimized UI** - Large buttons, generous spacing, designed for 14" touchscreen
- **Dark mode interface** - Sleek, modern design optimized for brewery environments
- **Real-time monitoring** - Live temperature tracking with visual feedback
- **Brew timer** - Integrated timing system with Start/Pause/Stop/Reset controls
- **Hardware abstraction** - Mock system for development, ready for GPIO integration
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

### 6. Set Up Kiosk Mode

Install Chromium and unclutter:

```bash
sudo apt-get install chromium-browser unclutter
```

Create autostart script (`~/.config/lxsession/LXDE-pi/autostart`):

```bash
@xset s off
@xset -dpms
@xset s noblank
@unclutter -idle 0.1 -root
@chromium-browser --kiosk --disable-restore-session-state http://localhost:8000/
```

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
