/**
 * Mock Hardware Abstraction Layer
 * Simulates temperature sensors, heaters, and pumps
 * Designed for future replacement with real GPIO/hardware drivers
 */

import { DEFAULT_AUTO_EFFICIENCY } from './appDefaults';

class MockBrewSystem {
  constructor() {
    // Pot states
    this.pots = {
      BK: {
        pv: 95.0, // Process Value (current temp)
        sv: 100.0, // Set Value (target temp)
        heaterOn: false,
        regulationEnabled: false,
        efficiency: 0,
      },
      MLT: {
        pv: 67.0, // Only PV for MLT
      },
      HLT: {
        pv: 50.0,
        sv: 55.0,
        heaterOn: false,
        regulationEnabled: false,
        efficiency: 0,
      },
    };

    // Pump states
    this.pumps = {
      P1: {
        on: false,
        speed: 0,
      },
      P2: {
        on: false,
        speed: 0,
      },
    };

    // Simulation parameters
    this.ambientTemp = { BK: 95.0, MLT: 67.0, HLT: 50.0 };
    this.heatingRate = 0.15; // °C per second at 100% efficiency
    this.coolingRate = 0.005; // °C per second (gentle pull toward ambient)
    this.tempNoise = 0.3; // Random fluctuation per tick

    // Slow drift parameters — overlapping sine waves create natural-looking wander
    this.drift = {
      BK:  { amp: 4, period: 120, phase: Math.random() * Math.PI * 2 },
      MLT: { amp: 6, period: 90,  phase: Math.random() * Math.PI * 2 },
      HLT: { amp: 8, period: 150, phase: Math.random() * Math.PI * 2 },
    };
    this.tickCount = 0;

    // Auto-efficiency config — mirrors the backend regulation loop so dev
    // mode behaves like production (regulation is backend-authoritative).
    // Kept live via setRegulationConfig, seeded with defaults until then.
    this.regulationConfig = {
      BK:  { enabled: DEFAULT_AUTO_EFFICIENCY.bk.enabled,  steps: DEFAULT_AUTO_EFFICIENCY.bk.steps },
      HLT: { enabled: DEFAULT_AUTO_EFFICIENCY.hlt.enabled, steps: DEFAULT_AUTO_EFFICIENCY.hlt.steps },
    };

    // Start simulation loop
    this.startSimulation();
  }

  startSimulation() {
    // Only simulate in development. In production (on the Pi) the panel and chart
    // read real sensor data from the backend, so ticking these curves every second
    // would be pure wasted work on a resource-constrained device.
    let isDev = false;
    try { isDev = localStorage.getItem('brewSystemEnvironment') === 'development'; } catch { /* SSR/no storage */ }
    if (!isDev) return;
    setInterval(() => {
      this.updateTemperatures();
    }, 1000);
  }

  updateTemperatures() {
    this.tickCount++;
    this.simulateRegulation('BK');
    this.simulateRegulation('HLT');
    this.simulatePotTemperature('BK');
    this.simulatePotTemperature('HLT');
    this.simulatePotTemperature('MLT');
  }

  // Called from the UI whenever settings change so dev mode picks up new
  // auto-efficiency config in the same session, exactly like the backend.
  setRegulationConfig(config) {
    if (config.BK) this.regulationConfig.BK = config.BK;
    if (config.HLT) this.regulationConfig.HLT = config.HLT;
  }

  // Mirrors the backend regulation tick: walk the steps to pick a power level,
  // turn the heater off once the set value is reached.
  simulateRegulation(potName) {
    const pot = this.pots[potName];
    if (!pot.regulationEnabled) return;
    const diff = pot.sv - pot.pv;
    if (diff <= 0) {
      pot.heaterOn = false;
      return;
    }
    const { enabled, steps } = this.regulationConfig[potName];
    if (!enabled) {
      // Manual-efficiency regulation: bang-bang at the user-chosen duty
      pot.heaterOn = true;
      return;
    }
    let power = steps[steps.length - 1].power;
    for (const step of steps.slice(0, -1)) {
      if (diff > step.threshold) { power = step.power; break; }
    }
    pot.heaterOn = true;
    pot.efficiency = power;
  }

  simulatePotTemperature(potName) {
    const pot = this.pots[potName];
    let tempChange = 0;

    if (potName !== 'MLT' && pot.heaterOn) {
      // Heating
      const efficiencyFactor = pot.efficiency / 100;
      tempChange += this.heatingRate * efficiencyFactor;
    }

    // Slow sinusoidal drift — makes the target wander within the band
    const d = this.drift[potName];
    const ambient = this.ambientTemp[potName] ?? 22.0;
    const driftTarget = ambient + d.amp * Math.sin((this.tickCount / d.period) * Math.PI * 2 + d.phase);

    // Pull toward the drifting target
    const tempDiff = pot.pv - driftTarget;
    tempChange -= tempDiff * this.coolingRate;

    // Add per-tick noise
    tempChange += (Math.random() - 0.5) * this.tempNoise;

    // Update temperature
    pot.pv = Math.max(0, Math.min(100, pot.pv + tempChange));
  }

  // Public API for control layer

  setPotHeater(potName, on) {
    if (this.pots[potName] && potName !== 'MLT') {
      this.pots[potName].heaterOn = on;
    }
  }

  setPotRegulation(potName, enabled) {
    if (this.pots[potName] && potName !== 'MLT') {
      this.pots[potName].regulationEnabled = enabled;
    }
  }

  setPotSetValue(potName, sv) {
    if (this.pots[potName] && potName !== 'MLT') {
      this.pots[potName].sv = sv;
    }
  }

  setPotEfficiency(potName, efficiency) {
    if (this.pots[potName] && potName !== 'MLT') {
      this.pots[potName].efficiency = efficiency;
    }
  }

  getPotState(potName) {
    return this.pots[potName];
  }

  setPump(pumpName, on) {
    if (this.pumps[pumpName]) {
      this.pumps[pumpName].on = on;
    }
  }

  setPumpSpeed(pumpName, speed) {
    if (this.pumps[pumpName]) {
      this.pumps[pumpName].speed = speed;
    }
  }

  getPumpState(pumpName) {
    return this.pumps[pumpName];
  }

  getAllStates() {
    return {
      pots: {
        BK: { ...this.pots.BK },
        MLT: { ...this.pots.MLT },
        HLT: { ...this.pots.HLT },
      },
      pumps: {
        P1: { ...this.pumps.P1 },
        P2: { ...this.pumps.P2 },
      },
    };
  }
}

// Singleton instance
export const brewSystem = new MockBrewSystem();
