# Brew System v3 - Visual Guide

## What You'll See When You Run The Application

### Brewing Panel (Default View)

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │     BK       │  │     MLT      │  │     HLT      │         │
│  │  [ON] [REG]  │  │              │  │  [ON] [REG]  │         │
│  │              │  │              │  │              │         │
│  │   75.3°C     │  │   68.2°C     │  │   80.1°C     │  ◄──PV  │
│  │   → 75.0°C   │  │              │  │   → 80.0°C   │  ◄──SV  │
│  │              │  │              │  │              │         │
│  │ Set Temp:    │  │              │  │ Set Temp:    │         │
│  │ [═══════] 75°│  │              │  │ [═══════] 80°│         │
│  │              │  │              │  │              │         │
│  │ Efficiency:  │  │              │  │ Efficiency:  │         │
│  │ [══════  ] 60│  │              │  │ [═══     ] 30│         │
│  │              │  │              │  │              │         │
│  │  🔥 Glowing  │  │   No Glow    │  │  🔥 Glowing  │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
│                                                                 │
│                  ┌─────────────────────┐                        │
│                  │    Brew Timer       │                        │
│                  │    01:23:45         │                        │
│                  │ [Start] [Pause]     │                        │
│                  │ [Stop]  [Reset]     │                        │
│                  └─────────────────────┘                        │
│                                                                 │
│  ┌────────────────────────┐  ┌────────────────────────┐        │
│  │       Pump 1           │  │       Pump 2           │        │
│  │        [ON]            │  │        [OFF]           │        │
│  │                        │  │                        │        │
│  │   ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬    │  │                        │        │
│  │  ← Moving lines        │  │   (No animation)       │        │
│  │                        │  │                        │        │
│  │  Speed: [═════  ] 75%  │  │  Speed: [       ]  0%  │        │
│  └────────────────────────┘  └────────────────────────┘        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
  ┌──────────────┬──────────────┬──────────────┐
  │   🧪         │   📊         │   ⚙️         │  ← Bottom Nav
  │  Brewing     │ Temperature  │  Settings    │
  │   (Active)   │              │              │
  └──────────────┴──────────────┴──────────────┘
```

### Temperature Chart Panel

```
┌─────────────────────────────────────────────────────────────────┐
│  Temperature Chart              [BK] [MLT] [HLT] ← Toggle        │
│                                                                 │
│  100°C ┤                                                        │
│        │                                    ╱─HLT (blue)        │
│   80°C ┤                              ╱──╱                      │
│        │                        ╱──╱─BK (red)                   │
│   60°C ┤                  ╱──╱                                  │
│        │            ╱──╱─MLT (green)                            │
│   40°C ┤      ╱──╱                                              │
│        │ ╱──╱                                                   │
│   20°C ┼──────────────────────────────────────────────→        │
│         10:30    10:31    10:32    Time                        │
│                                                                 │
│  Chart automatically scrolls as new data arrives               │
│  Click toggle buttons to show/hide pot lines                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
  ┌──────────────┬──────────────┬──────────────┐
  │   🧪         │   📊         │   ⚙️         │
  │  Brewing     │ Temperature  │  Settings    │
  │              │   (Active)   │              │
  └──────────────┴──────────────┴──────────────┘
```

### Settings Panel

```
┌─────────────────────────────────────────────────────────────────┐
│  Settings                                                       │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ Hardware Configuration                                    │ │
│  │                                                           │ │
│  │ GPIO pin mapping configuration will be added here.       │ │
│  │                                                           │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ Sensor Calibration                                        │ │
│  │                                                           │ │
│  │ Temperature sensor calibration controls will be added...  │ │
│  │                                                           │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ System Settings                                           │ │
│  │                                                           │ │
│  │ Update intervals, logging, and other system config...    │ │
│  │                                                           │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ About                                                     │ │
│  │                                                           │ │
│  │ Brew System v3                                            │ │
│  │ Web-based brewery control system                          │ │
│  │ Designed for Raspberry Pi kiosk mode                      │ │
│  │                                                           │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
  ┌──────────────┬──────────────┬──────────────┐
  │   🧪         │   📊         │   ⚙️         │
  │  Brewing     │ Temperature  │  Settings    │
  │              │              │   (Active)   │
  └──────────────┴──────────────┴──────────────┘
```

## Color Scheme (Dark Theme)

### Background Colors
- **Main background**: `#0f172a` (Dark navy)
- **Card background**: `#1e293b` (Slate)
- **Dark sections**: `#0f172a` (Very dark)
- **Bottom nav**: `#1e293b` with top border

