const proc = require('child_process');
const path = require('path');

// Remove ELECTRON_RUN_AS_NODE so Electron starts as a proper browser process
// (VS Code and similar tools set this, which forces Electron into Node-only mode)
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const isLinux = process.platform === 'linux';

// On RPi (Linux/X11), launch unclutter-xfixes to hide cursor at the OS level.
// CSS cursor:none is unreliable during slider drag in Chromium.
let unclutterProc = null;
if (isLinux) {
  try {
    unclutterProc = proc.spawn('unclutter', ['--start-hidden', '--hide-on-touch'], {
      stdio: 'ignore',
      detached: true,
    });
    unclutterProc.unref();
  } catch {}
}

const electronPath = require('electron');
const projectDir = path.resolve(__dirname, '..');

const child = proc.spawn(electronPath, [projectDir], {
  stdio: 'inherit',
  windowsHide: false,
  env,
});

child.on('close', (code, signal) => {
  if (unclutterProc && !unclutterProc.killed) unclutterProc.kill();
  if (code === null) {
    console.error('Electron exited with signal', signal);
    process.exit(1);
  }
  process.exit(code);
});

process.on('SIGINT', () => { if (!child.killed) child.kill('SIGINT'); });
process.on('SIGTERM', () => { if (!child.killed) child.kill('SIGTERM'); });
