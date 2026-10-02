require('dotenv').config();
const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const path = require('path');

const isDev = process.env.NODE_ENV === 'development';
const LOAD_URL = isDev ? 'http://localhost:5173' : 'http://localhost:8000';
const isLinux = process.platform === 'linux';

// Limit V8 heap for Pi memory constraints
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256');

// RPi-specific Chromium flags — software rendering is more reliable on ARM
if (isLinux) {
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('num-raster-threads', '2');
  app.commandLine.appendSwitch('disable-smooth-scrolling');
  app.commandLine.appendSwitch('disable-animations');
  app.commandLine.appendSwitch('wm-window-animations-disabled');
}

let bruceProcess = null;
let mainWindow = null;
let displayAsleep = false;

// --- Display power (kiosk screen sleep) ---------------------------------
// A Pi has no suspend-to-RAM, so "sleep" is the HDMI panel only — the backend
// carries on reading sensors and regulating throughout.
//
// Three ways to do it, tried in order, because which one works depends on the
// session this is running under:
//
//   wlopm      Wayland (labwc, which is what current Pi OS boots into). Powers
//              the output down without destroying it, so the kiosk window
//              keeps its output and stays fullscreen. Much the best outcome.
//   xset dpms  Real X11 only — XWayland has no DPMS extension at all.
//   vcgencmd   Last resort: it disables HDMI outright, which drops the head
//              and un-fullscreens every window on it. restoreKiosk() below is
//              what picks up the pieces afterwards.

// The Wayland tools need the socket spelled out: labwc's autostart launches
// the kiosk without WAYLAND_DISPLAY anywhere in its environment.
function waylandEnv() {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;
  return {
    ...process.env,
    WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY || 'wayland-0',
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || `/run/user/${uid}`,
  };
}

function runQuiet(command, args, options = {}) {
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'], ...options });
      let stderr = '';
      if (child.stderr) child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', () => resolve(false));
      // Exit 0 is not proof it did anything. Under XWayland `xset dpms force
      // off` prints "server does not have extension for dpms option" and still
      // reports success — which used to stop the fallback chain dead right
      // here and leave the panel lit through every sleep.
      child.on('exit', (code) => {
        resolve(code === 0 && !/does not have extension/i.test(stderr));
      });
    } catch {
      resolve(false);
    }
  });
}

// Try each command in turn, stop at the first that actually works.
async function runFirstWorking(commands) {
  for (const [command, args, options] of commands) {
    if (await runQuiet(command, args, options)) return true;
  }
  return false;
}

// DPMS has to be enabled for `dpms force off` to do anything, but its own
// timeouts must stay at zero — the app decides when the screen sleeps, not X,
// so that a running brew can keep the display lit.
function configureDisplayPower() {
  if (!isLinux) return;
  runQuiet('xset', ['s', 'off']);
  runQuiet('xset', ['s', 'noblank']);
  runQuiet('xset', ['+dpms']);
  runQuiet('xset', ['dpms', '0', '0', '0']);
}

async function sleepDisplay() {
  if (displayAsleep) return;
  displayAsleep = true;
  if (!isLinux) return; // dev machines: the black overlay is the whole effect
  const ok = await runFirstWorking([
    ['wlopm', ['--off', '*'], { env: waylandEnv() }],
    ['xset', ['dpms', 'force', 'off']],
    ['vcgencmd', ['display_power', '0']],
  ]);
  if (!ok) console.warn('[Display] Could not power the screen off (no xset/vcgencmd?)');
}

async function wakeDisplay() {
  if (!displayAsleep) return;
  displayAsleep = false;
  if (!isLinux) return;
  await runFirstWorking([
    ['wlopm', ['--on', '*'], { env: waylandEnv() }],
    ['xset', ['dpms', 'force', 'on']],
    ['vcgencmd', ['display_power', '1']],
  ]);
  // The vcgencmd route back brings the output up as a brand new head, and the
  // window it un-fullscreened on the way down does not return by itself.
  scheduleKioskRestore('display wake');
}

// Quitting with the panel still off would leave a Pi that looks bricked, and
// will-quit doesn't wait for async work — so this path is synchronous.
function wakeDisplaySync() {
  if (!displayAsleep || !isLinux) return;
  displayAsleep = false;
  for (const [command, args, options] of [
    ['wlopm', ['--on', '*'], { env: waylandEnv() }],
    ['xset', ['dpms', 'force', 'on']],
    ['vcgencmd', ['display_power', '1']],
  ]) {
    try {
      const result = spawnSync(command, args, {
        stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', ...options,
      });
      if (result.status === 0 && !/does not have extension/i.test(result.stderr || '')) return;
    } catch { /* try the next one */ }
  }
}

