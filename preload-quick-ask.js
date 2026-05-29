const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quickAskAPI', {
  submit: (prompt) => ipcRenderer.invoke('ai-query', { prompt }),
  close: () => ipcRenderer.send('quick-ask-close'),
  getSettings: () => ipcRenderer.invoke('get-settings')
});
