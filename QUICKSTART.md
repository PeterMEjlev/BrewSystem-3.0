# Brew System v3 - Quick Start Guide

## Dev Mode (PC - Browser)

```bash
# Terminal 1: Start backend
python backend/main.py

# Terminal 2: Start Vite dev server
npm run dev
```

Open http://localhost:5173 in your browser. Hot reload is enabled.

## Kiosk Mode (PC - Electron Fullscreen)

```bash
# Terminal 1: Start backend
python backend/main.py

# Terminal 2: Start Vite dev server
npm run dev

# Terminal 3: Launch Electron kiosk window
npm run electron:dev
```

Press **Ctrl+Shift+Q** to exit kiosk mode.

## Kiosk Mode (Raspberry Pi)

```bash
# Terminal 1: Start backend (or use systemd service)
python backend/main.py

# Terminal 2: Launch Electron kiosk window
npm run electron:start
```

For auto-start on boot, see the [Kiosk Setup](#kiosk-setup-on-raspberry-pi-one-time) section below.

---

## Development (Desktop Browser)

The application includes:
- **Mock hardware simulation** - Temperatures change dynamically
- **Hot reload** - Changes reflect instantly during development
- **Touch simulation** - Works with mouse clicks

## Testing the Interface

### Brewing Panel

1. **Turn on BK heater**
   - Click the "OFF" button to toggle to "ON"
   - Watch temperature start rising

2. **Enable temperature regulation**
   - Click the "REG" button
   - Watch efficiency automatically adjust based on temperature
   - Observe the orange glow effect intensity

3. **Adjust set temperature**
   - Drag the "Set Temperature" slider
   - Notice the color changes from blue to red
   - Target temperature appears when regulation is enabled

4. **Control pumps**
   - Turn on Pump 1 or Pump 2
   - Adjust pump speed slider
   - Watch flow animation speed change

5. **Use brew timer**
   - Click "Start" to begin timing
   - Click "Pause" to pause (resume with Start)
   - Click "Stop" to stop timing
   - Click "Reset" to reset to 00:00:00

### Temperature Chart Panel

- Click the bottom navigation icon to switch panels
- Toggle BK/MLT/HLT buttons to show/hide temperature lines
- Chart scrolls automatically as new data arrives

### Settings Panel

- Placeholder for future configuration options
- Will include GPIO mapping, calibration, and system settings

## Production Build

```bash
# Build for production
npm run build

# Test the production build locally
npm install -g serve
serve -s dist
```

## Deploy to Raspberry Pi

### Option 1: Automated Deployment

```bash
chmod +x deploy-to-pi.sh
./deploy-to-pi.sh raspberrypi.local
```

### Option 2: Manual Deployment

```bash
# Build
npm run build

# Copy to Pi
scp -r dist/ pi@raspberrypi.local:~/brew-system-v3/

# SSH to Pi and install
ssh pi@raspberrypi.local
sudo cp -r ~/brew-system-v3/dist/* /var/www/html/
sudo systemctl restart lighttpd
```

## Electron Kiosk Mode

The app uses an Electron wrapper for fullscreen kiosk mode.

### How to Use

- **Dev mode** (with Vite hot reload): Start `npm run dev` in one terminal, then `npm run electron:dev` in another
- **Production** (on Pi): Start the FastAPI backend, then `npm run electron:start`
- **Exit kiosk**: Press **Ctrl+Shift+Q**

### Kiosk Setup on Raspberry Pi (One-time)

```bash
# Install unclutter to hide mouse cursor
sudo apt-get update
sudo apt-get install unclutter

# Create autostart file
mkdir -p ~/.config/lxsession/LXDE-pi
nano ~/.config/lxsession/LXDE-pi/autostart
```

Add these lines:

```
@xset s off
@xset -dpms
@xset s noblank
@unclutter -idle 0.1 -root
@/home/pi/brew-system-v3/node_modules/.bin/electron /home/pi/brew-system-v3
```

Save and reboot:

```bash
sudo reboot
```

## Component Overview

### Strict Layout Rules (Brewing Panel)

**Top Row - Pot Cards (Fixed Order):**
- Position 1: BK (Boil Kettle)
- Position 2: MLT (Mash Lauter Tun)
- Position 3: HLT (Hot Liquor Tank)

**Middle Row - Brew Timer:**
- Centered timer widget
- Start/Pause/Stop/Reset controls

**Bottom Row - Pump Cards:**
- Pump 1 (P1)
- Pump 2 (P2)

### Visual Indicators

**Orange Glow (Heaters):**
- Appears on BK and HLT when heating
- Intensity increases with efficiency level
- Smooth transitions

**Flow Animation (Pumps):**
- Moving lines indicate active pump
- Animation speed matches pump speed
- Stops immediately when pump turns off

**Temperature Colors:**
- Blue (0°C) → Red (100°C)
- No green or yellow tones
- Applies to PV display and temperature sliders

## Troubleshooting

### Development Server Won't Start

```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
npm run dev
```

### Build Fails

```bash
# Check Node.js version
node --version  # Should be 18+

# Update dependencies
npm update
npm run build
```

### Can't Connect to Raspberry Pi

```bash
# Find Pi on network
ping raspberrypi.local

# If not found, use IP address instead
# Find IP: ssh pi@raspberrypi.local "hostname -I"
```

### Kiosk Mode Not Starting

```bash
# Check autostart file location
cat ~/.config/lxsession/LXDE-pi/autostart

# Check Chromium installation
which chromium-browser

# Check lighttpd status
sudo systemctl status lighttpd
```

### Temperature Chart Not Updating

- Refresh the page
- Check browser console for errors (F12)
- Verify mock hardware is initialized (should see temperature changes)

## Hardware Integration Next Steps

1. **Review `src/utils/mockHardware.js`**
   - This is your hardware abstraction layer
   - Replace with real GPIO/sensor code

2. **Install GPIO libraries**
   ```bash
   npm install onoff  # For GPIO control
   npm install ds18b20-raspi  # For temperature sensors
   ```

3. **Map GPIO pins in Settings panel**
   - Create UI for pin configuration
   - Store in localStorage or config file

4. **Implement SSR control**
   - Use GPIO outputs for heater control
   - Add safety limits and timeout protection

5. **Implement PWM for pumps**
   - Use hardware PWM pins for smooth speed control
   - Add flow rate monitoring if sensors available

6. **Add sensor reading**
   - Implement DS18B20 1-Wire protocol
   - Add calibration offsets
   - Implement error handling for sensor failures

## Performance Optimization

The application is already optimized for Raspberry Pi:

- **Small bundle**: ~170KB gzipped
- **Efficient updates**: Polling at 500ms intervals
- **GPU acceleration**: CSS transforms for animations
- **Touch-optimized**: Large hit areas, no hover states
- **Memory efficient**: Fixed-size chart buffer (120 points)

## Security Notes

For production deployment:

- Change default Pi password
- Configure firewall (ufw) if network-accessible
- Consider HTTPS if accessing remotely (use nginx with Let's Encrypt)
- Disable SSH password authentication, use keys only

## Support

Issues or questions:
- Check README.md for detailed documentation
- Review component source code (well-commented)
- Inspect browser console for errors
- Test in desktop browser before deploying to Pi
