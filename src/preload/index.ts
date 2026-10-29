/** Exposes only the contract's methods and events (constitution II). Bundled as one CommonJS file. */
import { contextBridge, ipcRenderer } from "electron";
import { EVENT_CHANNELS, METHODS, type EventChannel, type EventMap } from "../shared/ipc-contract";

const allowedEvents: ReadonlySet<string> = new Set(EVENT_CHANNELS);

const groups = Object.fromEntries(
  Object.entries(METHODS).map(([group, methods]) => [
    group,
    Object.freeze(
      Object.fromEntries(
        Object.entries(methods).map(([name, channel]) => [name, (payload?: unknown) => ipcRenderer.invoke(channel, payload)]),
      ),
    ),
  ]),
);

function on<E extends EventChannel>(event: E, handler: (payload: EventMap[E]) => void): () => void {
  if (!allowedEvents.has(event)) throw new Error(`Unknown event: ${event}`);
  const listener = (_e: Electron.IpcRendererEvent, payload: EventMap[E]) => {
    handler(payload);
  };
  ipcRenderer.on(event, listener);
  return () => {
    ipcRenderer.removeListener(event, listener);
  };
}

contextBridge.exposeInMainWorld("vesta", Object.freeze({ ...groups, on }));
