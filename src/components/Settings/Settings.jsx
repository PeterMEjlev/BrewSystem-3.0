import { useState, useEffect } from 'react';
import styles from './Settings.module.css';

function Settings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState('');
  const [isDevelopment, setIsDevelopment] = useState(false);
  const [expandedSections, setExpandedSections] = useState({
    potControl: true,
    pumpControl: true,
    heatingPWM: true,
    pumpPWM: true,
    pwmFrequencies: true,
    temperatureSensors: true,
  });

  // Load environment preference from localStorage on mount
  useEffect(() => {
    const savedEnvironment = localStorage.getItem('brewSystemEnvironment');
    setIsDevelopment(savedEnvironment === 'development');
  }, []);

  // Fetch settings on mount
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
        headers: {
          'Content-Type': 'application/json',
        },
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

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
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

  return (
    <div className={styles.settingsPanel}>
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

      {/* Pot Control GPIO Pins */}
      <div className={styles.section}>
        <h3
          className={styles.sectionTitle}
          onClick={() => toggleSection('potControl')}
        >
          <span className={expandedSections.potControl ? styles.expanded : styles.collapsed}>▼</span>
          Pot Control GPIO Pins
        </h3>
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
      <div className={styles.section}>
        <h3
          className={styles.sectionTitle}
          onClick={() => toggleSection('pumpControl')}
        >
          <span className={expandedSections.pumpControl ? styles.expanded : styles.collapsed}>▼</span>
          Pump Control GPIO Pins
        </h3>
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
      <div className={styles.section}>
        <h3
          className={styles.sectionTitle}
          onClick={() => toggleSection('heatingPWM')}
        >
          <span className={expandedSections.heatingPWM ? styles.expanded : styles.collapsed}>▼</span>
          Heating Element PWM Pins (Hardware PWM)
        </h3>
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
      <div className={styles.section}>
        <h3
          className={styles.sectionTitle}
          onClick={() => toggleSection('pumpPWM')}
        >
          <span className={expandedSections.pumpPWM ? styles.expanded : styles.collapsed}>▼</span>
          Pump PWM Pins (Software PWM)
        </h3>
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
      <div className={styles.section}>
        <h3
          className={styles.sectionTitle}
          onClick={() => toggleSection('pwmFrequencies')}
        >
          <span className={expandedSections.pwmFrequencies ? styles.expanded : styles.collapsed}>▼</span>
          PWM Frequencies
        </h3>
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
      <div className={styles.section}>
        <h3
          className={styles.sectionTitle}
          onClick={() => toggleSection('temperatureSensors')}
        >
          <span className={expandedSections.temperatureSensors ? styles.expanded : styles.collapsed}>▼</span>
          Temperature Sensors (DS18B20)
        </h3>
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

      {/* About Section */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>About</h3>
        <div className={styles.info}>
          <p>
            <strong>Brew System v3</strong>
          </p>
          <p>Web-based brewery control system</p>
          <p>Designed for Raspberry Pi kiosk mode</p>
        </div>
      </div>
    </div>
  );
}

export default Settings;
