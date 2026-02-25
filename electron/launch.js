const proc = require('child_process');
const path = require('path');

// Remove ELECTRON_RUN_AS_NODE so Electron starts as a proper browser process
// (VS Code and similar tools set this, which forces Electron into Node-only mode)
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const electronPath = require('electron');
const projectDir = path.resolve(__dirname, '..');

const child = proc.spawn(electronPath, [projectDir], {
  stdio: 'inherit',
  windowsHide: false,
  env,
});

child.on('close', (code, signal) => {
  if (code === null) {
    console.error('Electron exited with signal', signal);
    process.exit(1);
  }
  process.exit(code);
});

process.on('SIGINT', () => { if (!child.killed) child.kill('SIGINT'); });
process.on('SIGTERM', () => { if (!child.killed) child.kill('SIGTERM'); });
