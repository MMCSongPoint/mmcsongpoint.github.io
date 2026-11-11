// What the web app can ask of the Windows app (window.SongPointDesktop). Everything else stays plain web.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('SongPointDesktop', {
  isDesktop: true,
  version: () => ipcRenderer.invoke('version'),
  // the screens connected to this computer, and which one the slideshow opens on
  screens: () => ipcRenderer.invoke('screens'),
  setProjector: id => ipcRenderer.invoke('set-projector', id),
  // keep the computer and projector from going to sleep while presenting
  keepAwake: on => ipcRenderer.invoke('keep-awake', !!on),
  // a laptop keeps presenting with its lid closed (on / off; no argument: just ask)
  lid: on => ipcRenderer.invoke('lid', on),
});
