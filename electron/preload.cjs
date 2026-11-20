const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  call: (metodo, args) => ipcRenderer.invoke('api', metodo, args),
});
