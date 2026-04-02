const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('platform', process.platform);

contextBridge.exposeInMainWorld('electronAPI', {
  quit: () => ipcRenderer.send('quit-app'),
});

contextBridge.exposeInMainWorld('bruceAPI', {
  onStateChange: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('bruce-state', listener);
    return () => ipcRenderer.removeListener('bruce-state', listener);
  },
  onMessage: (callback) => {
    const listener = (_event, json) => {
      try { callback(JSON.parse(json)); } catch {}
    };
    ipcRenderer.on('bruce-message', listener);
    return () => ipcRenderer.removeListener('bruce-message', listener);
  },
  speak: (message) => {
    ipcRenderer.send('bruce-speak', message);
  },
  setVolume: (gain) => {
    ipcRenderer.send('bruce-volume', gain);
  },
});
