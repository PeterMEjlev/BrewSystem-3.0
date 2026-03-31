import { useState, useEffect, useRef, useCallback } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { playClick, getVolumes, setMasterVolume, setButtonVolume, setBruceVolume } from '../../utils/sounds';
import SidebarLayout from '../SidebarLayout/SidebarLayout';
import styles from './Settings.module.css';

const SETTINGS_ITEMS = [
  {
    id: 'program',
    label: 'Program',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
        />
        <circle cx="12" cy="12" r="3" strokeWidth={2} />
      </svg>
    ),
  },
  {
    id: 'hardware',
    label: 'RPi Hardware',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <rect x="4" y="4" width="16" height="16" rx="2" strokeWidth={2} />
        <rect x="8" y="8" width="8" height="8" rx="1" strokeWidth={2} />
        <path strokeLinecap="round" strokeWidth={2}
          d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"
        />
      </svg>
    ),
  },
  {
    id: 'colors',
    label: 'GUI Colors',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c1.1 0 2-.9 2-2 0-.51-.2-.98-.52-1.34-.3-.33-.48-.73-.48-1.16 0-.88.72-1.6 1.6-1.6H16c3.31 0 6-2.69 6-6 0-4.96-4.48-9-10-9z"
        />
        <circle cx="8" cy="10" r="1.5" fill="currentColor" />
        <circle cx="12" cy="7" r="1.5" fill="currentColor" />
        <circle cx="16" cy="10" r="1.5" fill="currentColor" />
        <circle cx="9" cy="14" r="1.5" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: 'sound',
    label: 'Sound',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"
        />
      </svg>
    ),
  },
  {
    id: 'about',
    label: 'About',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <circle cx="12" cy="12" r="10" strokeWidth={2} />
        <path strokeLinecap="round" strokeWidth={2} d="M12 16v-4M12 8h.01" />
      </svg>
    ),
  },
];

function SoundSettings() {
  const [vols, setVols] = useState(getVolumes);

  const handleMaster = (e) => {
    const v = parseFloat(e.target.value);
    setMasterVolume(v);
    setVols(getVolumes());
  };
  const handleButtons = (e) => {
    const v = parseFloat(e.target.value);
    setButtonVolume(v);
    setVols(getVolumes());
  };
  const handleBruce = (e) => {
    const v = parseFloat(e.target.value);
    setBruceVolume(v);
    setVols(getVolumes());
  };

  const pct = (v) => `${Math.round(v * 100)}%`;

  return (
    <div className={styles.sectionContent}>
      <div className={styles.volumeGroup}>
        <div className={styles.volumeRow}>
          <label className={styles.volumeLabel}>
            Master Volume
            <span className={styles.volumeValue}>{pct(vols.master)}</span>
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={vols.master}
            onChange={handleMaster}
            className={styles.volumeSlider}
            style={{
              background: `linear-gradient(to right,
                var(--color-accent-blue) 0%,
                var(--color-accent-blue) ${vols.master * 100}%,
                var(--color-border-light) ${vols.master * 100}%,
                var(--color-border-light) 100%)`,
            }}
          />
        </div>
      </div>

      <div className={styles.subsectionTitle}>Individual Controls</div>

      <div className={styles.volumeGroup}>
        <div className={styles.volumeRow}>
          <label className={styles.volumeLabel}>
            Button Sounds
            <span className={styles.volumeValue}>{pct(vols.buttons)}</span>
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={vols.buttons}
            onChange={handleButtons}
            className={styles.volumeSlider}
            style={{
              background: `linear-gradient(to right,
                var(--color-accent-green) 0%,
                var(--color-accent-green) ${vols.buttons * 100}%,
                var(--color-border-light) ${vols.buttons * 100}%,
                var(--color-border-light) 100%)`,
            }}
          />
          <span className={styles.volumeEffective}>
            Effective: {pct(vols.master * vols.buttons)}
          </span>
        </div>

        <div className={styles.volumeRow}>
          <label className={styles.volumeLabel}>
            Bruce Speech
            <span className={styles.volumeValue}>{pct(vols.bruce)}</span>
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={vols.bruce}
            onChange={handleBruce}
            className={styles.volumeSlider}
            style={{
              background: `linear-gradient(to right,
                var(--color-accent-orange) 0%,
                var(--color-accent-orange) ${vols.bruce * 100}%,
                var(--color-border-light) ${vols.bruce * 100}%,
                var(--color-border-light) 100%)`,
            }}
          />
          <span className={styles.volumeEffective}>
            Effective: {pct(vols.master * vols.bruce)}
          </span>
        </div>
      </div>
    </div>
  );
}