### Text Colors
- **Primary text**: `#f1f5f9` (Nearly white)
- **Secondary text**: `#cbd5e1` (Light gray)
- **Labels**: `#94a3b8` (Medium gray)
- **Muted text**: `#64748b` (Dark gray)

### Temperature Colors (Dynamic)
```
0°C   ─────────────► 100°C
Blue              Red
rgb(59,130,246)   rgb(239,68,68)

  ████████████████████
  Blue → Purple-ish → Red
  (No green or yellow!)
```

### Accent Colors
- **Green (ON state)**: `#10b981`
- **Blue (Regulation)**: `#3b82f6`
- **Orange (Heating)**: `#f97316`
- **Red (Stop/Off)**: `#ef4444`
- **Amber (Pause)**: `#f59e0b`
- **Gray (Disabled)**: `#64748b`

## Visual Effects

### Orange Glow Effect (Heaters)
```
Off:                    Low (30%):              High (100%):
┌──────────┐            ┌──────────┐            ┌──────────┐
│          │            │          │            │          │
│    BK    │            │    BK    │░           │    BK    │████
│          │            │          │░           │          │████
│   OFF    │            │   ON     │░           │   ON     │████
└──────────┘            └──────────┘░           └──────────┘████
(No glow)               (Soft glow)             (Intense glow)
```

### Flow Animation (Pumps)
```
OFF:                    ON (Speed 50%):         ON (Speed 100%):
───────────────         ▬▬▬ ───────────         ▬▬▬▬▬▬ ────────
(Static)                (Moderate speed)        (Fast speed)
                        Lines moving →          Lines moving → →
```

### Slider States
```
Temperature Slider (at 75°C):
[██████████████░░░░░░░░░░░░░░░░░░] 75°C
 Blue ────────── Purple ─── Red
 (Filled part matches temp color)

Efficiency Slider (at 60%):
[██████████████████░░░░░░░░░░░░░░] 60%
 Orange ───────────── Gray
 (Orange when active)

Disabled Slider (Regulation ON):
[███████████████████░░░░░░░░░░░░░] 60%
 (Grayed out, can't drag)
```

### Button States

```
Toggle Buttons:

OFF:              ON (Green):      ON (Blue):
┌────────┐        ┌────────┐       ┌────────┐
│  OFF   │        │   ON   │       │  REG   │
└────────┘        └────────┘       └────────┘
Gray border       Green fill       Blue fill

Timer Buttons:

[Start]  [Pause]  [Stop]  [Reset]
Green    Orange   Red     Gray
(Large, touch-friendly)
```

## Touch Interactions

### Expected Behavior

1. **Tap button** → Immediate visual feedback (scale down)
2. **Drag slider** → Thumb follows finger exactly
3. **Release slider** → Value updates hardware
4. **Tap nav button** → Panel switches instantly
5. **No hover effects** → Everything works by touch only

### Slider Interaction
```
Before touch:  [══════░░░░░░] 50%
                      ↓ Touch here
During drag:   [════════░░░░] 62%
                        ● ← Thumb follows finger
After release: [════════░░░░] 62%
               Hardware updated to 62%
```

## Responsive Behavior

### Desktop (1920×1080)
```
┌───────────┬───────────┬───────────┐
│    BK     │    MLT    │    HLT    │  ← Three columns
├───────────┴───────────┴───────────┤
│         Brew Timer                │
├──────────────────┬────────────────┤
│     Pump 1       │    Pump 2      │  ← Two columns
└──────────────────┴────────────────┘
```

### Tablet (1366×768)
```
┌───────────┬───────────┬───────────┐
│    BK     │    MLT    │    HLT    │  ← Still three columns
├───────────┴───────────┴───────────┤
│         Brew Timer                │
├──────────────────┬────────────────┤
│     Pump 1       │    Pump 2      │
└──────────────────┴────────────────┘
(Slightly more compact)
```

### Mobile (< 900px)
```
┌──────────────────┐
│        BK        │  ← Single column
├──────────────────┤
│       MLT        │
├──────────────────┤
│       HLT        │
├──────────────────┤
│   Brew Timer     │
├──────────────────┤
│     Pump 1       │
├──────────────────┤
│     Pump 2       │
└──────────────────┘
(Vertical stack)
```

## What To Look For During Testing

### ✅ Correct Behavior

1. **BK heater ON, no regulation**
   - Temperature rises slowly
   - Efficiency slider can be adjusted manually
   - Orange glow intensity matches efficiency

2. **BK heater ON, regulation enabled**
   - Temperature rises toward target
   - Efficiency adjusts automatically
   - Efficiency slider disabled (grayed out)
   - SV (target) appears below PV