// --- Kiosk geometry -----------------------------------------------------
// The panel going to sleep can take the whole output with it: vcgencmd
// disables HDMI outright, and the monitor's own standby drops the hotplug
// line by itself. Either way the compositor destroys the output, and labwc
// answers by pulling every window on it out of fullscreen and restoring it to
// its pre-fullscreen size. Nothing puts that back when the output returns, so
// the kiosk is left as a small window in the corner of the screen — narrow
// enough that the brewing screen drops to its one-column layout and shows
// nothing but the BK card.
//
// So re-assert it: on display changes, on losing fullscreen, and on waking.
// What gets tested is the window's real geometry rather than Electron's idea
// of it, because the compositor moves it without telling Electron.

let kioskRestoreTimer = null;

function restoreKiosk(reason) {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;

  const { bounds } = screen.getPrimaryDisplay();
  const current = win.getBounds();
  if (win.isFullScreen() && current.width === bounds.width && current.height === bounds.height) {
    return;
  }

  console.log(
    `[Kiosk] ${reason}: window is ${current.width}x${current.height} on a ` +
    `${bounds.width}x${bounds.height} display — restoring fullscreen`
  );

  // Drop the states before setting them again. The compositor can have taken
  // the window out of fullscreen without Electron noticing, and asking for a
  // state it believes it already holds does nothing at all.
  win.setKiosk(false);
  win.setFullScreen(false);
  win.setBounds(bounds);
  win.setFullScreen(true);
  win.setKiosk(true);
  win.focus();
}

// The output comes back in stages — the head reappears, then kanshi re-applies
// the mode — so measuring the moment the first event lands reads a size that
// is about to change again.
function scheduleKioskRestore(reason, delay = 750) {
  clearTimeout(kioskRestoreTimer);
  kioskRestoreTimer = setTimeout(() => restoreKiosk(reason), delay);
}

function watchDisplayChanges(win) {
  screen.on('display-added', () => scheduleKioskRestore('display added'));
  screen.on('display-removed', () => scheduleKioskRestore('display removed'));
  screen.on('display-metrics-changed', () => scheduleKioskRestore('display metrics changed'));

  // Belt and braces. An output being destroyed does not always reach Electron
  // as a display event under XWayland, but the window being resized out from
  // under the kiosk always shows up as one of these.
  win.on('leave-full-screen', () => scheduleKioskRestore('left fullscreen'));
  win.on('resize', () => scheduleKioskRestore('resized', 1500));
}

// --- Renderer lifecycle -------------------------------------------------
// The renderer owns the idle timer, so its idea of whether the panel is asleep
// is the one touches are judged against — and a page that has just loaded
// always thinks the panel is lit. Reloaded while the panel was dark (a new
// build landing, the crash screen's countdown, a renderer restart), it would
// take the first touch as ordinary activity, never ask for a wake, and leave
// the panel dark for good. So any page load turns the panel back on first.
//
// And a renderer that dies leaves an empty window with nothing in it to touch,
// so bring it straight back rather than waiting for someone to notice.
function watchRenderer(win) {
  const wc = win.webContents;
  wc.on('did-start-loading', () => { wakeDisplay(); });
  wc.on('render-process-gone', (_event, details) => {
    console.error(`[Kiosk] Renderer gone (${details.reason}, exit ${details.exitCode}) — reloading`);
    setTimeout(() => { if (!win.isDestroyed()) wc.reload(); }, 2000);
  });
}

const BRUCE_STATE_PREFIX = '@@BRUCE_STATE:';
const BRUCE_MSG_PREFIX = '@@BRUCE_MSG:';

function startBruce() {
  const bruceScript = path.join(__dirname, 'bruce.js');
  bruceProcess = spawn(process.platform === 'win32' ? 'node.exe' : 'node', [bruceScript], {
    cwd: path.join(__dirname, '..'),
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env },
  });

  // Parse stdout for state messages, forward the rest as normal logs
  let buffer = '';
  bruceProcess.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let newlineIdx;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);

      if (line.startsWith(BRUCE_STATE_PREFIX)) {
        const state = line.slice(BRUCE_STATE_PREFIX.length).trim();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('bruce-state', state);
        }
      } else if (line.startsWith(BRUCE_MSG_PREFIX)) {
        const json = line.slice(BRUCE_MSG_PREFIX.length).trim();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('bruce-message', json);
        }
      } else {
        process.stdout.write(line + '\n');
      }
    }
  });

  bruceProcess.on('error', (err) => {
    console.error('[Bruce] Failed to start:', err.message);
    bruceProcess = null;
  });

  bruceProcess.on('exit', (code) => {
    console.log(`[Bruce] Process exited with code ${code}`);
    bruceProcess = null;
  });
}

