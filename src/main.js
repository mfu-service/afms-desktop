'use strict';

const path = require('path');
const fs = require('fs');
const {
  app,
  BaseWindow,
  Menu,
  shell,
  dialog,
  session,
  screen,
  nativeImage,
  ipcMain,
} = require('electron');
const { APP_URL, APP_TITLE, ALLOWED_HOST_SUFFIXES } = require('./config');
const { TabManager } = require('./tabs');

const isDev = !app.isPackaged;

let mainWindow = null;
let tabManager = null;

function stateFilePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function tabsStatePath() {
  return path.join(app.getPath('userData'), 'tabs-state.json');
}

function iconPath() {
  const ico = path.join(__dirname, '..', 'assets', 'icon.ico');
  const png = path.join(__dirname, '..', 'assets', 'icon.png');
  if (fs.existsSync(ico)) return ico;
  if (fs.existsSync(png)) return png;
  return undefined;
}

function loadWindowState() {
  let state = { width: 1280, height: 800 };
  try {
    state = { ...state, ...JSON.parse(fs.readFileSync(stateFilePath(), 'utf8')) };
  } catch {
    return state;
  }

  if (state.x == null || state.y == null) return state;

  const visible = screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return (
      state.x < area.x + area.width &&
      state.x + 80 > area.x &&
      state.y < area.y + area.height &&
      state.y + 80 > area.y
    );
  });

  if (!visible) {
    return {
      width: state.width,
      height: state.height,
      isMaximized: state.isMaximized,
    };
  }
  return state;
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  const bounds = win.getBounds();
  try {
    fs.writeFileSync(
      stateFilePath(),
      JSON.stringify({
        ...bounds,
        isMaximized: win.isMaximized(),
      }),
    );
  } catch {
    // ignore persistence errors
  }
}

