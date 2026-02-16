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
        pv: 22.0, // Process Value (current temp)
        sv: 75.0, // Set Value (target temp)
        heaterOn: false,
        regulationEnabled: false,
        efficiency: 0,
      },
      MLT: {
        pv: 21.5, // Only PV for MLT
      },
      HLT: {
        pv: 23.0,
        sv: 80.0,
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
    this.ambientTemp = 22.0;
    this.heatingRate = 0.15; // °C per second at 100% efficiency
    this.coolingRate = 0.02; // °C per second
    this.tempNoise = 0.1; // Random fluctuation

    // Start simulation loop
    this.startSimulation();
  }

  startSimulation() {
    setInterval(() => {
      this.updateTemperatures();
    }, 1000);
  }

  updateTemperatures() {
    // Update BK
    this.simulatePotTemperature('BK');
    // Update HLT
    this.simulatePotTemperature('HLT');
    // Update MLT (passive cooling only)
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

    // Cooling toward ambient
    const tempDiff = pot.pv - this.ambientTemp;
    tempChange -= tempDiff * this.coolingRate;

    // Add noise
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
