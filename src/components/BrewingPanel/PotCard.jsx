import { useState, useEffect } from 'react';
import { getTemperatureColor, getTemperatureGradient } from '../../utils/temperatureColor';
import { useTheme, hexToRgba } from '../../contexts/ThemeContext';
import styles from './PotCard.module.css';

const DEFAULT_REG_CONFIG = {
  enabled: true,
  steps: [
    { threshold: 5,   power: 100 },
    { threshold: 2,   power: 60  },
    { threshold: 0.5, power: 30  },
    { threshold: 0,   power: 0   },
  ],
};

function PotCard({ name, type, potState, regulationConfig = DEFAULT_REG_CONFIG, onUpdate }) {
  const [localSV, setLocalSV] = useState(potState.sv || 75);
  const [localEfficiency, setLocalEfficiency] = useState(potState.efficiency || 0);

  useEffect(() => {
    if (potState.sv !== undefined) {
      setLocalSV(potState.sv);
    }
    if (potState.efficiency !== undefined) {
      setLocalEfficiency(potState.efficiency);
    }
  }, [potState.sv, potState.efficiency]);

  const handleTogglePower = () => {
    onUpdate({ heaterOn: !potState.heaterOn });
  };

  const handleToggleRegulation = () => {
    onUpdate({ regulationEnabled: !potState.regulationEnabled });
  };

  const handleSetTempChange = (e) => {
    const value = parseFloat(e.target.value);
    setLocalSV(value);
    onUpdate({ sv: value });
  };

  const handleEfficiencyChange = (e) => {
    const value = parseFloat(e.target.value);
    setLocalEfficiency(value);
    onUpdate({ efficiency: value });
  };

  // Auto efficiency control when regulation and auto efficiency are enabled
  useEffect(() => {
    if (type !== 'MLT' && potState.regulationEnabled && regulationConfig.enabled) {
      const diff = localSV - potState.pv;
      if (diff <= 0) {
        // At or above target – turn off heater
        if (potState.heaterOn) {
          onUpdate({ heaterOn: false });
        }
      } else {
        // Below target – compute step power and ensure heater is on
        const steps = regulationConfig.steps;
        let power = steps[steps.length - 1].power;
        for (const step of steps.slice(0, -1)) {
          if (diff > step.threshold) { power = step.power; break; }
        }
        if (!potState.heaterOn) {
          setLocalEfficiency(power);
          onUpdate({ heaterOn: true, efficiency: power });
        } else if (localEfficiency !== power) {
          setLocalEfficiency(power);
          onUpdate({ efficiency: power });
        }
      }
    }
  }, [potState.pv, localSV, potState.regulationEnabled, potState.heaterOn, type, regulationConfig]);

  // Manual efficiency control when regulation is enabled but auto efficiency is off
  useEffect(() => {
    if (type !== 'MLT' && potState.regulationEnabled && !regulationConfig.enabled) {
      const diff = localSV - potState.pv;
      if (diff <= 0) {
        // At or above target – turn off heater
        if (potState.heaterOn) {
          onUpdate({ heaterOn: false });
        }
      } else {
        // Below target – ensure heater is on
        if (!potState.heaterOn) {
          onUpdate({ heaterOn: true, efficiency: localEfficiency });
        }
      }
    }
  }, [potState.pv, localSV, potState.regulationEnabled, potState.heaterOn, type, regulationConfig, localEfficiency]);

  const { theme } = useTheme();
  const pvColor = getTemperatureColor(potState.pv);
  const svColor = getTemperatureColor(localSV);
  const glowIntensity = type !== 'MLT' && potState.heaterOn ? localEfficiency / 100 : 0;

  return (
    <div
      className={`${styles.potCard} ${type === 'MLT' ? styles.mlt : ''}`}
      style={{
        boxShadow:
          glowIntensity > 0
            ? `0 0 ${20 + glowIntensity * 30}px ${hexToRgba(theme.accentOrange, 0.3 + glowIntensity * 0.4)}`
            : '0 4px 6px rgba(0, 0, 0, 0.3)',
      }}
    >
      <div className={styles.header}>
        <h3 className={styles.title}>{name}</h3>
        {type !== 'MLT' && (
          <div className={styles.headerControls}>
            <button
              className={`${styles.toggleBtn} ${potState.heaterOn ? styles.on : ''}`}
              onClick={handleTogglePower}
            >
              {potState.heaterOn ? 'ON' : 'OFF'}
            </button>
            <button
              className={`${styles.toggleBtn} ${styles.regBtn} ${
                potState.regulationEnabled ? styles.on : ''
              }`}
              onClick={handleToggleRegulation}
            >
              REG
            </button>
          </div>
        )}
      </div>

      <div className={styles.tempDisplay}>
        <div className={`${styles.pvSection} ${type === 'MLT' ? styles.mltTemp : ''}`}>
          {type !== 'MLT' && <div className={styles.pvLabel}>Current</div>}
          <div className={styles.pvValue} style={{ color: pvColor }}>
            {potState.pv.toFixed(1)}°
          </div>
        </div>
        {type !== 'MLT' && potState.regulationEnabled && (
          <div className={styles.svSection}>
            <div className={styles.svLabel}>Target</div>
            <div className={styles.svValue} style={{ color: svColor }}>
              {localSV.toFixed(1)}°
            </div>
          </div>
        )}
      </div>

      {type !== 'MLT' && (
        <>
          {potState.regulationEnabled && (
            <div className={styles.control}>
              <label className={styles.controlLabel}>
                Set Temperature
                <span className={styles.controlValue} style={{ color: svColor }}>
                  {localSV.toFixed(0)}°
                </span>
              </label>
              <input
                type="range"
                min="0"
                max="100"
                step="0.5"
                value={localSV}
                onChange={handleSetTempChange}
                className={styles.slider}
                style={{
                  background: `linear-gradient(to right,
                  ${theme.accentBlue} 0%,
                  ${getTemperatureColor(localSV)} ${localSV}%,
                  #475569 ${localSV}%,
                  #475569 100%)`,
                }}
              />
            </div>
          )}

          <div className={styles.control}>
            <label className={styles.controlLabel}>
              Efficiency
              <span className={styles.controlValue}>{localEfficiency.toFixed(0)}%</span>
            </label>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={localEfficiency}
              onChange={handleEfficiencyChange}
              className={styles.slider}
              disabled={potState.regulationEnabled && regulationConfig.enabled}
              style={{
                background: `linear-gradient(to right,
                  ${theme.accentOrange} 0%,
                  ${theme.accentOrange} ${localEfficiency}%,
                  #475569 ${localEfficiency}%,
                  #475569 100%)`,
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

export default PotCard;