function hostOf(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isAllowedHost(hostname) {
  if (!hostname) return false;
  const host = hostname.toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

function historyApi(contents) {
  return contents.navigationHistory ?? contents;
}

function isAppUrl(url) {
  if (!url) return false;
  if (url.startsWith('blob:') || url === 'about:blank') return true;
  if (url.startsWith('file:')) {
    const normalized = decodeURIComponent(url).replace(/\\/g, '/').toLowerCase();
    return normalized.includes('/src/error.html') || normalized.includes('/src/shell.html');
  }
  return isAllowedHost(hostOf(url));
}

function isShellEvent(event) {
  return Boolean(tabManager && event.sender && tabManager.isChrome(event.sender));
}

function applyNavigationPolicy(contents) {
  contents.setWindowOpenHandler(({ url, disposition }) => {
    if (url === 'about:blank' || url.startsWith('blob:')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1100,
          height: 760,
          autoHideMenuBar: true,
          icon: iconPath(),
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      };
    }
    if (isAppUrl(url)) {
      tabManager?.createTab(url, { activate: disposition !== 'background-tab' });
      return { action: 'deny' };
    }
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    if (tabManager?.isChrome(contents)) {
      const allowedShell =
        url.startsWith('file:') &&
        decodeURIComponent(url).replace(/\\/g, '/').toLowerCase().includes('/src/shell.html');
      if (!allowedShell) event.preventDefault();
      return;
    }
    if (!isAppUrl(url)) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
}

function attachContextMenu(contents) {
  contents.on('context-menu', (_event, params) => {
    const history = historyApi(contents);
    const template = [
      {
        label: 'رجوع',
        enabled: history.canGoBack(),
        click: () => history.goBack(),
      },
      {
        label: 'تقدم',
        enabled: history.canGoForward(),
        click: () => history.goForward(),
      },
      { label: 'إعادة تحميل', click: () => contents.reload() },
      { type: 'separator' },
      { label: 'قص', role: 'cut', enabled: params.editFlags.canCut },
      { label: 'نسخ', role: 'copy', enabled: params.editFlags.canCopy },
      { label: 'لصق', role: 'paste', enabled: params.editFlags.canPaste },
      { label: 'تحديد الكل', role: 'selectAll' },
    ];

    if (params.linkURL) {
      const items = [];
      if (isAppUrl(params.linkURL) && /^https?:/i.test(params.linkURL)) {
        items.push({
          label: 'فتح في تبويب جديد',
          click: () => tabManager?.createTab(params.linkURL),
        });
      }
      items.push({
        label: 'فتح الرابط في المتصفح',
        click: () => shell.openExternal(params.linkURL),
      });
      template.unshift(...items, { type: 'separator' });
    }

    Menu.buildFromTemplate(template).popup({ window: mainWindow });
  });
}

function createMenu() {
  const template = [
    {
      label: 'ملف',
      submenu: [
        {
          label: 'تبويب جديد',
          accelerator: 'CmdOrCtrl+T',
          click: () => tabManager?.createTab(APP_URL),
        },
        {
          label: 'إغلاق التبويب',
          accelerator: 'CmdOrCtrl+W',
          click: () => tabManager?.closeActive(),
        },
        { type: 'separator' },
        {
          label: 'إعادة تحميل',
          accelerator: 'CmdOrCtrl+R',
          click: () => tabManager?.reload(),
        },
        {
          label: 'إعادة تحميل إجباري',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => tabManager?.reload(true),
        },
        { type: 'separator' },
        {
          label: 'طباعة…',
          accelerator: 'CmdOrCtrl+P',
          click: () => tabManager?.activeWebContents()?.print(),
        },
        {
          label: 'فتح في المتصفح',
          click: () => {
            const url = tabManager?.activeWebContents()?.getURL();
            if (url && /^https?:/i.test(url)) shell.openExternal(url);
          },
        },
        { type: 'separator' },
        { label: 'خروج', role: 'quit' },
      ],
    },
    {
      label: 'تحرير',
      submenu: [
        { label: 'تراجع', role: 'undo' },
        { label: 'إعادة', role: 'redo' },
        { type: 'separator' },
        { label: 'قص', role: 'cut' },
        { label: 'نسخ', role: 'copy' },
        { label: 'لصق', role: 'paste' },
        { label: 'تحديد الكل', role: 'selectAll' },
      ],
    },
    {
      label: 'عرض',
      submenu: [
        { label: 'تكبير', role: 'zoomIn' },
        { label: 'تصغير', role: 'zoomOut' },
        { label: 'الحجم الأصلي', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'ملء الشاشة', role: 'togglefullscreen' },
        ...(isDev
          ? [{ type: 'separator' }, { label: 'أدوات المطوّر', role: 'toggleDevTools' }]
          : []),
      ],
    },
    {
      label: 'تنقل',
      submenu: [
        {
          label: 'رجوع',
          accelerator: 'Alt+Left',
          click: () => tabManager?.goBack(),
        },
        {
          label: 'تقدم',
          accelerator: 'Alt+Right',
          click: () => tabManager?.goForward(),
        },
        { type: 'separator' },
        {
          label: 'التبويب التالي',
          accelerator: 'CmdOrCtrl+Tab',
          click: () => tabManager?.nextTab(),
        },
        {
          label: 'التبويب السابق',
          accelerator: 'CmdOrCtrl+Shift+Tab',
          click: () => tabManager?.previousTab(),
        },
        { type: 'separator' },
        {
          label: 'الصفحة الرئيسية',
          accelerator: 'Alt+Home',
          click: () => tabManager?.loadActive(APP_URL),
        },
        { type: 'separator' },
        ...[1, 2, 3, 4, 5, 6, 7, 8].map((index) => ({
          label: `التبويب ${index}`,
          accelerator: `CmdOrCtrl+${index}`,
          visible: false,
          click: () => tabManager?.activateIndex(index - 1),
        })),
        {
          label: 'التبويب الأخير',
          accelerator: 'CmdOrCtrl+9',
          visible: false,
          click: () => {
            if (!tabManager?.tabs.length) return;
            tabManager.activateIndex(tabManager.tabs.length - 1);
          },
        },
      ],
    },
    {
      label: 'مساعدة',
      submenu: [
        {
          label: 'حول AFMS',
          click: () => {
            const icon = iconPath();
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'حول AFMS',
              message: APP_TITLE,
              detail: [
                'تطبيق سطح المكتب لمنصة إدارة الكلية الجامعية',
                'جامعة الوادي — كلية التكنولوجيا',
                APP_URL,
                `الإصدار ${app.getVersion()}`,
              ].join('\n'),
              icon: icon ? nativeImage.createFromPath(icon) : undefined,
            });
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerTabIpc() {
  ipcMain.on('tabs:ready', (event) => {
    if (isShellEvent(event)) tabManager.sendState();
  });
  ipcMain.on('tabs:new', (event) => {
    if (isShellEvent(event)) tabManager.createTab(APP_URL);
  });
  ipcMain.on('tabs:close', (event, id) => {
    if (isShellEvent(event)) tabManager.closeTab(id);
  });
  ipcMain.on('tabs:activate', (event, id) => {
    if (isShellEvent(event)) tabManager.activate(id);
  });
  ipcMain.on('tabs:close-self', (event) => {
    tabManager?.closeByContents(event.sender);
  });
}

function createWindow() {
  const state = loadWindowState();
  const icon = iconPath();

  mainWindow = new BaseWindow({
    width: state.width || 1280,
    height: state.height || 800,
    x: state.x,
    y: state.y,
    minWidth: 960,
    minHeight: 640,
    title: APP_TITLE,
    backgroundColor: '#0f172a',
    show: false,
    icon,
  });

  tabManager = new TabManager({
    window: mainWindow,
    preloadShell: path.join(__dirname, 'preload-shell.js'),
    preloadTab: path.join(__dirname, 'preload.js'),
    errorPage: path.join(__dirname, 'error.html'),
    isAppUrl,
    stateFile: tabsStatePath(),
    onTabCreated: attachContextMenu,
  });

  if (state.isMaximized) mainWindow.maximize();

  let shown = false;
  const showWindow = () => {
    if (shown || !mainWindow || mainWindow.isDestroyed()) return;
    shown = true;
    mainWindow.show();
    mainWindow.focus();
    tabManager.layout();
    tabManager.activeWebContents()?.focus();
  };

  tabManager.chrome.webContents.once('did-finish-load', showWindow);
  setTimeout(showWindow, 2500);

  const layout = () => tabManager?.layout();
  mainWindow.on('resize', layout);
  mainWindow.on('maximize', layout);
  mainWindow.on('unmaximize', layout);
  mainWindow.on('enter-full-screen', layout);
  mainWindow.on('leave-full-screen', layout);
  mainWindow.on('app-command', (_event, command) => {
    if (command === 'browser-backward') tabManager?.goBack();
    if (command === 'browser-forward') tabManager?.goForward();
  });

  mainWindow.on('close', () => {
    saveWindowState(mainWindow);
    tabManager?.saveState();
  });
  mainWindow.on('closed', () => {
    tabManager?.destroy();
    tabManager = null;
    mainWindow = null;
  });

  tabManager.restore(tabManager.loadState());
  layout();
}

function registerDownloadHandler() {
  session.defaultSession.on('will-download', (_event, item) => {
    const fileName = item.getFilename() || 'download';
    item.setSaveDialogOptions({
      defaultPath: path.join(app.getPath('downloads'), fileName),
    });
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.on('web-contents-created', (_event, contents) => {
    applyNavigationPolicy(contents);
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('dz.univ-eloued.ft-edugate.desktop');
    createMenu();
    registerTabIpc();
    registerDownloadHandler();
    createWindow();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
