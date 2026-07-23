import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import type { OpenDialogOptions } from 'electron';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { PathGrantRegistry } from './path-grant-registry';
import { EngineClient } from './engine-client';
import { InventorySnapshotStore } from './inventory-snapshot-store';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

const grants = new PathGrantRegistry();
const engine = new EngineClient();

app.commandLine.appendSwitch('disable-http-cache');

function validateSender(frameUrl: string): boolean {
  try {
    const actual = new URL(frameUrl);
    const expected = new URL(MAIN_WINDOW_WEBPACK_ENTRY);
    return expected.protocol === 'file:'
      ? actual.href === expected.href
      : actual.origin === expected.origin;
  } catch {
    return false;
  }
}

function registerIpc(snapshotStore: InventorySnapshotStore): void {
  const activeImports = new Set<number>();
  ipcMain.handle('engine:get-hello', event => {
    if (!event.senderFrame || !validateSender(event.senderFrame.url)) throw new Error('desktop.protocol.sender_rejected');
    return engine.getHello();
  });

  ipcMain.handle('save:get-cached-inventory', event => {
    if (!event.senderFrame || !validateSender(event.senderFrame.url)) throw new Error('desktop.protocol.sender_rejected');
    return snapshotStore.load();
  });

  ipcMain.handle('save:choose-file', async event => {
    if (!event.senderFrame || !validateSender(event.senderFrame.url)) throw new Error('desktop.protocol.sender_rejected');
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: '选择 GBFR 存档',
      properties: ['openFile'],
      filters: [{ name: 'GBFR SaveData', extensions: ['dat'] }],
      defaultPath: await snapshotStore.getLastSourcePath()
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length !== 1) return null;
    return grants.create(event.sender.id, result.filePaths[0]!);
  });

  ipcMain.handle('save:import', async (event, grantId: unknown) => {
    if (!event.senderFrame || !validateSender(event.senderFrame.url)) throw new Error('desktop.protocol.sender_rejected');
    if (typeof grantId !== 'string' || !/^[0-9a-f]{32}$/.test(grantId)) throw new Error('desktop.grant.invalid');
    const ownerId = event.sender.id;
    if (activeImports.has(ownerId)) throw new Error('desktop.import.already_running');
    activeImports.add(ownerId);
    let temporaryRoot: string | null = null;
    try {
      const sourcePath = await grants.consume(ownerId, grantId, 'importInventory');
      temporaryRoot = await mkdtemp(path.join(app.getPath('temp'), 'gbfr-factor-planner-'));
      const snapshotPath = path.join(temporaryRoot, 'SaveData.snapshot.dat');
      // Always parse a private snapshot. The selected game save is only ever the
      // source of a copy operation and is never handed to a writable component.
      await copyFile(sourcePath, snapshotPath);
      const imported = await engine.importInventory(snapshotPath);
      return snapshotStore.save(sourcePath, path.basename(sourcePath), imported);
    } finally {
      if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
      activeImports.delete(ownerId);
    }
  });
}

async function createWindow(): Promise<void> {
  const mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 720,
    minHeight: 640,
    backgroundColor: '#F2EFE8',
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });
  const ownerId = mainWindow.webContents.id;

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.on('closed', () => grants.revokeOwner(ownerId));
  await mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
}

app.whenReady().then(async () => {
  const userDataPath = app.getPath('userData');
  await rm(path.join(userDataPath, 'save-backups'), { recursive: true, force: true }).catch(error => {
    // This is a one-time migration cleanup. A locked legacy file must never keep
    // the application from opening; another launch can try again.
    console.error('Legacy save backup cleanup failed.', error);
  });
  const snapshotStore = new InventorySnapshotStore(path.join(userDataPath, 'inventory-snapshot.v1.json'));
  await session.defaultSession.clearCache().catch(error => {
    console.error('HTTP cache cleanup failed.', error);
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = app.isPackaged
      ? "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:"
      : "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:";
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
  });
  registerIpc(snapshotStore);
  try {
    await engine.start();
  } catch (error) {
    console.error('Engine startup failed.', error);
  }
  await createWindow();
});

app.on('window-all-closed', () => {
  engine.stop();
  app.quit();
});
