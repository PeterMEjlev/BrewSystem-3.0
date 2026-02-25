import { useState, useEffect, useRef, useCallback } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import styles from './Settings.module.css';

function Settings() {
  const { theme, updateTheme, resetTheme } = useTheme();
  const panelRef = useRef(null);
  const dragState = useRef({ isDragging: false, startY: 0, startScroll: 0, moved: false });

  const onPointerDown = useCallback((e) => {
    // Don't initiate drag on interactive elements
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'TEXTAREA') return;

    dragState.current = {
      isDragging: true,
      startY: e.clientY,
      startScroll: panelRef.current.scrollTop,
      moved: false,
    };
  }, []);

  const onPointerMove = useCallback((e) => {
    if (!dragState.current.isDragging) return;
    const dy = e.clientY - dragState.current.startY;
    if (Math.abs(dy) > 3) dragState.current.moved = true;
    panelRef.current.scrollTop = dragState.current.startScroll - dy;
  }, []);

  const onPointerUp = useCallback(() => {
    dragState.current.isDragging = false;
  }, []);

  const onClickCapture = useCallback((e) => {
    // Suppress clicks that were actually drags
    if (dragState.current.moved) {
      e.stopPropagation();
      dragState.current.moved = false;
    }
  }, []);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState('');
  const [isDevelopment, setIsDevelopment] = useState(false);
  const [expandedSections, setExpandedSections] = useState({
    programSettings: true,
    rpiHardware: false,
    guiColors: false,
    potControl: true,
    pumpControl: true,
    heatingPWM: true,
    pumpPWM: true,
    pwmFrequencies: true,
    temperatureSensors: true,
  });

  useEffect(() => {
    const savedEnvironment = localStorage.getItem('brewSystemEnvironment');
    setIsDevelopment(savedEnvironment === 'development');
  }, []);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const response = await fetch('/api/settings');
      if (!response.ok) throw new Error('Failed to fetch settings');
      const data = await response.json();
      setSettings(data);
    } catch (error) {
      console.error('Error fetching settings:', error);
      setSaveStatus('Error loading settings');
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async (updatedSettings) => {
    try {
      setSaveStatus('Saving...');
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedSettings),
      });
      if (!response.ok) throw new Error('Failed to save settings');
      setSaveStatus('Saved ✓');
      setTimeout(() => setSaveStatus(''), 2000);
    } catch (error) {
      console.error('Error saving settings:', error);
      setSaveStatus('Error saving');
      setTimeout(() => setSaveStatus(''), 3000);
    }
  };

  const updateSetting = (path, value) => {
    const newSettings = { ...settings };
    const keys = path.split('.');
    let current = newSettings;
    for (let i = 0; i < keys.length - 1; i++) {
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
    setSettings(newSettings);
    saveSettings(newSettings);
  };

  const updateEfficiencyStep = (index, field, value) => {
    const newSteps = settings.app.auto_efficiency.steps.map((s, i) =>
      i === index ? { ...s, [field]: value } : s
    );
    const newSettings = {
      ...settings,
      app: {
        ...settings.app,
        auto_efficiency: { ...settings.app.auto_efficiency, steps: newSteps },
      },
    };
    setSettings(newSettings);
    saveSettings(newSettings);
  };

  const toggleSection = (section) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const updateColor = (colorKey, value) => {
    updateTheme(colorKey, value);
    const newSettings = {
      ...settings,
      theme: { ...settings.theme, [colorKey]: value },
    };
    setSettings(newSettings);
    saveSettings(newSettings);
  };

  const handleResetColors = () => {
    resetTheme();
    const newSettings = { ...settings, theme: {} };
    setSettings(newSettings);
    saveSettings(newSettings);
  };

  const toggleEnvironment = () => {
    const newValue = !isDevelopment;
    setIsDevelopment(newValue);
    localStorage.setItem('brewSystemEnvironment', newValue ? 'development' : 'production');
  };

  if (loading) {
    return (
      <div className={styles.settingsPanel}>
        <h2 className={styles.title}>Settings</h2>
        <p className={styles.loading}>Loading settings...</p>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className={styles.settingsPanel}>
        <h2 className={styles.title}>Settings</h2>
        <p className={styles.error}>Failed to load settings</p>
      </div>
    );
  }

  const steps = settings.app.auto_efficiency.steps;

  return (
    <div
      className={styles.settingsPanel}
      ref={panelRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClickCapture={onClickCapture}
    >
      <div className={styles.header}>
        <h2 className={styles.title}>Settings</h2>
        <div className={styles.headerRight}>
          <div className={styles.environmentToggle}>
            <label className={styles.toggleLabel}>
              <input
                type="checkbox"
                checked={isDevelopment}
                onChange={toggleEnvironment}
                className={styles.toggleInput}
              />
              <span className={styles.toggleSlider}></span>
              <span className={styles.toggleText}>
                {isDevelopment ? 'Dev (Windows)' : 'Production (Pi)'}
              </span>
            </label>
          </div>
          {saveStatus && <span className={styles.saveStatus}>{saveStatus}</span>}
        </div>
      </div>

      {/* Program Settings */}
      <div className={styles.section}>
        <h3
          className={styles.sectionTitle}
          onClick={() => toggleSection('programSettings')}
        >
          <span className={expandedSections.programSettings ? styles.expanded : styles.collapsed}>▼</span>
          Program Settings
        </h3>
        {expandedSections.programSettings && (
          <div className={styles.sectionContent}>

            {/* Chart logging frequency */}
            <div className={styles.inputGroup}>
              <label>Chart Logging Frequency (seconds):</label>
              <input
                type="number"
                min="1"
                value={settings.app.log_interval_seconds}
                onChange={(e) => updateSetting('app.log_interval_seconds', parseInt(e.target.value))}
              />
            </div>

            {/* Auto efficiency control */}
            <div className={styles.subsectionTitle}>Auto Efficiency Control</div>

            <div className={styles.inputGroup}>
              <label>Enabled:</label>
              <label className={styles.toggleLabel}>
                <input
                  type="checkbox"
                  checked={settings.app.auto_efficiency.enabled}
                  onChange={(e) => updateSetting('app.auto_efficiency.enabled', e.target.checked)}
                  className={styles.toggleInput}
                />
                <span className={styles.toggleSlider}></span>
                <span className={styles.toggleText}>
                  {settings.app.auto_efficiency.enabled ? 'On' : 'Off'}
                </span>
              </label>
            </div>

            {settings.app.auto_efficiency.enabled && (
              <div className={styles.thresholdTable}>
                <div className={styles.thresholdHeader}>
                  <span>Condition</span>
                  <span>Power</span>
                </div>
                {steps.slice(0, -1).map((step, i) => (
                  <div key={i} className={styles.thresholdRow}>
                    <span className={styles.thresholdLabel}>diff &gt;</span>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={step.threshold}
                      onChange={(e) => updateEfficiencyStep(i, 'threshold', parseFloat(e.target.value))}
                      className={styles.thresholdInput}
                    />
                    <span className={styles.thresholdLabel}>°C</span>
                    <span className={styles.thresholdArrow}>→</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={step.power}
                      onChange={(e) => updateEfficiencyStep(i, 'power', parseFloat(e.target.value))}
                      className={styles.thresholdInput}
                    />
                    <span className={styles.thresholdLabel}>%</span>
                  </div>
                ))}
                <div className={styles.thresholdRow}>
                  <span className={`${styles.thresholdLabel} ${styles.thresholdElse}`}>else</span>
                  <span className={styles.thresholdArrow}>→</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={steps[steps.length - 1].power}
                    onChange={(e) => updateEfficiencyStep(steps.length - 1, 'power', parseFloat(e.target.value))}
                    className={styles.thresholdInput}
                  />
                  <span className={styles.thresholdLabel}>%</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Raspberry Pi Hardware */}
      <div className={styles.section}>
        <h3
          className={styles.sectionTitle}
          onClick={() => toggleSection('rpiHardware')}
        >
          <span className={expandedSections.rpiHardware ? styles.expanded : styles.collapsed}>▼</span>
          Raspberry Pi Hardware
        </h3>
        {expandedSections.rpiHardware && (
          <div className={styles.sectionContent}>

            {/* Pot Control GPIO Pins */}
            <div className={styles.subSection}>
              <h4
                className={styles.subSectionTitle}
                onClick={() => toggleSection('potControl')}
              >
                <span className={expandedSections.potControl ? styles.expanded : styles.collapsed}>▼</span>
                Pot Control GPIO Pins
              </h4>
              {expandedSections.potControl && (
                <div className={styles.sectionContent}>
                  <div className={styles.inputGroup}>
                    <label>BK Pot Pin:</label>
                    <input
                      type="number"
                      value={settings.gpio.pot.bk}
                      onChange={(e) => updateSetting('gpio.pot.bk', parseInt(e.target.value))}
                    />
                  </div>
                  <div className={styles.inputGroup}>
                    <label>HLT Pot Pin:</label>
                    <input
                      type="number"
                      value={settings.gpio.pot.hlt}
                      onChange={(e) => updateSetting('gpio.pot.hlt', parseInt(e.target.value))}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Pump Control GPIO Pins */}
            <div className={styles.subSection}>
              <h4
                className={styles.subSectionTitle}
                onClick={() => toggleSection('pumpControl')}
              >
                <span className={expandedSections.pumpControl ? styles.expanded : styles.collapsed}>▼</span>
                Pump Control GPIO Pins
              </h4>
              {expandedSections.pumpControl && (
                <div className={styles.sectionContent}>
                  <div className={styles.inputGroup}>
                    <label>Pump 1 Pin:</label>
                    <input
                      type="number"
                      value={settings.gpio.pump.p1}
                      onChange={(e) => updateSetting('gpio.pump.p1', parseInt(e.target.value))}
                    />
                  </div>
                  <div className={styles.inputGroup}>
                    <label>Pump 2 Pin:</label>
                    <input
                      type="number"
                      value={settings.gpio.pump.p2}
                      onChange={(e) => updateSetting('gpio.pump.p2', parseInt(e.target.value))}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Heating Element PWM Pins */}
            <div className={styles.subSection}>
              <h4
                className={styles.subSectionTitle}
                onClick={() => toggleSection('heatingPWM')}
              >
                <span className={expandedSections.heatingPWM ? styles.expanded : styles.collapsed}>▼</span>
                Heating Element PWM Pins (Hardware PWM)
              </h4>
              {expandedSections.heatingPWM && (
                <div className={styles.sectionContent}>
                  <div className={styles.inputGroup}>
                    <label>BK PWM Pin:</label>
                    <input
                      type="number"
                      value={settings.gpio.pwm_heating.bk}
                      onChange={(e) => updateSetting('gpio.pwm_heating.bk', parseInt(e.target.value))}
                    />
                  </div>
                  <div className={styles.inputGroup}>
                    <label>HLT PWM Pin:</label>
                    <input
                      type="number"
                      value={settings.gpio.pwm_heating.hlt}
                      onChange={(e) => updateSetting('gpio.pwm_heating.hlt', parseInt(e.target.value))}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Pump PWM Pins */}
            <div className={styles.subSection}>
              <h4
                className={styles.subSectionTitle}
                onClick={() => toggleSection('pumpPWM')}
              >
                <span className={expandedSections.pumpPWM ? styles.expanded : styles.collapsed}>▼</span>
                Pump PWM Pins (Software PWM)
              </h4>
              {expandedSections.pumpPWM && (
                <div className={styles.sectionContent}>
                  <div className={styles.inputGroup}>
                    <label>Pump 1 PWM Pin:</label>
                    <input
                      type="number"
                      value={settings.gpio.pwm_pump.p1}
                      onChange={(e) => updateSetting('gpio.pwm_pump.p1', parseInt(e.target.value))}
                    />
                  </div>
                  <div className={styles.inputGroup}>
                    <label>Pump 2 PWM Pin:</label>
                    <input
                      type="number"
                      value={settings.gpio.pwm_pump.p2}
                      onChange={(e) => updateSetting('gpio.pwm_pump.p2', parseInt(e.target.value))}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* PWM Frequencies */}
            <div className={styles.subSection}>
              <h4
                className={styles.subSectionTitle}
                onClick={() => toggleSection('pwmFrequencies')}
              >
                <span className={expandedSections.pwmFrequencies ? styles.expanded : styles.collapsed}>▼</span>
                PWM Frequencies
              </h4>
              {expandedSections.pwmFrequencies && (
                <div className={styles.sectionContent}>
                  <div className={styles.inputGroup}>
                    <label>Hardware PWM Frequency (Hz):</label>
                    <input
                      type="number"
                      value={settings.pwm.frequency}
                      onChange={(e) => updateSetting('pwm.frequency', parseInt(e.target.value))}
                    />
                  </div>
                  <div className={styles.inputGroup}>
                    <label>Software PWM Frequency (Hz):</label>
                    <input
                      type="number"
                      value={settings.pwm.software_frequency}
                      onChange={(e) => updateSetting('pwm.software_frequency', parseInt(e.target.value))}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Temperature Sensors */}
            <div className={styles.subSection}>
              <h4
                className={styles.subSectionTitle}
                onClick={() => toggleSection('temperatureSensors')}
              >
                <span className={expandedSections.temperatureSensors ? styles.expanded : styles.collapsed}>▼</span>
                Temperature Sensors (DS18B20)
              </h4>
              {expandedSections.temperatureSensors && (
                <div className={styles.sectionContent}>
                  <div className={styles.inputGroup}>
                    <label>BK Sensor Serial:</label>
                    <input
                      type="text"
                      value={settings.sensors.ds18b20.bk}
                      onChange={(e) => updateSetting('sensors.ds18b20.bk', e.target.value)}
                    />
                  </div>
                  <div className={styles.inputGroup}>
                    <label>MLT Sensor Serial:</label>
                    <input
                      type="text"
                      value={settings.sensors.ds18b20.mlt}
                      onChange={(e) => updateSetting('sensors.ds18b20.mlt', e.target.value)}
                    />
                  </div>
                  <div className={styles.inputGroup}>
                    <label>HLT Sensor Serial:</label>
                    <input
                      type="text"
                      value={settings.sensors.ds18b20.hlt}
                      onChange={(e) => updateSetting('sensors.ds18b20.hlt', e.target.value)}
                    />
                  </div>
                  <div className={styles.inputGroup}>
                    <label>DS18B20 Data Pin:</label>
                    <input
                      type="number"
                      value={settings.sensors.ds18b20.pin}
                      onChange={(e) => updateSetting('sensors.ds18b20.pin', parseInt(e.target.value))}
                    />
                  </div>
                </div>
              )}
            </div>

          </div>
        )}
      </div>

      {/* GUI Colors */}
      <div className={styles.section}>
        <h3
          className={styles.sectionTitle}
          onClick={() => toggleSection('guiColors')}
        >
          <span className={expandedSections.guiColors ? styles.expanded : styles.collapsed}>▼</span>
          GUI Colors
        </h3>
        {expandedSections.guiColors && (
          <div className={styles.sectionContent}>

            <div className={styles.subsectionTitle}>Backgrounds</div>
            <div className={styles.colorGroup}>
              <label>Primary Background:</label>
              <input
                type="color"
                value={theme.bgPrimary}
                onChange={(e) => updateColor('bgPrimary', e.target.value)}
                className={styles.colorPicker}
              />
            </div>
            <div className={styles.colorGroup}>
              <label>Card Background:</label>
              <input
                type="color"
                value={theme.bgSecondary}
                onChange={(e) => updateColor('bgSecondary', e.target.value)}
                className={styles.colorPicker}
              />
            </div>

            <div className={styles.subsectionTitle}>Accent Colors</div>
            <div className={styles.colorGroup}>
              <label>Blue (Controls):</label>
              <input
                type="color"
                value={theme.accentBlue}
                onChange={(e) => updateColor('accentBlue', e.target.value)}
                className={styles.colorPicker}
              />
            </div>
            <div className={styles.colorGroup}>
              <label>Green (ON State):</label>
              <input
                type="color"
                value={theme.accentGreen}
                onChange={(e) => updateColor('accentGreen', e.target.value)}
                className={styles.colorPicker}
              />
            </div>
            <div className={styles.colorGroup}>
              <label>Orange (Heating):</label>
              <input
                type="color"
                value={theme.accentOrange}
                onChange={(e) => updateColor('accentOrange', e.target.value)}
                className={styles.colorPicker}
              />
            </div>

            <div className={styles.subsectionTitle}>Vessel / Chart Colors</div>
            <div className={styles.colorGroup}>
              <label>BK (Boil Kettle):</label>
              <input
                type="color"
                value={theme.vesselBK}
                onChange={(e) => updateColor('vesselBK', e.target.value)}
                className={styles.colorPicker}
              />
            </div>
            <div className={styles.colorGroup}>
              <label>MLT (Mash Tun):</label>
              <input
                type="color"
                value={theme.vesselMLT}
                onChange={(e) => updateColor('vesselMLT', e.target.value)}
                className={styles.colorPicker}
              />
            </div>
            <div className={styles.colorGroup}>
              <label>HLT (Hot Liquor):</label>
              <input
                type="color"
                value={theme.vesselHLT}
                onChange={(e) => updateColor('vesselHLT', e.target.value)}
                className={styles.colorPicker}
              />
            </div>

            <button className={styles.resetBtn} onClick={handleResetColors}>
              Reset to Defaults
            </button>
          </div>
        )}
      </div>

      {/* About Section */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>About</h3>
        <div className={styles.info}>
          <p><strong>Brew System v3</strong></p>
          <p>Web-based brewery control system</p>
          <p>Designed for Raspberry Pi kiosk mode</p>
        </div>
      </div>
    </div>
  );
}

export default Settings;