/** One attempt at the backend. Resolves true if it answered at all. */
function pingBackend(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(true);
    });
    // Without this a connection that opens and then hangs never settles, and
    // the retry loop below stops retrying.
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

/** The holding page. Counts up on its own so it is visibly waiting rather than
 *  visibly broken — there is no keyboard on this machine to reload it with. */
function waitingPage(url) {
  const html = `<html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#1a1a1a;color:#e5e7eb;
      font-family:system-ui,sans-serif;display:flex;align-items:center;
      justify-content:center;text-align:center}
    h1{font-size:1.6rem;font-weight:600;margin:0 0 .75rem}
    p{color:#9ca3af;margin:.25rem 0;font-size:1rem}
    code{color:#d1d5db}
    .dot{animation:blink 1.4s infinite}.dot:nth-child(2){animation-delay:.2s}
    .dot:nth-child(3){animation-delay:.4s}
    @keyframes blink{0%,60%,100%{opacity:.25}30%{opacity:1}}
  </style></head><body><div>
    <h1>Waiting for the brew system backend<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></h1>
    <p><code>${url}</code></p>
    <p>Retrying every second — this page will load itself when the backend answers.</p>
    <p id="t"></p>
    <script>let n=0;setInterval(()=>{n++;document.getElementById('t').textContent=
      'Waiting '+(n<60?n+'s':Math.floor(n/60)+'m '+(n%60)+'s')},1000)</script>
  </div></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/**
 * Wait for the backend, for as long as it takes.
 *
 * A cold Pi boot can take longer than any fixed timeout worth setting, and the
 * cost of guessing too low is a kiosk parked on a dead page until somebody
 * finds a keyboard for it. So it shows a holding page and keeps trying; the
 * only way out is the backend answering or the app quitting.
 */
async function loadWhenBackendReady(win, url, delay = 1000) {
  if (await pingBackend(url)) return true;

  win.loadURL(waitingPage(url));
  for (;;) {
    await new Promise((r) => setTimeout(r, delay));
    if (win.isDestroyed()) return false;
    if (await pingBackend(url)) return true;
  }
}

// IPC handler: frontend requests app quit
ipcMain.on('quit-app', () => {
  app.quit();
});

// IPC handler: frontend requests Bruce to speak
ipcMain.on('bruce-speak', (_event, message) => {
  if (bruceProcess && !bruceProcess.killed && bruceProcess.stdin.writable) {
    bruceProcess.stdin.write(JSON.stringify({ action: 'speak', message }) + '\n');
  }
});

// IPC handlers: frontend idle timer drives the screen
ipcMain.on('display-sleep', () => { sleepDisplay(); });
ipcMain.on('display-wake', () => {
  wakeDisplay();
  // Also covers the panel having slept on its own: the monitor's standby drops
  // the head without sleepDisplay() ever being called, so wakeDisplay() sees
  // nothing to do and would not schedule the check itself.
  scheduleKioskRestore('touch to wake');
});

// IPC handler: frontend sets Bruce speech volume
ipcMain.on('bruce-volume', (_event, gain) => {
  if (bruceProcess && !bruceProcess.killed && bruceProcess.stdin.writable) {
    bruceProcess.stdin.write(JSON.stringify({ action: 'set-volume', gain }) + '\n');
  }
});

async function createWindow() {
  // Worth spelling out even though the window opens straight into kiosk mode:
  // this is the size the compositor restores to if it ever drops the window
  // out of fullscreen. Left unset it is Electron's 800x600 default, which is
  // how the kiosk used to come back from a display sleep as a small window.
  const { bounds } = screen.getPrimaryDisplay();

  const win = new BrowserWindow({
    icon: path.join(__dirname, '..', 'Icon_App.png'),
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    kiosk: true,
    fullscreen: true,
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow = win;

  win.setMenu(null);

  configureDisplayPower();
  watchDisplayChanges(win);
  watchRenderer(win);

  // Escape hatch: Ctrl+Shift+Q to quit kiosk mode
  globalShortcut.register('CommandOrControl+Shift+Q', () => {
    app.quit();
  });

  // This can wait indefinitely, so everything after it has to cope with the
  // app having been quit in the meantime.
  if (!(await loadWhenBackendReady(win, LOAD_URL))) return;
  win.loadURL(LOAD_URL);
  startBruce();

  if (isDev) {
    win.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  wakeDisplaySync();
  if (bruceProcess && !bruceProcess.killed) {
    bruceProcess.kill();
  }
});