3. **Temperature reaches target**
   - Efficiency drops to 0%
   - Heater stays ON
   - Temperature stabilizes around target
   - Glow effect fades to nothing

4. **MLT card**
   - Only shows current temperature
   - No buttons or sliders
   - No glow effect
   - Simpler appearance than BK/HLT

5. **Pumps**
   - Flow animation only when ON
   - Animation speed matches slider value
   - Animation stops immediately when turned OFF

6. **Brew timer**
   - Counts up from 00:00:00
   - Start button begins counting
   - Pause button freezes time
   - Resume with Start button
   - Stop button stops (time remains)
   - Reset button returns to 00:00:00

7. **Temperature chart**
   - Lines appear for enabled pots
   - Chart scrolls left as time advances
   - Toggle buttons show/hide lines
   - Smooth, real-time updates

8. **Navigation**
   - Active panel highlighted in nav bar
   - Panel switches instantly
   - State persists (timer keeps running)

### ❌ Wrong Behavior (Bugs)

If you see these, something is broken:

- Temperature sliders showing green or yellow (should be blue-red only)
- Pump animation continues when pump is OFF
- BK or HLT glow when heater is OFF
- MLT card with controls
- Timer resets when switching panels
- Efficiency slider active during regulation
- Pot cards in wrong order (must be BK, MLT, HLT)
- Chart not updating
- Buttons not responding to touch/click

## Performance Indicators

### Good Performance
- Smooth 60fps animations
- Instant button response
- Smooth slider dragging
- Chart updates without lag
- Temperature changes visible every second

### Poor Performance (Investigate)
- Stuttering animations
- Delayed button response
- Choppy slider movement
- Chart freezing or jumping
- High CPU usage in dev tools

## First Run Checklist

When you first load the application:

1. [ ] Dark theme loads correctly
2. [ ] Three pot cards visible in correct order
3. [ ] All temperatures showing ~22°C (room temp)
4. [ ] Brew timer at 00:00:00
5. [ ] Pump cards visible below timer
6. [ ] Bottom navigation bar visible
7. [ ] Brewing panel is active by default
8. [ ] No console errors (check F12)
9. [ ] Touch/click works on all buttons
10. [ ] Sliders respond to drag

Then test:

11. [ ] Turn on BK heater → temperature starts rising
12. [ ] Enable BK regulation → efficiency auto-adjusts
13. [ ] Turn on pump → animation starts
14. [ ] Adjust pump speed → animation speed changes
15. [ ] Start timer → counts up
16. [ ] Switch to chart panel → see temperature lines
17. [ ] Switch to settings → see placeholder sections
18. [ ] Return to brewing → everything still working

If all checks pass: ✅ **Application is working correctly!**

## Visual Troubleshooting

### Problem: No glow effect on heaters
- Check: Is heater ON?
- Check: Is efficiency > 0?
- Check: Browser supports box-shadow?

### Problem: Pump animation not visible
- Check: Is pump ON?
- Check: Is speed > 0?
- Check: Browser supports CSS animations?

### Problem: Temperature colors wrong
- Check: `src/utils/temperatureColor.js`
- Should be blue (59,130,246) to red (239,68,68)

### Problem: Layout broken
- Check: Browser window size (minimum 1366×768)
- Check: Browser zoom at 100%
- Check: CSS loaded correctly (F12 → Network tab)

### Problem: Cards in wrong order
- Should always be: BK → MLT → HLT (left to right)
- Check: `src/components/BrewingPanel/BrewingPanel.jsx`

## Kiosk Mode Visual Expectations

When running on Raspberry Pi in kiosk mode:

```
┌───────────────────────────────────────────────────────────┐
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                │
│  │    BK    │  │   MLT    │  │   HLT    │  ← Full screen │
│  └──────────┘  └──────────┘  └──────────┘                │
│                                                           │
│                 ┌─────────────┐                           │
│                 │ Brew Timer  │                           │
│                 └─────────────┘                           │
│                                                           │
│  ┌───────────────┐  ┌───────────────┐                    │
│  │    Pump 1     │  │    Pump 2     │                    │
│  └───────────────┘  └───────────────┘                    │
└───────────────────────────────────────────────────────────┘
  ┌─────────┬──────────┬──────────┐
  │ Brewing │   Chart  │ Settings │ ← Always visible at bottom
  └─────────┴──────────┴──────────┘

- No browser chrome (no address bar, no tabs)
- No cursor (hidden after 0.1s of inactivity)
- Full 1920×1080 or 1366×768 display
- Touch interactions only
- Bottom nav always accessible
```

Perfect for a touchscreen brewery controller! 🍺
