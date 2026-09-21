'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('afmsTabs', {
  ready: () => ipcRenderer.send('tabs:ready'),
  newTab: () => ipcRenderer.send('tabs:new'),
  closeTab: (id) => ipcRenderer.send('tabs:close', id),
  activate: (id) => ipcRenderer.send('tabs:activate', id),
  onState: (callback) => {
    ipcRenderer.on('tabs:state', (_event, state) => callback(state));
  },
});
