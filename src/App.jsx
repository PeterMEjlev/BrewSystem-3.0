import { useState, useEffect } from 'react';
import { ThemeProvider } from './contexts/ThemeContext';
import { BruceHistoryProvider } from './contexts/BruceHistoryContext';
import { SettingsProvider, useSettings } from './contexts/SettingsContext';
import BottomNav from './components/BottomNav/BottomNav';
import StartMenu from './components/StartMenu/StartMenu';
import BrewingPanel from './components/BrewingPanel/BrewingPanel';
import TemperatureChart from './components/TemperatureChart/TemperatureChart';
import RecipePage from './components/RecipePage/RecipePage';
import ToolsPage from './components/ToolsPage/ToolsPage';
import KegStatusPage from './components/KegStatusPage/KegStatusPage';
import BruceHistoryPage from './components/BruceHistoryPage/BruceHistoryPage';
import Settings from './components/Settings/Settings';
import ScreenSleepOverlay from './components/ScreenSleep/ScreenSleepOverlay';
import { useScreenSleep } from './hooks/useScreenSleep';
import './App.css';

function AppShell() {
  // Null until the launch check below settles, so nothing is drawn twice: a rig
  // that turns out to be mid-brew must never flash the start menu on its way to
  // the brewing screen.
  const [activePanel, setActivePanel] = useState(null);
  const [bruceState, setBruceState] = useState('idle');
  const { settings } = useSettings();
  const { asleep, wake } = useScreenSleep();

  useEffect(() => {
    if (window.bruceAPI?.onStateChange) {
      return window.bruceAPI.onStateChange(setBruceState);
    }
  }, []);

  // Where to open. The start menu is for a rig with nothing on it — if
  // BrewPlanner already has a brew session running, this is a kiosk that
  // reloaded or a service that restarted during the mash, and the brewer wants
  // the screen they were looking at, not a menu offering to start a second one.
  // An unreachable web server answers `active: false`, which lands on the menu:
  // the right place to be told a session can't be started.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let active = false;
      try {
        const response = await fetch('/api/brew-planner/active-brew');
        if (response.ok) active = Boolean((await response.json()).active);
      } catch { /* no web server — the menu is the honest answer */ }
      if (!cancelled) setActivePanel(active ? 'brewing' : 'home');
    })();
    return () => { cancelled = true; };
  }, []);

  // Log the batch on BrewPlanner, then get out of the way — the brewer pressed
  // this because they are about to start brewing.
  const startBrewSession = async (recipeId, brewedAt) => {
    const response = await fetch('/api/brew-planner/brew-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipeId, brewedAt }),
    });
    if (!response.ok) {
      let detail = `Could not start the brew session (HTTP ${response.status}).`;
      try {
        const data = await response.json();
        if (data?.detail) detail = data.detail;
      } catch { /* no JSON body — keep the status */ }
      throw new Error(detail);
    }
    setActivePanel('brewing');
  };

  // Cursor visibility: hide on Pi (production), show on Windows (development),
  // unless the user has explicitly overridden via settings.
  useEffect(() => {
    const visibility = settings?.app?.cursor_visibility || 'auto';
    if (visibility === 'hide' || (visibility === 'auto' && window.platform === 'linux')) {
      document.body.classList.add('hide-cursor');
    } else {
      document.body.classList.remove('hide-cursor');
    }
  }, [settings?.app?.cursor_visibility]);

  return (
    <div className="app">
      <main className="main-content">
        {activePanel === 'home' && (
          <StartMenu
            onStartSession={startBrewSession}
            onSkipSession={() => setActivePanel('brewing')}
          />
        )}
        <div style={{ display: activePanel === 'brewing' ? 'contents' : 'none' }}>
          <BrewingPanel />
        </div>
        <div style={{ display: activePanel === 'chart' ? 'contents' : 'none' }}>
          <TemperatureChart />
        </div>
        {activePanel === 'recipe' && <RecipePage />}
        {activePanel === 'tools' && <ToolsPage />}
        {activePanel === 'kegs' && <KegStatusPage />}
        {activePanel === 'bruce' && <BruceHistoryPage />}
        {activePanel === 'settings' && <Settings />}
      </main>
      {/* No nav until we know where we opened — it would otherwise be a way to
          navigate away from a decision that hasn't been made yet. */}
      {activePanel && (
        <BottomNav activePanel={activePanel} onPanelChange={setActivePanel} bruceState={bruceState} />
      )}
      {asleep && <ScreenSleepOverlay onWake={wake} />}
    </div>
  );
}

function App() {
  return (
    // SettingsProvider outermost — it owns the single /api/settings fetch that
    // ThemeProvider (and everything else) reads from.
    <SettingsProvider>
      <ThemeProvider>
        <BruceHistoryProvider>
          <AppShell />
        </BruceHistoryProvider>
      </ThemeProvider>
    </SettingsProvider>
  );
}

export default App;
