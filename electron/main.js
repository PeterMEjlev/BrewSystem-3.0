const { app, BrowserWindow, globalShortcut } = require('electron');
const http = require('http');

const isDev = process.env.NODE_ENV === 'development';
const LOAD_URL = isDev ? 'http://localhost:5173' : 'http://localhost:8000';

// Limit V8 heap for Pi memory constraints
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256');

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

async function createWindow() {
  const win = new BrowserWindow({
    kiosk: true,
    fullscreen: true,
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.setMenu(null);

  // Escape hatch: Ctrl+Shift+Q to quit kiosk mode
  globalShortcut.register('CommandOrControl+Shift+Q', () => {
    app.quit();
  });

  const backendReady = await waitForBackend(LOAD_URL);
  if (backendReady) {
    win.loadURL(LOAD_URL);
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
});
