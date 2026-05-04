import { useState, useEffect } from 'react';
import { ThemeProvider } from './contexts/ThemeContext';
import { BruceHistoryProvider } from './contexts/BruceHistoryContext';
import { SettingsProvider, useSettings } from './contexts/SettingsContext';
import BottomNav from './components/BottomNav/BottomNav';
import BrewingPanel from './components/BrewingPanel/BrewingPanel';
import TemperatureChart from './components/TemperatureChart/TemperatureChart';
import RecipePage from './components/RecipePage/RecipePage';
import ToolsPage from './components/ToolsPage/ToolsPage';
import KegStatusPage from './components/KegStatusPage/KegStatusPage';
import BruceHistoryPage from './components/BruceHistoryPage/BruceHistoryPage';
import Settings from './components/Settings/Settings';
import './App.css';

function AppShell() {
  const [activePanel, setActivePanel] = useState('brewing');
  const [bruceState, setBruceState] = useState('idle');
  const { settings } = useSettings();

  useEffect(() => {
    if (window.bruceAPI?.onStateChange) {
      return window.bruceAPI.onStateChange(setBruceState);
    }
  }, []);

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
      <BottomNav activePanel={activePanel} onPanelChange={setActivePanel} bruceState={bruceState} />
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <SettingsProvider>
        <BruceHistoryProvider>
          <AppShell />
        </BruceHistoryProvider>
      </SettingsProvider>
    </ThemeProvider>
  );
}

export default App;
