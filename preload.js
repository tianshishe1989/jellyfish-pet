const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jellyfishAPI', {
  onStateChange: (cb) => { ipcRenderer.on('state-change', (_, d) => cb(d)); },
  onSkinChange: (cb) => { ipcRenderer.on('skin-change', (_, d) => cb(d)); },
  onSettingsChanged: (cb) => { ipcRenderer.on('settings-changed', (_, d) => cb(d)); },
  onFileDrop: (cb) => { ipcRenderer.on('file-drop', (_, d) => cb(d)); },
  onEdgeState: (cb) => { ipcRenderer.on('edge-state', (_, d) => cb(d)); },
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSetting: (key, value) => ipcRenderer.send('set-settings', key, value),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragMove: () => ipcRenderer.send('drag-move'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  aiQuery: (opts) => ipcRenderer.invoke('ai-query', opts)
});
