import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

const SettingsContext = createContext(null);

const APP_DEFAULTS = {
  max_watts: 11000,
  max_chart_points: 500,
  cursor_visibility: 'auto',
};

const FALLBACK_REG_STEPS = [
  { threshold: 5,   power: 100 },
  { threshold: 2,   power: 60  },
  { threshold: 0.5, power: 30  },
  { threshold: 0,   power: 0   },
];

export const FALLBACK_AUTO_EFFICIENCY = {
  enabled: true,
  bk:  { steps: FALLBACK_REG_STEPS },
  hlt: { steps: FALLBACK_REG_STEPS },
};

export function SettingsProvider({ children }) {
  const [settings, setSettingsState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState('');
  const saveTimer = useRef(null);

  const fetchSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/settings');
      if (!response.ok) throw new Error('Failed to fetch settings');
      const data = await response.json();
      data.app = { ...APP_DEFAULTS, ...data.app };
      setSettingsState(data);
    } catch (err) {
      console.error('Error fetching settings:', err);
      setSaveStatus('Error loading settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const persist = useCallback(async (updated) => {
    setSaveStatus('Saving...');
    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      if (!response.ok) throw new Error('Failed to save settings');
      setSaveStatus('Saved ✓');
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => setSaveStatus(''), 2000);
    } catch (err) {
      console.error('Error saving settings:', err);
      setSaveStatus('Error saving');
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => setSaveStatus(''), 3000);
    }
  }, []);

  // Single setter the UI uses for all writes — updates state and persists.
  const updateSettings = useCallback((updaterOrValue) => {
    setSettingsState((prev) => {
      const next = typeof updaterOrValue === 'function' ? updaterOrValue(prev) : updaterOrValue;
      persist(next);
      return next;
    });
  }, [persist]);

  // Reset to factory defaults — backend rewrites config.json from config.default.json.
  const resetSettings = useCallback(async () => {
    setSaveStatus('Resetting...');
    try {
      const response = await fetch('/api/settings/reset', { method: 'POST' });
      if (!response.ok) throw new Error('Failed to reset settings');
      const data = await response.json();
      data.app = { ...APP_DEFAULTS, ...data.app };
      setSettingsState(data);
      setSaveStatus('Reset to defaults ✓');
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => setSaveStatus(''), 2000);
      return data;
    } catch (err) {
      console.error('Error resetting settings:', err);
      setSaveStatus('Error resetting');
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => setSaveStatus(''), 3000);
      throw err;
    }
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, loading, saveStatus, updateSettings, resetSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside <SettingsProvider>');
  return ctx;
}
