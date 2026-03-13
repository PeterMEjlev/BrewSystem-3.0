const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bruceAPI', {
  onStateChange: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('bruce-state', listener);
    return () => ipcRenderer.removeListener('bruce-state', listener);
  },
  speak: (message) => {
    ipcRenderer.send('bruce-speak', message);
  },
  setVolume: (gain) => {
    ipcRenderer.send('bruce-volume', gain);
  },
});
