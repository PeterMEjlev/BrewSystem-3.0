/**
 * Mock Hardware Abstraction Layer
 * Simulates temperature sensors, heaters, and pumps
 * Designed for future replacement with real GPIO/hardware drivers
 */

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

    // Start simulation loop
    this.startSimulation();
  }

  startSimulation() {
    setInterval(() => {
      this.updateTemperatures();
    }, 1000);
  }

  updateTemperatures() {
    this.tickCount++;
    this.simulatePotTemperature('BK');
    this.simulatePotTemperature('HLT');
    this.simulatePotTemperature('MLT');
  }

  simulatePotTemperature(potName) {
    const pot = this.pots[potName];
    let tempChange = 0;

    if (potName !== 'MLT' && pot.heaterOn && pot.regulationEnabled) {
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
      pots: { ...this.pots },
      pumps: { ...this.pumps },
    };
  }
}

// Singleton instance
export const brewSystem = new MockBrewSystem();
