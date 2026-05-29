const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chatAPI', {
  submitMessage: (conversationId, message, fileContext) =>
    ipcRenderer.invoke('chat-submit', { conversationId, message, fileContext }),
  loadHistory: () => ipcRenderer.invoke('chat-history-load'),
  newConversation: (title) => ipcRenderer.invoke('chat-history-new', title),
  deleteConversation: (id) => ipcRenderer.invoke('chat-history-delete', id),
  updateTitle: (id, title) => ipcRenderer.invoke('chat-update-title', id, title),
  onFileAnalysis: (cb) => {
    ipcRenderer.on('file-analysis', (_, data) => cb(data));
  },
  getSettings: () => ipcRenderer.invoke('get-settings')
});
