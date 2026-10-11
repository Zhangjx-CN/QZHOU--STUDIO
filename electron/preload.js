const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aibo", {
  platform: process.platform,
  version: "0.1.0",
  saveDialog: (opts) => ipcRenderer.invoke("aibo:save-dialog", opts),
  saveTextAs: (opts) => ipcRenderer.invoke("aibo:save-text-as", opts),
  clipboard: (text) => ipcRenderer.invoke("aibo:clipboard", text),
  openFolder: (path) => ipcRenderer.invoke("aibo:open-folder", path),
  openPath: (path) => ipcRenderer.invoke("aibo:open-path", path),
  saveFileCopy: (src, dest) => ipcRenderer.invoke("aibo:save-file-copy", { src, dest }),
  getToken: () => ipcRenderer.invoke("aibo:get-token"),
  winMin: () => ipcRenderer.send("aibo:win-min"),
  winMax: () => ipcRenderer.send("aibo:win-max"),
  winClose: () => ipcRenderer.send("aibo:win-close"),
});
