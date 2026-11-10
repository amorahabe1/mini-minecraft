// 存档：IndexedDB（世界信息 + 修改过的区块）
const DB = 'mini-minecraft', VER = 1;
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('worlds')) d.createObjectStore('worlds', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('chunks')) d.createObjectStore('chunks');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
function req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
export async function listWorlds() {
  const d = await db();
  const all = await req(d.transaction('worlds').objectStore('worlds').getAll());
  return all.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
}
export async function saveWorldMeta(meta) {
  const d = await db();
  await req(d.transaction('worlds', 'readwrite').objectStore('worlds').put(meta));
}
export async function loadWorldMeta(id) {
  const d = await db();
  return req(d.transaction('worlds').objectStore('worlds').get(id));
}
export async function deleteWorld(id) {
  const d = await db();
  const tx = d.transaction(['worlds', 'chunks'], 'readwrite');
  tx.objectStore('worlds').delete(id);
  const range = IDBKeyRange.bound(id + '|', id + '|\uffff');
  tx.objectStore('chunks').delete(range);
  return new Promise((res) => { tx.oncomplete = res; tx.onerror = res; });
}
export class WorldStore {
  constructor(worldId) { this.id = worldId; }
  async savedChunkKeys() {
    const d = await db();
    const range = IDBKeyRange.bound(this.id + '|', this.id + '|\uffff');
    const keys = await req(d.transaction('chunks').objectStore('chunks').getAllKeys(range));
    return keys.map((k) => k.slice(this.id.length + 1));
  }
  async loadChunk(k) {
    const d = await db();
    const v = await req(d.transaction('chunks').objectStore('chunks').get(this.id + '|' + k));
    if (!v) return null;
    return { blocks: new Uint8Array(v.blocks), biomes: v.biomes ? new Uint8Array(v.biomes) : null };
  }
  async saveChunk(k, c) {
    const d = await db();
    c.modified = false;
    await req(d.transaction('chunks', 'readwrite').objectStore('chunks').put({ blocks: c.blocks.slice().buffer, biomes: c.biomes ? c.biomes.slice().buffer : null }, this.id + '|' + k));
  }
}

const SETTINGS_KEY = 'mini-minecraft-settings';
export const DEFAULT_SETTINGS = { renderDistance: 6, fov: 70, sensitivity: 100, viewBobbing: true, clouds: true, volume: 100, music: 50, gamma: 50, guiScale: 0, invertY: false };
export function loadSettings() {
  try { return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); }
  catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }
