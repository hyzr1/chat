import { app, BrowserWindow, dialog, ipcMain, nativeTheme, safeStorage, shell } from "electron";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { startAgent } from "../src/core.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
let window;
let controller;
let state = { phase: "idle", message: "Ready to pair", capabilities: null };
let desktopConfigFile;
let desktopTokenFile;
let pendingPairLink;

function parsePairLink(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "hyzr:" || url.hostname !== "pair") return null;
    const relay = new URL(url.searchParams.get("relay") || "");
    if (relay.protocol !== "https:" && !(relay.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(relay.hostname))) return null;
    const code = String(url.searchParams.get("code") || "").toUpperCase();
    if (!/^[A-Z2-9]{6,8}$/.test(code)) return null;
    return { relay: relay.origin, code };
  } catch {
    return null;
  }
}

function acceptPairLink(value) {
  const parsed = parsePairLink(value);
  if (!parsed) return;
  pendingPairLink = parsed;
  window?.show();
  window?.focus();
  window?.webContents.send("agent:pair-link", parsed);
}

function sendState() {
  window?.webContents.send("agent:state", state);
}

function setState(next) {
  state = { ...state, ...next };
  sendState();
}

function createWindow() {
  window = new BrowserWindow({
    width: 620,
    height: 720,
    minWidth: 520,
    minHeight: 620,
    show: false,
    title: "Hyzr Agent",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#111210" : "#f7f7f5",
    icon: path.join(directory, "icon.svg"),
    webPreferences: {
      preload: path.join(directory, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.removeMenu();
  window.loadFile(path.join(directory, "index.html"));
  window.once("ready-to-show", () => window.show());
  window.webContents.once("did-finish-load", () => {
    if (pendingPairLink) window.webContents.send("agent:pair-link", pendingPairLink);
  });
  window.on("close", (event) => {
    if (!app.isQuitting && ["connecting", "connected", "reconnecting"].includes(state.phase)) {
      event.preventDefault();
      window.hide();
    }
  });
}

async function readDesktopConfig() {
  try {
    const config = JSON.parse(await readFile(desktopConfigFile, "utf8"));
    const encrypted = await readFile(desktopTokenFile);
    const token = safeStorage.decryptString(encrypted);
    return { ...config, token };
  } catch {
    return {};
  }
}

async function persistDesktopConfig(config) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Operating-system credential encryption is unavailable for the pairing token.");
  await mkdir(path.dirname(desktopConfigFile), { recursive: true });
  const { token, ...publicConfig } = config;
  await writeFile(desktopConfigFile, JSON.stringify(publicConfig, null, 2), { encoding: "utf8", mode: 0o600 });
  await writeFile(desktopTokenFile, safeStorage.encryptString(token), { mode: 0o600 });
}

async function connect(values) {
  if (state.phase === "connecting" || state.phase === "connected") return state;
  controller?.abort();
  controller = new AbortController();
  setState({ phase: "connecting", message: "Checking Claude, Codex, Git, and GitHub CLI…", capabilities: null });
  app.setLoginItemSettings({ openAtLogin: values.startAtLogin !== false, openAsHidden: true });
  void startAgent({
    relay: String(values.relay || "https://chat.hyzr.ai"),
    code: String(values.code || "").trim().toUpperCase(),
    token: values.token,
    workspaceRoot: String(values.workspaceRoot || ""),
    permissionMode: values.permissionMode === "full-access" ? "full-access" : "workspace",
    signal: controller.signal,
    persistConfig: persistDesktopConfig,
    onStatus(update) {
      if (update.connected) {
        setState({ phase: "connected", message: "Paired and listening for work", capabilities: update.capabilities });
      } else {
        setState({ phase: "reconnecting", message: update.error || "Reconnecting…", capabilities: state.capabilities });
      }
    },
  }).catch((error) => {
    setState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
  });
  return state;
}

ipcMain.handle("agent:defaults", async () => {
  const saved = await readDesktopConfig();
  return {
    relay: saved.relay || "https://chat.hyzr.ai",
    workspaceRoot: saved.workspaceRoot || path.join(os.homedir(), "Hyzr Workspaces"),
    permissionMode: saved.permissionMode || "workspace",
    state,
    platform: process.platform,
    version: app.getVersion(),
  };
});

ipcMain.handle("agent:choose-folder", async () => {
  const result = await dialog.showOpenDialog(window, { properties: ["openDirectory", "createDirectory"] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("agent:pair", async (_event, values) => {
  return connect(values);
});

ipcMain.handle("agent:open-workspaces", (_event, workspaceRoot) => shell.openPath(String(workspaceRoot)));
ipcMain.handle("agent:disconnect", () => {
  controller?.abort();
  controller = undefined;
  app.setLoginItemSettings({ openAtLogin: false });
  void Promise.all([unlink(desktopConfigFile).catch(() => {}), unlink(desktopTokenFile).catch(() => {})]);
  setState({ phase: "idle", message: "Disconnected", capabilities: null });
  return state;
});

app.whenReady().then(() => {
  const stateDirectory = app.getPath("userData");
  desktopConfigFile = path.join(stateDirectory, "agent.json");
  desktopTokenFile = path.join(stateDirectory, "agent-token.bin");
  createWindow();
  app.setAsDefaultProtocolClient("hyzr");
  for (const argument of process.argv) if (argument.startsWith("hyzr://")) acceptPairLink(argument);
  void readDesktopConfig().then((saved) => {
    if (saved.token && saved.relay && saved.workspaceRoot) void connect({ ...saved, startAtLogin: true });
  });
  app.on("activate", () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
    else window?.show();
  });
});

const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    for (const argument of argv) if (argument.startsWith("hyzr://")) acceptPairLink(argument);
    window?.show();
  });
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  acceptPairLink(url);
});

app.on("before-quit", () => {
  app.isQuitting = true;
  controller?.abort();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && state.phase !== "connected") app.quit();
});
