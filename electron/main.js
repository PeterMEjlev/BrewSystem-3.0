require('dotenv').config();
const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');
const { spawn } = require('child_process');
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

// IPC handler: frontend requests Bruce to speak
ipcMain.on('bruce-speak', (_event, message) => {
  if (bruceProcess && !bruceProcess.killed && bruceProcess.stdin.writable) {
    bruceProcess.stdin.write(JSON.stringify({ action: 'speak', message }) + '\n');
  }
});

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
  if (bruceProcess && !bruceProcess.killed) {
    bruceProcess.kill();
  }
});
