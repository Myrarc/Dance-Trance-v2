const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('danceTranceDesktop', {
  saveSong: (input) => ipcRenderer.invoke('media:save-song', input),
  readSong: (id) => ipcRenderer.invoke('media:read-song', id),
  deleteSong: (id) => ipcRenderer.invoke('media:delete-song', id),
  savePhoto: (input) => ipcRenderer.invoke('media:save-photo', input),
  readPhoto: (id) => ipcRenderer.invoke('media:read-photo', id),
  deletePhoto: (id) => ipcRenderer.invoke('media:delete-photo', id),
  folders: () => ipcRenderer.invoke('media:folders'),
})
