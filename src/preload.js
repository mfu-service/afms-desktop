'use strict';

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('afmsDesktop', {
  isDesktop: true,
});
