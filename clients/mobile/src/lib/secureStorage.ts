import * as SecureStore from "expo-secure-store";
import type { KeyValueStorage } from "@klui/shared";

/* SecureStore values are size-limited, and a Supabase session can exceed the
   limit. Long values are split into chunks under a fresh generation, and the
   manifest that points at them is written last, so a crash mid-write leaves
   the previous value readable. */
const CHUNK = 1800;
const safeKey = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, "_");

interface Manifest { gen: string; count: number }

async function readManifest(key: string): Promise<Manifest | null> {
  const raw = await SecureStore.getItemAsync(`${safeKey(key)}.manifest`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Manifest;
    return parsed.gen && parsed.count > 0 ? parsed : null;
  } catch {
    return null;
  }
}

async function removeChunks(key: string, manifest: Manifest | null) {
  if (!manifest) return;
  await Promise.all(Array.from({ length: manifest.count }, (_, i) =>
    SecureStore.deleteItemAsync(`${safeKey(key)}.${manifest.gen}.${i}`).catch(() => {})));
}

export const secureStorage: KeyValueStorage = {
  async get(key) {
    const manifest = await readManifest(key);
    if (!manifest) return SecureStore.getItemAsync(safeKey(key));
    const parts = await Promise.all(Array.from({ length: manifest.count }, (_, i) =>
      SecureStore.getItemAsync(`${safeKey(key)}.${manifest.gen}.${i}`)));
    return parts.every((part) => part != null) ? parts.join("") : null;
  },
  async set(key, value) {
    const previous = await readManifest(key);
    if (value.length <= CHUNK) {
      await SecureStore.setItemAsync(safeKey(key), value);
      await SecureStore.deleteItemAsync(`${safeKey(key)}.manifest`);
    } else {
      const gen = Date.now().toString(36);
      const count = Math.ceil(value.length / CHUNK);
      for (let i = 0; i < count; i++) {
        await SecureStore.setItemAsync(`${safeKey(key)}.${gen}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
      }
      await SecureStore.setItemAsync(`${safeKey(key)}.manifest`, JSON.stringify({ gen, count }));
      await SecureStore.deleteItemAsync(safeKey(key)).catch(() => {});
    }
    await removeChunks(key, previous);
  },
  async remove(key) {
    const manifest = await readManifest(key);
    await SecureStore.deleteItemAsync(`${safeKey(key)}.manifest`).catch(() => {});
    await SecureStore.deleteItemAsync(safeKey(key)).catch(() => {});
    await removeChunks(key, manifest);
  }
};
