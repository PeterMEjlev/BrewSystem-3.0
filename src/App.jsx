import { useState, useEffect } from 'react';
import { ThemeProvider } from './contexts/ThemeContext';
import BottomNav from './components/BottomNav/BottomNav';
import BrewingPanel from './components/BrewingPanel/BrewingPanel';
import TemperatureChart from './components/TemperatureChart/TemperatureChart';
import RecipePage from './components/RecipePage/RecipePage';
import ToolsPage from './components/ToolsPage/ToolsPage';
import Settings from './components/Settings/Settings';
import './App.css';

function App() {
  const [activePanel, setActivePanel] = useState('brewing');
  const [bruceState, setBruceState] = useState('idle');

  useEffect(() => {
    if (window.bruceAPI?.onStateChange) {
      return window.bruceAPI.onStateChange(setBruceState);
    }
  }, []);

  return (
    <ThemeProvider>
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
          {activePanel === 'settings' && <Settings />}
        </main>
        <BottomNav activePanel={activePanel} onPanelChange={setActivePanel} bruceState={bruceState} />
      </div>
    </ThemeProvider>
  );
}

export default App;
