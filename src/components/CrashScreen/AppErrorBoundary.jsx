import { Component } from 'react';

// Long enough to read the message, short enough that nobody has to walk over
// and find a way to reload a kiosk that has no keyboard.
const RELOAD_AFTER_SECONDS = 30;

/**
 * The last line between a rendering bug and a blank kiosk.
 *
 * Without it, one exception anywhere in the tree makes React unmount the whole
 * app, and what is left is the page background: a dark, empty screen that
 * looks exactly like the display sleeping and ignores every touch, because
 * there is no longer anything listening for one. That happened for weeks with
 * a sensor dropout as the trigger.
 *
 * So say what broke, and reload on a countdown. The rig itself is unaffected —
 * the backend regulates and runs its watchdogs on its own — but the brewer
 * needs to know the screen is not showing them the truth.
 *
 * Styled inline on purpose: this has to render even if the thing that broke is
 * the app's own styling.
 */
class AppErrorBoundary extends Component {
  state = { error: null, secondsLeft: RELOAD_AFTER_SECONDS };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Reaches the Electron log (~/.xsession-errors on the rig).
    console.error('[Crash] The UI hit an error and was replaced by the crash screen:', error, info?.componentStack);
    this.timer = setInterval(() => {
      this.setState(({ secondsLeft }) => ({ secondsLeft: secondsLeft - 1 }));
    }, 1000);
  }

  componentDidUpdate() {
    if (this.state.error && this.state.secondsLeft <= 0) {
      clearInterval(this.timer);
      window.location.reload();
    }
  }

  componentWillUnmount() {
    clearInterval(this.timer);
  }

  render() {
    const { error, secondsLeft } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: '1rem', padding: '2rem',
          background: '#1a1a1a', color: '#e5e7eb', fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
        }}
      >
        <h1 style={{ margin: 0, fontSize: '1.8rem' }}>The brewing screen hit an error</h1>
        <p style={{ margin: 0, color: '#9ca3af', fontSize: '1.1rem' }}>
          Heaters and pumps are still under the backend&apos;s control — only this screen stopped.
        </p>
        <code style={{ color: '#fca5a5', fontSize: '1rem', maxWidth: '90vw', overflowWrap: 'anywhere' }}>
          {String(error?.message ?? error)}
        </code>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            marginTop: '1rem', padding: '1rem 2.5rem', fontSize: '1.2rem', borderRadius: '0.75rem',
            border: 'none', background: '#2563eb', color: '#fff',
          }}
        >
          Reload now ({secondsLeft}s)
        </button>
      </div>
    );
  }
}

export default AppErrorBoundary;
