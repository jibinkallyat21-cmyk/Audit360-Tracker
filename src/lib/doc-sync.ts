/**
 * Browser side of "save uploaded files to my computer" (System Administrator only).
 * The administrator picks a folder once; this keeps the folder handle and the list of versions
 * already saved in the browser (IndexedDB), then writes every new version into
 * process / step / line folders. A saved version is never downloaded again, even if the file is
 * later moved or deleted from the folder.
 */

interface PermissionHandle extends FileSystemDirectoryHandle {
  queryPermission(d: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(d: { mode: "readwrite" }): Promise<PermissionState>;
}

export const syncSupported = () =>
  typeof window !== "undefined" &&
  "showDirectoryPicker" in window &&
  typeof indexedDB !== "undefined" &&
  "locks" in navigator;

const DB = "audit360-docsync";
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("kv");
      r.result.createObjectStore("done");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function tx<T>(
  store: "kv" | "done",
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export interface SyncInfo {
  lastRun: string | null;
  lastSaved: number;
  lastFailed: number;
  total: number;
}

export const getHandle = () =>
  tx<FileSystemDirectoryHandle | undefined>("kv", "readonly", (s) => s.get("dir"));
export const getInfo = () => tx<SyncInfo | undefined>("kv", "readonly", (s) => s.get("info"));
const setInfo = (i: SyncInfo) => tx("kv", "readwrite", (s) => s.put(i, "info"));
export const savedCount = () => tx<number>("done", "readonly", (s) => s.count());
export const markDone = (id: string) => tx("done", "readwrite", (s) => s.put(Date.now(), id));
export const isDone = async (id: string) =>
  (await tx<unknown>("done", "readonly", (s) => s.get(id))) !== undefined;
export async function forget() {
  await tx("kv", "readwrite", (s) => s.clear());
  await tx("done", "readwrite", (s) => s.clear());
}

/** Lets the person choose the folder (must be called from a click). */
export async function chooseFolder(): Promise<FileSystemDirectoryHandle> {
  const pick = (
    window as unknown as {
      showDirectoryPicker(o: { mode: "readwrite" }): Promise<FileSystemDirectoryHandle>;
    }
  ).showDirectoryPicker;
  const handle = await pick.call(window, { mode: "readwrite" });
  await tx("kv", "readwrite", (s) => s.put(handle, "dir"));
  return handle;
}

export async function permission(
  handle: FileSystemDirectoryHandle,
  ask: boolean,
): Promise<PermissionState> {
  const h = handle as PermissionHandle;
  const now = await h.queryPermission({ mode: "readwrite" });
  if (now === "granted" || !ask) return now;
  return h.requestPermission({ mode: "readwrite" });
}

async function save(root: FileSystemDirectoryHandle, path: string[], bytes: ArrayBuffer) {
  let dir = root;
  for (const part of path.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
  const name = path[path.length - 1];
  try {
    await dir.getFileHandle(name); // already there (for example saved by hand): leave it alone
    return;
  } catch {
    // not there yet
  }
  const file = await dir.getFileHandle(name, { create: true });
  const w = await file.createWritable();
  await w.write(bytes);
  await w.close();
}

/** One pass: saves every version not saved before. Returns null if another pass is running. */
export async function runSync(
  root: FileSystemDirectoryHandle,
  onProgress?: (done: number, of: number) => void,
): Promise<SyncInfo | null> {
  return navigator.locks.request("audit360-docsync", { ifAvailable: true }, async (lock) => {
    if (!lock) return null;
    const res = await fetch("/api/documents/sync", { cache: "no-store" });
    if (!res.ok) throw new Error("The list of files could not be loaded.");
    const { files } = (await res.json()) as { files: { id: string; path: string[] }[] };
    const todo: typeof files = [];
    for (const f of files) if (!(await isDone(f.id))) todo.push(f);
    let saved = 0;
    let failed = 0;
    for (const f of todo) {
      try {
        const r = await fetch(`/api/documents/sync/${f.id}`, { cache: "no-store" });
        if (!r.ok) throw new Error("download");
        await save(root, f.path, await r.arrayBuffer());
        await markDone(f.id);
        saved++;
      } catch {
        failed++;
      }
      onProgress?.(saved + failed, todo.length);
    }
    const info: SyncInfo = {
      lastRun: new Date().toISOString(),
      lastSaved: saved,
      lastFailed: failed,
      total: await savedCount(),
    };
    await setInfo(info);
    return info;
  });
}

/** Marks everything uploaded so far as saved, so only future uploads are downloaded. */
export async function skipExisting() {
  const res = await fetch("/api/documents/sync", { cache: "no-store" });
  if (!res.ok) throw new Error("The list of files could not be loaded.");
  const { files } = (await res.json()) as { files: { id: string }[] };
  for (const f of files) await markDone(f.id);
}
