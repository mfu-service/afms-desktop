'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('afmsDesktop', {
  isDesktop: true,
  closeTab: () => ipcRenderer.send('tabs:close-self'),
});
