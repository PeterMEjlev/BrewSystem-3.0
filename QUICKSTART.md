# Brew System v3 - Quick Start Guide

Terminal 1:
python backend/main.py

Terminal 2:
npm run dev

## Development (Desktop Browser)

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

Open http://localhost:5173 in your browser.

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

## Kiosk Mode Setup (One-time)

On Raspberry Pi:

```bash
# Install Chromium
sudo apt-get update
sudo apt-get install chromium-browser unclutter

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
@chromium-browser --kiosk --disable-restore-session-state http://localhost/
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
