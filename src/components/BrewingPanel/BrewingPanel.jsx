import { useState, useEffect } from 'react';
import { brewSystem } from '../../utils/mockHardware';
import PotCard from './PotCard';
import PumpCard from './PumpCard';
import BrewTimer from './BrewTimer';
import styles from './BrewingPanel.module.css';

function BrewingPanel() {
  const [states, setStates] = useState(brewSystem.getAllStates());

  useEffect(() => {
    // Poll hardware state every 500ms
    const interval = setInterval(() => {
      setStates(brewSystem.getAllStates());
    }, 500);

    return () => clearInterval(interval);
  }, []);

  const handlePotUpdate = (potName, updates) => {
    if (updates.heaterOn !== undefined) {
      brewSystem.setPotHeater(potName, updates.heaterOn);
    }
    if (updates.regulationEnabled !== undefined) {
      brewSystem.setPotRegulation(potName, updates.regulationEnabled);
    }
    if (updates.sv !== undefined) {
      brewSystem.setPotSetValue(potName, updates.sv);
    }
    if (updates.efficiency !== undefined) {
      brewSystem.setPotEfficiency(potName, updates.efficiency);
    }
    // Force immediate update
    setStates(brewSystem.getAllStates());
  };

  const handlePumpUpdate = (pumpName, updates) => {
    if (updates.on !== undefined) {
      brewSystem.setPump(pumpName, updates.on);
    }
    if (updates.speed !== undefined) {
      brewSystem.setPumpSpeed(pumpName, updates.speed);
    }
    // Force immediate update
    setStates(brewSystem.getAllStates());
  };

  return (
    <div className={styles.brewingPanel}>
      {/* Pot Cards Row - Strict order: BK, MLT, HLT */}
      <div className={styles.potRow}>
        <PotCard
          name="BK"
          type="BK"
          potState={states.pots.BK}
          onUpdate={(updates) => handlePotUpdate('BK', updates)}
        />
        <PotCard
          name="MLT"
          type="MLT"
          potState={states.pots.MLT}
          onUpdate={() => {}}
        />
        <PotCard
          name="HLT"
          type="HLT"
          potState={states.pots.HLT}
          onUpdate={(updates) => handlePotUpdate('HLT', updates)}
        />
      </div>

      {/* Brew Timer */}
      <div className={styles.timerRow}>
        <BrewTimer />
      </div>

      {/* Pump Cards Row */}
      <div className={styles.pumpRow}>
        <PumpCard
          name="Pump 1"
          pumpState={states.pumps.P1}
          onUpdate={(updates) => handlePumpUpdate('P1', updates)}
        />
        <PumpCard
          name="Pump 2"
          pumpState={states.pumps.P2}
          onUpdate={(updates) => handlePumpUpdate('P2', updates)}
        />
      </div>
    </div>
  );
}

export default BrewingPanel;
