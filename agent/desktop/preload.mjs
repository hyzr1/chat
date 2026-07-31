import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("hyzrAgent", {
  defaults: () => ipcRenderer.invoke("agent:defaults"),
  chooseFolder: () => ipcRenderer.invoke("agent:choose-folder"),
  pair: (values) => ipcRenderer.invoke("agent:pair", values),
  disconnect: () => ipcRenderer.invoke("agent:disconnect"),
  openWorkspaces: (workspaceRoot) => ipcRenderer.invoke("agent:open-workspaces", workspaceRoot),
  openExternal: (url) => ipcRenderer.invoke("agent:open-external", url),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("agent:state", listener);
    return () => ipcRenderer.removeListener("agent:state", listener);
  },
  onPairLink: (callback) => {
    const listener = (_event, values) => callback(values);
    ipcRenderer.on("agent:pair-link", listener);
    return () => ipcRenderer.removeListener("agent:pair-link", listener);
  },
});
