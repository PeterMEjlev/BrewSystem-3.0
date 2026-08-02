require('dotenv').config();
const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');
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
// carries on reading sensors and regulating throughout. X is asked first
// (instant, and any touch wakes the panel by itself); vcgencmd is the fallback
// for setups where DPMS isn't available.

function runQuiet(command, args) {
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { stdio: 'ignore' });
      child.on('error', () => resolve(false));
      child.on('exit', (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
}

// Try each command in turn, stop at the first that succeeds.
async function runFirstWorking(commands) {
  for (const [command, args] of commands) {
    if (await runQuiet(command, args)) return true;
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
    ['xset', ['dpms', 'force', 'on']],
    ['vcgencmd', ['display_power', '1']],
  ]);
}

// Quitting with the panel still off would leave a Pi that looks bricked, and
// will-quit doesn't wait for async work — so this path is synchronous.
function wakeDisplaySync() {
  if (!displayAsleep || !isLinux) return;
  displayAsleep = false;
  for (const [command, args] of [
    ['xset', ['dpms', 'force', 'on']],
    ['vcgencmd', ['display_power', '1']],
  ]) {
    try {
      if (spawnSync(command, args, { stdio: 'ignore' }).status === 0) return;
    } catch { /* try the next one */ }
  }
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

function waitForBackend(url, retries = 30, delay = 1000) {
  return new Promise((resolve) => {
    let attempts = 0;
    const check = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => {
        attempts++;
        if (attempts < retries) {
          setTimeout(check, delay);
        } else {
          resolve(false);
        }
      });
      req.end();
    };
    check();
  });
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
ipcMain.on('display-wake', () => { wakeDisplay(); });

// IPC handler: frontend sets Bruce speech volume
ipcMain.on('bruce-volume', (_event, gain) => {
  if (bruceProcess && !bruceProcess.killed && bruceProcess.stdin.writable) {
    bruceProcess.stdin.write(JSON.stringify({ action: 'set-volume', gain }) + '\n');
  }
});

async function createWindow() {
  const win = new BrowserWindow({
    icon: path.join(__dirname, '..', 'Icon_App.png'),
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

  // Escape hatch: Ctrl+Shift+Q to quit kiosk mode
  globalShortcut.register('CommandOrControl+Shift+Q', () => {
    app.quit();
  });

  const backendReady = await waitForBackend(LOAD_URL);
  if (backendReady) {
    win.loadURL(LOAD_URL);
    startBruce();
  } else {
    win.loadURL(`data:text/html,<h1 style="color:white;background:#1a1a1a;margin:0;padding:2rem;font-family:sans-serif">Waiting for backend at ${LOAD_URL}... Please ensure the server is running.</h1>`);
  }

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