function Settings() {
  const { theme, updateTheme, resetTheme } = useTheme();
  const [activeSection, setActiveSection] = useState(() => {
    try { return sessionStorage.getItem('settingsSection') || 'program'; } catch { return 'program'; }
  });
  const handleSectionChange = (id) => {
    setActiveSection(id);
    try { sessionStorage.setItem('settingsSection', id); } catch {}
  };
  const wrapperRef = useRef(null);
  const dragState = useRef({ isDragging: false, startY: 0, startScroll: 0, moved: false, scrollEl: null });

  const getScrollParent = (el) => {
    let node = el;
    while (node && node !== document.body) {
      if (node.scrollHeight > node.clientHeight) return node;
      node = node.parentElement;
    }
    return node;
  };

  const onPointerDown = useCallback((e) => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'TEXTAREA') return;
    const scrollEl = getScrollParent(wrapperRef.current);
    dragState.current = {
      isDragging: true,
      startY: e.clientY,
      startScroll: scrollEl?.scrollTop || 0,
      moved: false,
      scrollEl,
    };
  }, []);

  const onPointerMove = useCallback((e) => {
    if (!dragState.current.isDragging) return;
    const dy = e.clientY - dragState.current.startY;
    if (Math.abs(dy) > 3) dragState.current.moved = true;
    if (dragState.current.scrollEl) dragState.current.scrollEl.scrollTop = dragState.current.startScroll - dy;
  }, []);

  const onPointerUp = useCallback(() => {
    dragState.current.isDragging = false;
  }, []);

  const onClickCapture = useCallback((e) => {
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
      data.app = {
        max_watts: 11000,
        max_chart_points: 500,
        cursor_visibility: 'auto',
        ...data.app,
      };
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
    if (typeof value === 'number' && isNaN(value)) return;
    const newSettings = JSON.parse(JSON.stringify(settings));
    const keys = path.split('.');
    let current = newSettings;
    for (let i = 0; i < keys.length - 1; i++) {
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
    setSettings(newSettings);
    saveSettings(newSettings);

    // Apply cursor visibility change immediately
    if (path === 'app.cursor_visibility') {
      if (value === 'show') {
        document.body.style.cursor = '';
      } else if (value === 'hide') {
        document.body.style.cursor = 'none';
      } else {
        const isProduction = localStorage.getItem('brewSystemEnvironment') !== 'development';
        document.body.style.cursor = isProduction ? 'none' : '';
      }
    }
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

  const handleResetAllSettings = async () => {
    if (!window.confirm('Reset all settings to defaults? This cannot be undone.')) return;
    try {
      setSaveStatus('Resetting...');
      const response = await fetch('/api/settings/reset', { method: 'POST' });
      if (!response.ok) throw new Error('Failed to reset settings');
      const data = await response.json();
      setSettings(data);
      resetTheme();
      setSaveStatus('Reset to defaults ✓');
      setTimeout(() => setSaveStatus(''), 2000);
    } catch (error) {
      console.error('Error resetting settings:', error);
      setSaveStatus('Error resetting');
      setTimeout(() => setSaveStatus(''), 3000);
    }
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

  const resetButton = (
    <button className={styles.resetAllBtn} onClick={() => { playClick(); handleResetAllSettings(); }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={styles.resetIcon}>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 9v2m0 4h.01M5.07 19H19a2 2 0 001.75-2.96l-6.93-12a2 2 0 00-3.5 0l-6.93 12A2 2 0 005.07 19z"
        />
      </svg>
      Reset All
    </button>
  );

  return (
    <SidebarLayout
      title="Settings"
      items={SETTINGS_ITEMS}
      activeItem={activeSection}
      onItemChange={handleSectionChange}
      footer={resetButton}
    >
      <div
        className={styles.contentWrapper}
        ref={wrapperRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClickCapture={onClickCapture}
      >
        <div className={styles.header}>
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

        {activeSection === 'program' && (
          <div className={styles.sectionContent}>
            <div className={styles.inputGroup}>
              <label>Max System Power (W):</label>
              <input
                type="number"
                min="0"
                step="100"
                value={settings.app.max_watts}
                onChange={(e) => updateSetting('app.max_watts', parseInt(e.target.value))}
              />
            </div>

            <div className={styles.inputGroup}>
              <label>Chart Logging Frequency (seconds):</label>
              <input
                type="number"
                min="1"
                value={settings.app.log_interval_seconds}
                onChange={(e) => updateSetting('app.log_interval_seconds', parseInt(e.target.value))}
              />
            </div>

            <div className={styles.inputGroup}>
              <label>Max Chart Points:</label>
              <input
                type="number"
                min="50"
                step="50"
                value={settings.app.max_chart_points}
                onChange={(e) => updateSetting('app.max_chart_points', parseInt(e.target.value))}
              />
            </div>

            <div className={styles.inputGroup}>
              <label>Cursor Visibility:</label>
              <select
                value={settings.app.cursor_visibility || 'auto'}
                onChange={(e) => updateSetting('app.cursor_visibility', e.target.value)}
                className={styles.selectInput}
              >
                <option value="auto">Auto (hidden on Pi, visible on Windows)</option>
                <option value="show">Always Show</option>
                <option value="hide">Always Hide</option>
              </select>
            </div>

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

        {activeSection === 'hardware' && (
          <div className={styles.sectionContent}>
            <div className={styles.subSection}>
              <h4
                className={styles.subSectionTitle}
                onClick={() => toggleSection('potControl')}
              >
                <span className={expandedSections.potControl ? styles.expanded : styles.collapsed}>▼</span>
                Pot Control GPIO Pins
              </h4>
              {expandedSections.potControl && (
                <div className={styles.subSectionContent}>
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

            <div className={styles.subSection}>
              <h4
                className={styles.subSectionTitle}
                onClick={() => toggleSection('pumpControl')}
              >
                <span className={expandedSections.pumpControl ? styles.expanded : styles.collapsed}>▼</span>
                Pump Control GPIO Pins
              </h4>
              {expandedSections.pumpControl && (
                <div className={styles.subSectionContent}>
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

            <div className={styles.subSection}>
              <h4
                className={styles.subSectionTitle}
                onClick={() => toggleSection('heatingPWM')}
              >
                <span className={expandedSections.heatingPWM ? styles.expanded : styles.collapsed}>▼</span>
                Heating Element PWM Pins (Hardware PWM)
              </h4>
              {expandedSections.heatingPWM && (
                <div className={styles.subSectionContent}>
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

            <div className={styles.subSection}>
              <h4
                className={styles.subSectionTitle}
                onClick={() => toggleSection('pumpPWM')}
              >
                <span className={expandedSections.pumpPWM ? styles.expanded : styles.collapsed}>▼</span>
                Pump PWM Pins (Software PWM)
              </h4>
              {expandedSections.pumpPWM && (
                <div className={styles.subSectionContent}>
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

            <div className={styles.subSection}>
              <h4
                className={styles.subSectionTitle}
                onClick={() => toggleSection('pwmFrequencies')}
              >
                <span className={expandedSections.pwmFrequencies ? styles.expanded : styles.collapsed}>▼</span>
                PWM Frequencies
              </h4>
              {expandedSections.pwmFrequencies && (
                <div className={styles.subSectionContent}>
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

            <div className={styles.subSection}>
              <h4
                className={styles.subSectionTitle}
                onClick={() => toggleSection('temperatureSensors')}
              >
                <span className={expandedSections.temperatureSensors ? styles.expanded : styles.collapsed}>▼</span>
                Temperature Sensors (DS18B20)
              </h4>
              {expandedSections.temperatureSensors && (
                <div className={styles.subSectionContent}>
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

        {activeSection === 'colors' && (
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
              <label>Background Gradient End:</label>
              <input
                type="color"
                value={theme.bgDeep}
                onChange={(e) => updateColor('bgDeep', e.target.value)}
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

            <div className={styles.subsectionTitle}>Text Colors</div>
            <div className={styles.colorGroup}>
              <label>Primary Text:</label>
              <input
                type="color"
                value={theme.textPrimary}
                onChange={(e) => updateColor('textPrimary', e.target.value)}
                className={styles.colorPicker}
              />
            </div>
            <div className={styles.colorGroup}>
              <label>Secondary Text:</label>
              <input
                type="color"
                value={theme.textSecondary}
                onChange={(e) => updateColor('textSecondary', e.target.value)}
                className={styles.colorPicker}
              />
            </div>
            <div className={styles.colorGroup}>
              <label>Muted Text:</label>
              <input
                type="color"
                value={theme.textMuted}
                onChange={(e) => updateColor('textMuted', e.target.value)}
                className={styles.colorPicker}
              />
            </div>
            <div className={styles.colorGroup}>
              <label>Dark Text:</label>
              <input
                type="color"
                value={theme.textDark}
                onChange={(e) => updateColor('textDark', e.target.value)}
                className={styles.colorPicker}
              />
            </div>

            <div className={styles.subsectionTitle}>Border Colors</div>
            <div className={styles.colorGroup}>
              <label>Border:</label>
              <input
                type="color"
                value={theme.border}
                onChange={(e) => updateColor('border', e.target.value)}
                className={styles.colorPicker}
              />
            </div>
            <div className={styles.colorGroup}>
              <label>Border Light:</label>
              <input
                type="color"
                value={theme.borderLight}
                onChange={(e) => updateColor('borderLight', e.target.value)}
                className={styles.colorPicker}
              />
            </div>

            <div className={styles.subsectionTitle}>Gradient Colors</div>
            <div className={styles.gradientPair}>
              <label>Warm:</label>
              <input
                type="color"
                value={theme.gradientWarmStart}
                onChange={(e) => updateColor('gradientWarmStart', e.target.value)}
                className={styles.colorPicker}
              />
              <input
                type="color"
                value={theme.gradientWarmEnd}
                onChange={(e) => updateColor('gradientWarmEnd', e.target.value)}
                className={styles.colorPicker}
              />
            </div>
            <div className={styles.gradientPair}>
              <label>Cool:</label>
              <input
                type="color"
                value={theme.gradientCoolStart}
                onChange={(e) => updateColor('gradientCoolStart', e.target.value)}
                className={styles.colorPicker}
              />
              <input
                type="color"
                value={theme.gradientCoolEnd}
                onChange={(e) => updateColor('gradientCoolEnd', e.target.value)}
                className={styles.colorPicker}
              />
            </div>

            <div className={styles.subsectionTitle}>Navigation</div>
            <div className={styles.colorGroup}>
              <label>Nav Inactive:</label>
              <input
                type="color"
                value={theme.navInactive}
                onChange={(e) => updateColor('navInactive', e.target.value)}
                className={styles.colorPicker}
              />
            </div>

            <div className={styles.subsectionTitle}>Temperature</div>
            <div className={styles.colorGroup}>
              <label>Cold / Blue:</label>
              <input
                type="color"
                value={theme.tempCold}
                onChange={(e) => updateColor('tempCold', e.target.value)}
                className={styles.colorPicker}
              />
            </div>
            <div className={styles.colorGroup}>
              <label>Hot / Red:</label>
              <input
                type="color"
                value={theme.tempHot}
                onChange={(e) => updateColor('tempHot', e.target.value)}
                className={styles.colorPicker}
              />
            </div>

            <button className={styles.resetBtn} onClick={() => { playClick(); handleResetColors(); }}>
              Reset Colors to Defaults
            </button>
          </div>
        )}

        {activeSection === 'sound' && <SoundSettings />}

        {activeSection === 'about' && (
          <div className={styles.sectionContent}>
            <div className={styles.info}>
              <p><strong>Brew System v3</strong></p>
              <p>Web-based brewery control system</p>
              <p>Designed for Raspberry Pi kiosk mode</p>
            </div>
          </div>
        )}
      </div>
    </SidebarLayout>
  );
}

export default Settings;
