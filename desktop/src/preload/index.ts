import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from '../shared/contracts';

const api: DesktopApi = {
  getEngineHello: () => ipcRenderer.invoke('engine:get-hello'),
  getCachedInventory: () => ipcRenderer.invoke('save:get-cached-inventory'),
  chooseSaveFile: () => ipcRenderer.invoke('save:choose-file'),
  importSaveFile: grantId => ipcRenderer.invoke('save:import', grantId),
  openProjectPage: () => ipcRenderer.invoke('app:open-project')
};

contextBridge.exposeInMainWorld('gbfrDesktop', api);
