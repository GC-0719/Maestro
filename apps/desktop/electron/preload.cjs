/**
 * Preload bridge — the ONLY surface the renderer can touch.
 * No raw CLI output ever crosses here except inside `detail` fields,
 * which the UI keeps collapsed by default.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('maestro', {
  snapshot: () => ipcRenderer.invoke('maestro:snapshot'),
  submit: (opts) => ipcRenderer.invoke('maestro:submit', opts),
  cancel: (id) => ipcRenderer.invoke('maestro:cancel', id),
  recover: (id) => ipcRenderer.invoke('maestro:recover', id),
  refreshHealth: () => ipcRenderer.invoke('maestro:refresh-health'),
  onTimeline: (fn) => {
    const listener = (_evt, payload) => fn(payload);
    ipcRenderer.on('maestro:timeline', listener);
    return () => ipcRenderer.removeListener('maestro:timeline', listener);
  },
});
