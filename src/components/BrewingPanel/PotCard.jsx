import { useState, useEffect, memo, useRef, useMemo, useCallback } from 'react';
import { getTemperatureColor } from '../../utils/temperatureColor';
import { useTheme } from '../../contexts/ThemeContext';
import { playToggleOn, playToggleOff } from '../../utils/sounds';
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

function PotCard({ name, type, potState, regulationConfig = DEFAULT_REG_CONFIG, effectiveEfficiency = 0, potMaxWatts = 0, efficiencyCap = 100, onUpdate }) {
  const [localSV, setLocalSV] = useState(potState.sv || 75);
  const [localEfficiency, setLocalEfficiency] = useState(potState.efficiency || 0);

  // Refs for reading latest local values in stable callbacks
  const localEfficiencyRef = useRef(localEfficiency);
  localEfficiencyRef.current = localEfficiency;
  const localSVRef = useRef(localSV);
  localSVRef.current = localSV;

  // Track last value sent to parent to throttle updates to 5% boundaries
  const lastSentEfficiency = useRef(Math.round((potState.efficiency || 0) / 5) * 5);
  const lastSentSV = useRef(Math.round((potState.sv || 75) / 5) * 5);

  useEffect(() => {
    if (potState.sv !== undefined) {
      setLocalSV(potState.sv);
    }
    if (potState.efficiency !== undefined) {
      setLocalEfficiency(potState.efficiency);
    }
  }, [potState.sv, potState.efficiency]);

  const handleTogglePower = () => {
    potState.heaterOn ? playToggleOff() : playToggleOn();
    // When turning off, also disable regulation so it doesn't immediately re-enable the heater
    if (potState.heaterOn && potState.regulationEnabled) {
      onUpdate({ heaterOn: false, regulationEnabled: false });
    } else {
      onUpdate({ heaterOn: !potState.heaterOn });
    }
  };

  const handleToggleRegulation = () => {
    potState.regulationEnabled ? playToggleOff() : playToggleOn();
    onUpdate({ regulationEnabled: !potState.regulationEnabled });
  };

  const handleSetTempChange = (e) => {
    const value = parseFloat(e.target.value);
    setLocalSV(value);
    const rounded = Math.round(value / 5) * 5;
    if (rounded !== lastSentSV.current) {
      lastSentSV.current = rounded;
      onUpdate({ sv: value });
    }
  };

  const handleSetTempRelease = useCallback(() => {
    lastSentSV.current = Math.round(localSVRef.current / 5) * 5;
    onUpdate({ sv: localSVRef.current });
  }, [onUpdate]);

  const handleEfficiencyChange = (e) => {
    const value = Math.min(parseFloat(e.target.value), efficiencyCap);
    setLocalEfficiency(value);
    const rounded = Math.round(value / 5) * 5;
    if (rounded !== lastSentEfficiency.current) {
      lastSentEfficiency.current = rounded;
      onUpdate({ efficiency: value });
    }
  };

  const handleEfficiencyRelease = useCallback(() => {
    lastSentEfficiency.current = Math.round(localEfficiencyRef.current / 5) * 5;
    onUpdate({ efficiency: localEfficiencyRef.current });
  }, [onUpdate]);

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
        // Below target – compute step power (capped by the power limit) and ensure heater is on
        const steps = regulationConfig.steps;
        let power = steps[steps.length - 1].power;
        for (const step of steps.slice(0, -1)) {
          if (diff > step.threshold) { power = step.power; break; }
        }
        const cappedPower = Math.min(power, efficiencyCap);
        if (!potState.heaterOn) {
          setLocalEfficiency(cappedPower);
          onUpdate({ heaterOn: true, efficiency: cappedPower });
        } else if (localEfficiency !== cappedPower) {
          setLocalEfficiency(cappedPower);
          onUpdate({ efficiency: cappedPower });
        }
      }
    }
  }, [potState.pv, localSV, potState.regulationEnabled, potState.heaterOn, type, regulationConfig, efficiencyCap]);

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

  // Clamp slider down when the power cap drops below the current requested efficiency
  useEffect(() => {
    if (type !== 'MLT' && localEfficiency > efficiencyCap) {
      setLocalEfficiency(efficiencyCap);
      onUpdate({ efficiency: efficiencyCap });
    }
  }, [efficiencyCap]);

  const { theme } = useTheme();
  const pvColor = getTemperatureColor(potState.pv);
  const svColor = getTemperatureColor(localSV);
  const glowIntensity = type !== 'MLT' && potState.heaterOn ? effectiveEfficiency / 100 : 0;
  const rawWatts = type !== 'MLT' && potState.heaterOn ? (effectiveEfficiency / 100) * potMaxWatts : 0;
  const wattsDrawn = Math.round(rawWatts / 50) * 50;
  const isThrottled = type !== 'MLT' && potState.heaterOn && effectiveEfficiency < localEfficiency;

  // Quantize glow to 5% steps so the border style only changes 20 times, not 100
  const quantizedGlow = glowIntensity > 0 ? Math.round(glowIntensity * 20) / 20 : 0;
  const cardStyle = useMemo(() => ({
    '--glow-border-color': quantizedGlow > 0
      ? `rgba(240, 76, 101, ${0.3 + quantizedGlow * 0.7})`
      : 'transparent',
    boxShadow: quantizedGlow > 0 ? 'none' : 'var(--shadow-card)',
  }), [quantizedGlow]);

  return (
    <div
      className={`${styles.potCard} ${type === 'MLT' ? styles.mlt : ''} ${quantizedGlow > 0 ? styles.glowing : ''}`}
      style={cardStyle}
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
        {type !== 'MLT' && (
          <div className={styles.wattsRow}>
            <span className={`${styles.wattsValue} ${isThrottled ? styles.wattsThrottled : ''}`}>
              {wattsDrawn.toLocaleString()} W
            </span>
            {isThrottled && <span className={styles.throttleTag}>limited</span>}
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
                onPointerUp={handleSetTempRelease}
                className={styles.slider}
                style={{
                  background: `linear-gradient(to right,
                  ${theme.accentBlue} 0%,
                  ${getTemperatureColor(localSV)} ${localSV}%,
                  var(--color-border-light) ${localSV}%,
                  var(--color-border-light) 100%)`,
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
              onPointerUp={handleEfficiencyRelease}
              className={styles.slider}
              disabled={potState.regulationEnabled && regulationConfig.enabled}
              style={{
                background: `linear-gradient(to right,
                  var(--color-gradient-warm-start) 0%,
                  var(--color-gradient-warm-end) ${localEfficiency}%,
                  var(--color-border-light) ${localEfficiency}%,
                  var(--color-border-light) 100%)`,
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

export default memo(PotCard);
