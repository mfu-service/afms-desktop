'use strict';

const fs = require('fs');
const path = require('path');
const { WebContentsView } = require('electron');
const { APP_URL } = require('./config');

const TAB_BAR_HEIGHT = 44;
const MAX_TABS = 16;
const DEFAULT_TITLE = 'منصة AFMS';

function cleanTitle(title) {
  return String(title || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || DEFAULT_TITLE;
}

function isHttpUrl(url) {
  return typeof url === 'string' && /^https?:/i.test(url);
}

class TabManager {
  constructor({
    window: win,
    preloadShell,
    preloadTab,
    errorPage,
    isAppUrl,
    stateFile,
    onTabCreated,
  }) {
    this.win = win;
    this.preloadShell = preloadShell;
    this.preloadTab = preloadTab;
    this.errorPage = errorPage;
    this.isAppUrl = isAppUrl;
    this.stateFile = stateFile;
    this.onTabCreated = onTabCreated;
    this.tabs = [];
    this.activeId = null;
    this.nextId = 1;
    this.saveTimer = null;
    this.chrome = this.createChrome();
  }

  createChrome() {
    const view = new WebContentsView({
      webPreferences: {
        preload: this.preloadShell,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    view.setBackgroundColor('#0f172a');
    this.win.contentView.addChildView(view);
    view.webContents.loadFile(path.join(__dirname, 'shell.html'));
    return view;
  }

  isChrome(contents) {
    return Boolean(this.chrome && contents === this.chrome.webContents);
  }

  find(id) {
    return this.tabs.find((tab) => tab.id === Number(id));
  }

  findByContents(contents) {
    return this.tabs.find((tab) => tab.view.webContents === contents);
  }

  activeTab() {
    return this.find(this.activeId) || this.tabs[0] || null;
  }

  activeWebContents() {
    const tab = this.activeTab();
    if (!tab || tab.view.webContents.isDestroyed()) return null;
    return tab.view.webContents;
  }

  getState() {
    return {
      tabs: this.tabs.map((tab) => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        loading: tab.loading,
        favicon: tab.favicon,
      })),
      activeId: this.activeId,
    };
  }

  sendState() {
    if (!this.chrome || this.chrome.webContents.isDestroyed()) return;
    this.chrome.webContents.send('tabs:state', this.getState());
    this.scheduleSave();
  }

  contentSize() {
    if (!this.win || this.win.isDestroyed()) return [1280, 800];
    return this.win.getContentSize();
  }

  layout() {
    if (!this.win || this.win.isDestroyed()) return;
    const [width, height] = this.contentSize();
    this.chrome.setBounds({ x: 0, y: 0, width, height: TAB_BAR_HEIGHT });

    const bounds = {
      x: 0,
      y: TAB_BAR_HEIGHT,
      width,
      height: Math.max(0, height - TAB_BAR_HEIGHT),
    };

    for (const tab of this.tabs) {
      const active = tab.id === this.activeId;
      tab.view.setVisible(active);
      if (active) tab.view.setBounds(bounds);
    }
  }

  createTab(url = APP_URL, { activate = true } = {}) {
    const target = isHttpUrl(url) && this.isAppUrl(url) ? url : APP_URL;

    if (this.tabs.length >= MAX_TABS) {
      const oldest = this.tabs.find((tab) => tab.id !== this.activeId) || this.tabs[0];
      if (oldest) this.closeTab(oldest.id, { force: true });
    }

    const id = this.nextId++;
    const view = new WebContentsView({
      webPreferences: {
        preload: this.preloadTab,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true,
      },
    });
    view.setBackgroundColor('#f8fafc');

    const tab = {
      id,
      view,
      title: DEFAULT_TITLE,
      url: target,
      persistUrl: target,
      loading: true,
      favicon: '',
    };

    this.attachTabEvents(tab);
    this.win.contentView.addChildView(view);
    this.tabs.push(tab);
    this.onTabCreated?.(view.webContents);
    view.webContents.loadURL(target);

    if (activate || !this.activeId) this.activate(id);
    else this.layout();

    this.sendState();
    return tab;
  }

  attachTabEvents(tab) {
    const wc = tab.view.webContents;

    const syncTitle = (title) => {
      const next = cleanTitle(title || (wc.isDestroyed() ? '' : wc.getTitle()));
      if (next === tab.title) return;
      tab.title = next;
      this.sendState();
    };

    wc.on('page-title-updated', (event, title) => {
      event.preventDefault();
      syncTitle(title);
    });

    wc.on('page-favicon-updated', (_event, favicons) => {
      tab.favicon = favicons?.[0] || '';
      this.sendState();
    });

    wc.on('did-start-loading', () => {
      tab.loading = true;
      this.syncProgress();
      this.sendState();
    });

    wc.on('did-stop-loading', () => {
      tab.loading = false;
      syncTitle();
      this.syncProgress();
      this.sendState();
    });

    wc.on('did-navigate', (_event, url) => this.updateUrl(tab, url));
    wc.on('did-navigate-in-page', (_event, url) => this.updateUrl(tab, url));

    wc.on('did-fail-load', (_event, errorCode, _desc, url, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      const failed = isHttpUrl(url) ? url : tab.persistUrl || APP_URL;
      tab.persistUrl = failed;
      wc.loadFile(this.errorPage, { query: { url: failed } });
    });
  }

  updateUrl(tab, url) {
    tab.url = url;
    if (isHttpUrl(url) && this.isAppUrl(url)) tab.persistUrl = url;
    this.sendState();
  }

  activate(id) {
    const tab = this.find(id);
    if (!tab) return;
    this.activeId = tab.id;
    this.win.contentView.addChildView(tab.view);
    this.layout();
    this.syncProgress();
    if (!tab.view.webContents.isDestroyed()) {
      tab.view.webContents.focus();
    }
    this.sendState();
  }

  closeTab(id, { force = false } = {}) {
    const tab = this.find(id);
    if (!tab) return;

    if (!force && this.tabs.length === 1) {
      this.loadUrl(tab, APP_URL);
      return;
    }

    const index = this.tabs.indexOf(tab);
    this.destroyTab(tab);
    this.tabs.splice(index, 1);

    if (!this.tabs.length) {
      this.activeId = null;
      this.createTab(APP_URL);
      return;
    }

    if (this.activeId === tab.id) {
      const next = this.tabs[Math.min(index, this.tabs.length - 1)];
      this.activate(next.id);
    } else {
      this.layout();
      this.sendState();
    }
  }

  closeByContents(contents) {
    const tab = this.findByContents(contents);
    if (tab) this.closeTab(tab.id);
  }

  closeActive() {
    if (this.activeId != null) this.closeTab(this.activeId);
  }

  nextTab() {
    if (this.tabs.length < 2) return;
    const index = this.tabs.findIndex((tab) => tab.id === this.activeId);
    const next = this.tabs[(index + 1 + this.tabs.length) % this.tabs.length];
    this.activate(next.id);
  }

  previousTab() {
    if (this.tabs.length < 2) return;
    const index = this.tabs.findIndex((tab) => tab.id === this.activeId);
    const prev = this.tabs[(index - 1 + this.tabs.length) % this.tabs.length];
    this.activate(prev.id);
  }

  activateIndex(index) {
    const tab = this.tabs[index];
    if (tab) this.activate(tab.id);
  }

  goBack() {
    const history = this.historyApi();
    if (history?.canGoBack()) history.goBack();
  }

  goForward() {
    const history = this.historyApi();
    if (history?.canGoForward()) history.goForward();
  }

  reload(ignoreCache = false) {
    const wc = this.activeWebContents();
    if (!wc) return;
    if (ignoreCache) wc.reloadIgnoringCache();
    else wc.reload();
  }

  loadActive(url) {
    const tab = this.activeTab();
    if (tab) this.loadUrl(tab, url);
  }

  loadUrl(tab, url) {
    if (!tab || tab.view.webContents.isDestroyed()) return;
    tab.title = DEFAULT_TITLE;
    tab.favicon = '';
    tab.url = url;
    tab.persistUrl = isHttpUrl(url) ? url : tab.persistUrl;
    tab.view.webContents.loadURL(url);
    this.sendState();
  }

  historyApi() {
    const wc = this.activeWebContents();
    if (!wc) return null;
    return wc.navigationHistory ?? wc;
  }

  syncProgress() {
    if (!this.win || this.win.isDestroyed()) return;
    const tab = this.activeTab();
    this.win.setProgressBar(tab?.loading ? 2 : -1);
  }

  restore(state) {
    const urls = Array.isArray(state?.tabs)
      ? state.tabs.filter((url) => isHttpUrl(url) && this.isAppUrl(url)).slice(0, MAX_TABS)
      : [];

    if (!urls.length) {
      this.createTab(APP_URL);
      return;
    }

    urls.forEach((url) => this.createTab(url, { activate: false }));
    const index = Math.min(Math.max(0, Number(state.activeIndex) || 0), this.tabs.length - 1);
    this.activate(this.tabs[index].id);
  }

  loadState() {
    try {
      return JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
    } catch {
      return null;
    }
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveState(), 250);
  }

  saveState() {
    if (!this.stateFile) return;
    const payload = {
      tabs: this.tabs.map((tab) => tab.persistUrl).filter(isHttpUrl),
      activeIndex: Math.max(
        0,
        this.tabs.findIndex((tab) => tab.id === this.activeId),
      ),
    };
    try {
      fs.writeFileSync(this.stateFile, JSON.stringify(payload));
    } catch {
      // ignore persistence errors
    }
  }

  destroyTab(tab) {
    try {
      this.win.contentView.removeChildView(tab.view);
    } catch {
      // already detached
    }
    if (!tab.view.webContents.isDestroyed()) {
      tab.view.webContents.destroy();
    }
  }

  destroy() {
    clearTimeout(this.saveTimer);
    this.saveState();
    for (const tab of this.tabs) this.destroyTab(tab);
    this.tabs = [];
    if (this.chrome && !this.chrome.webContents.isDestroyed()) {
      this.chrome.webContents.destroy();
    }
    this.chrome = null;
    this.activeId = null;
  }
}

module.exports = { TabManager, TAB_BAR_HEIGHT };
