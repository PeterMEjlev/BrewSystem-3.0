import { useState, useEffect } from 'react';
import { getTemperatureColor, getTemperatureGradient } from '../../utils/temperatureColor';
import styles from './PotCard.module.css';

function PotCard({ name, type, potState, onUpdate }) {
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

  // Auto efficiency control when regulation is enabled
  useEffect(() => {
    if (type !== 'MLT' && potState.regulationEnabled && potState.heaterOn) {
      const diff = localSV - potState.pv;
      if (diff > 5) {
        // Far from target: full power
        if (localEfficiency !== 100) {
          setLocalEfficiency(100);
          onUpdate({ efficiency: 100 });
        }
      } else if (diff > 2) {
        // Close to target: medium power
        if (localEfficiency !== 60) {
          setLocalEfficiency(60);
          onUpdate({ efficiency: 60 });
        }
      } else if (diff > 0.5) {
        // Very close: low power
        if (localEfficiency !== 30) {
          setLocalEfficiency(30);
          onUpdate({ efficiency: 30 });
        }
      } else {
        // At or above target: off
        if (localEfficiency !== 0) {
          setLocalEfficiency(0);
          onUpdate({ efficiency: 0 });
        }
      }
    }
  }, [potState.pv, localSV, potState.regulationEnabled, potState.heaterOn, type]);

  const pvColor = getTemperatureColor(potState.pv);
  const svColor = getTemperatureColor(localSV);
  const glowIntensity = type !== 'MLT' && potState.heaterOn ? localEfficiency / 100 : 0;

  return (
    <div
      className={`${styles.potCard} ${type === 'MLT' ? styles.mlt : ''}`}
      style={{
        boxShadow:
          glowIntensity > 0
            ? `0 0 ${20 + glowIntensity * 30}px rgba(249, 115, 22, ${0.3 + glowIntensity * 0.4})`
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
                  rgb(59, 130, 246) 0%,
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
              disabled={potState.regulationEnabled}
              style={{
                background: `linear-gradient(to right,
                  #f97316 0%,
                  #f97316 ${localEfficiency}%,
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
