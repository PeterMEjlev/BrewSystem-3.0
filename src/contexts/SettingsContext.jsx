import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  DEFAULT_AUTO_EFFICIENCY,
  DEFAULT_BK_ELEMENT_WATTS,
  DEFAULT_HLT_ELEMENT_WATTS,
} from '../utils/appDefaults';

const SettingsContext = createContext(null);

const APP_DEFAULTS = {
  max_watts: 11000,
  bk_element_watts: DEFAULT_BK_ELEMENT_WATTS,
  hlt_element_watts: DEFAULT_HLT_ELEMENT_WATTS,
  cursor_visibility: 'auto',
  brewing_panel_poll_seconds: 1,
};

export const FALLBACK_AUTO_EFFICIENCY = DEFAULT_AUTO_EFFICIENCY;

// Trailing debounce for config writes — collapses slider/color-picker drags
// (dozens of change events per second) into a single SD-card write.
const PERSIST_DEBOUNCE_MS = 500;

export function SettingsProvider({ children }) {
  const [settings, setSettingsState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState('');
  const saveTimer = useRef(null);
  // Mirror of the latest settings — lets updateSettings compute the next
  // value outside the React state updater (updaters must stay side-effect
  // free; React may invoke them more than once).
  const settingsRef = useRef(null);
  const persistTimer = useRef(null);

  const fetchSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/settings');
      if (!response.ok) throw new Error('Failed to fetch settings');
      const data = await response.json();
      data.app = { ...APP_DEFAULTS, ...data.app };
      settingsRef.current = data;
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

  // Single setter the UI uses for all writes — updates state immediately and
  // persists on a trailing debounce (rapid changes collapse into one write).
  const updateSettings = useCallback((updaterOrValue) => {
    const prev = settingsRef.current;
    const next = typeof updaterOrValue === 'function' ? updaterOrValue(prev) : updaterOrValue;
    settingsRef.current = next;
    setSettingsState(next);
    setSaveStatus('Saving...');
    clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => persist(settingsRef.current), PERSIST_DEBOUNCE_MS);
  }, [persist]);

  // Reset to factory defaults — backend rewrites config.json from config.default.json.
  const resetSettings = useCallback(async () => {
    // Cancel any pending debounced write so it can't overwrite the reset
    clearTimeout(persistTimer.current);
    setSaveStatus('Resetting...');
    try {
      const response = await fetch('/api/settings/reset', { method: 'POST' });
      if (!response.ok) throw new Error('Failed to reset settings');
      const data = await response.json();
      data.app = { ...APP_DEFAULTS, ...data.app };
      settingsRef.current = data;
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
