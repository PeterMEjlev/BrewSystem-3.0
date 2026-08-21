import { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { ThemeProvider } from './contexts/ThemeContext';
import { BruceHistoryProvider } from './contexts/BruceHistoryContext';
import { SettingsProvider, useSettings } from './contexts/SettingsContext';
import BottomNav from './components/BottomNav/BottomNav';
import StartMenu from './components/StartMenu/StartMenu';
import ResumeSessionDialog from './components/StartMenu/ResumeSessionDialog';
import BrewingPanel from './components/BrewingPanel/BrewingPanel';
import TemperatureChart from './components/TemperatureChart/TemperatureChart';
import RecipePage from './components/RecipePage/RecipePage';
import ToolsPage from './components/ToolsPage/ToolsPage';
import KegStatusPage from './components/KegStatusPage/KegStatusPage';
import BruceHistoryPage from './components/BruceHistoryPage/BruceHistoryPage';
import Settings from './components/Settings/Settings';
import ScreenSleepOverlay from './components/ScreenSleep/ScreenSleepOverlay';
import { useScreenSleep } from './hooks/useScreenSleep';
import { subscribeLiveState, getLiveState } from './utils/liveState';
import './App.css';

// Read as a selector rather than through the whole live snapshot: the object
// keeps its identity across pushes that didn't touch it, so a temperature
// arriving does not re-render the entire app shell. Stable fallback for the
// same reason — a new object each call would re-render forever.
const NO_RESUME = { pending: false };
const getSessionResume = () => getLiveState().state?.sessionResume ?? NO_RESUME;


function AppShell() {
  // Null until the launch check below settles, so nothing is drawn twice: a rig
  // that turns out to be mid-brew must never flash the start menu on its way to
  // the brewing screen.
  const [activePanel, setActivePanel] = useState(null);
  const [bruceState, setBruceState] = useState('idle');
  // An interrupted brew the backend picked back up, waiting to be confirmed.
  //
  // Taken from the pushed state rather than only from the launch check below,
  // because the usual restart does not reload this app at all: the update
  // button bounces the backend service while the kiosk keeps running, so the
  // offer has to be able to arrive on the socket mid-session. The launch fetch
  // covers the other direction — a kiosk that reloads before the socket is up.
  const liveResume = useSyncExternalStore(subscribeLiveState, getSessionResume);
  const [launchResume, setLaunchResume] = useState(null);
  // The sentinel's identity is the signal that the socket has not spoken yet,
  // which is the only time the launch check's answer is still the better one.
  // Once a snapshot has landed, the socket is the truth — including when it
  // says the offer has been settled from another screen.
  const socketSilent = liveResume === NO_RESUME;
  const resume = liveResume.pending
    ? liveResume
    : (socketSilent && launchResume?.pending ? launchResume : null);
  // Where the launch check landed. Held here rather than in state because it is
  // only read once the resume dialog is answered, and only if it is answered
  // with "start fresh".
  const launchPanel = useRef('home');
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
  //
  // Ahead of that, the rig's own answer: whether the backend came back up in
  // the middle of a brew and has picked it up pending confirmation. That one
  // outranks the routing, because until it is answered there is no telling
  // which brew a brewing screen would be showing.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // One LAN hop to the web server and one local read, asked together so
      // the launch settles in the slower of the two rather than both.
      const [active, state] = await Promise.all([
        fetch('/api/brew-planner/active-brew')
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null), /* no web server — the menu is the honest answer */
        fetch('/api/hardware/state')
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);
      if (cancelled) return;
      launchPanel.current = active?.active ? 'brewing' : 'home';
      if (state?.sessionResume?.pending) {
        setLaunchResume(state.sessionResume);
        return; // activePanel stays null: nothing is drawn behind the question
      }
      setActivePanel(launchPanel.current);
    })();
    return () => { cancelled = true; };
  }, []);

  // Answer the resume question and get out of the way. The POST is what makes
  // it stick; the rig has already adopted the brew, so a backend that fails to
  // answer here leaves the safe outcome in place and the screen still has to
  // move on rather than trapping the brewer behind a dialog.
  const answerResume = async (action) => {
    try {
      await fetch('/api/hardware/session/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
    } catch { /* nothing to recover — see above */ }
    setLaunchResume(null);
    // Only routes when this is the launch — an offer that arrived mid-session
    // must not yank the brewer off the page they were already looking at.
    setActivePanel((current) =>
      current ?? (action === 'resume' ? 'brewing' : launchPanel.current)
    );
  };

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
        {resume && (
          <ResumeSessionDialog
            offer={resume}
            onResume={() => answerResume('resume')}
            onStartFresh={() => answerResume('fresh')}
          />
        )}
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
