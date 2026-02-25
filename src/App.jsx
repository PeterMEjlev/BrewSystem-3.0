import { useState } from 'react';
import { ThemeProvider } from './contexts/ThemeContext';
import BottomNav from './components/BottomNav/BottomNav';
import BrewingPanel from './components/BrewingPanel/BrewingPanel';
import TemperatureChart from './components/TemperatureChart/TemperatureChart';
import Settings from './components/Settings/Settings';
import './App.css';

function App() {
  const [activePanel, setActivePanel] = useState('brewing');

  return (
    <ThemeProvider>
      <div className="app">
        <main className="main-content">
          {activePanel === 'brewing' && <BrewingPanel />}
          {activePanel === 'chart' && <TemperatureChart />}
          {activePanel === 'settings' && <Settings />}
        </main>
        <BottomNav activePanel={activePanel} onPanelChange={setActivePanel} />
      </div>
    </ThemeProvider>
  );
}

export default App;
