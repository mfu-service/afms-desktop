'use strict';

const path = require('path');
const fs = require('fs');
const {
  app,
  BrowserWindow,
  Menu,
  shell,
  dialog,
  session,
  screen,
  nativeImage,
} = require('electron');
const { APP_URL, APP_TITLE, ALLOWED_HOST_SUFFIXES } = require('./config');

const isDev = !app.isPackaged;

let mainWindow = null;

function stateFilePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
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
    return normalized.includes('/src/error.html');
  }
  return isAllowedHost(hostOf(url));
}

function applyNavigationPolicy(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) {
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
    shell.openExternal(url);
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
}

function createMenu() {
  const template = [
    {
      label: 'ملف',
      submenu: [
        {
          label: 'إعادة تحميل',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow?.webContents.reload(),
        },
        {
          label: 'إعادة تحميل إجباري',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => mainWindow?.webContents.reloadIgnoringCache(),
        },
        { type: 'separator' },
        {
          label: 'طباعة…',
          accelerator: 'CmdOrCtrl+P',
          click: () => mainWindow?.webContents.print(),
        },
        {
          label: 'فتح في المتصفح',
          click: () => {
            const url = mainWindow?.webContents.getURL();
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
          click: () => {
            const history = historyApi(mainWindow?.webContents);
            if (history?.canGoBack()) history.goBack();
          },
        },
        {
          label: 'تقدم',
          accelerator: 'Alt+Right',
          click: () => {
            const history = historyApi(mainWindow?.webContents);
            if (history?.canGoForward()) history.goForward();
          },
        },
        { type: 'separator' },
        {
          label: 'الصفحة الرئيسية',
          accelerator: 'Alt+Home',
          click: () => mainWindow?.loadURL(APP_URL),
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

function attachContextMenu(win) {
  win.webContents.on('context-menu', (_event, params) => {
    const history = historyApi(win.webContents);
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
      { label: 'إعادة تحميل', click: () => win.webContents.reload() },
      { type: 'separator' },
      { label: 'قص', role: 'cut', enabled: params.editFlags.canCut },
      { label: 'نسخ', role: 'copy', enabled: params.editFlags.canCopy },
      { label: 'لصق', role: 'paste', enabled: params.editFlags.canPaste },
      { label: 'تحديد الكل', role: 'selectAll' },
    ];

    if (params.linkURL) {
      template.unshift(
        {
          label: 'فتح الرابط في المتصفح',
          click: () => shell.openExternal(params.linkURL),
        },
        { type: 'separator' },
      );
    }

    Menu.buildFromTemplate(template).popup({ window: win });
  });
}

function createWindow() {
  const state = loadWindowState();
  const icon = iconPath();

  mainWindow = new BrowserWindow({
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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  if (state.isMaximized) mainWindow.maximize();

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) return;
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('close', () => saveWindowState(mainWindow));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, _desc, _url, isMainFrame) => {
    if (!isMainFrame || !mainWindow) return;
    if (errorCode === -3) return;
    mainWindow.loadFile(path.join(__dirname, 'error.html'), {
      query: { url: APP_URL },
    });
  });

  mainWindow.webContents.on('page-title-updated', (event) => {
    event.preventDefault();
    mainWindow?.setTitle(APP_TITLE);
  });

  mainWindow.webContents.on('did-start-loading', () => {
    mainWindow?.setProgressBar(2);
  });
  mainWindow.webContents.on('did-stop-loading', () => {
    mainWindow?.setProgressBar(-1);
  });

  attachContextMenu(mainWindow);
  mainWindow.loadURL(APP_URL);
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
    registerDownloadHandler();
    createWindow();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
