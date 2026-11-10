/* Settings data for the Memory, Storage and Account tabs: the saved memory
   summary and the list of uploaded files. Settings (shell/SettingsPanels.tsx)
   draws them; the chat core refreshes the file list after it deletes something. */
import { create } from "zustand";
import { session } from "../app/runtime";
import { clearMemory, fetchMemory, fetchStorage, updateMemory } from "../islands/api.js";
import { loadMe } from "./boot";

export type Memory = { enabled: boolean; content: string };
export type StorageItem = {
  id: string;
  fileName?: string;
  sizeBytes?: number;
  status?: string;
  canDelete?: boolean;
  conversationId?: string;
  conversationTitle?: string;
  projectId?: string;
  projectName?: string;
  siblingCount?: number;
  siblingBytes?: number;
};

type AccountData = {
  memory: Memory | null;
  memoryNotice: string;
  memoryBusy: boolean;
  /** null while loading; the message stands in for the list. */
  storageItems: StorageItem[] | null;
  storageMessage: string;
};

const EMPTY: AccountData = { memory: null, memoryNotice: "", memoryBusy: false, storageItems: null, storageMessage: "Loading files..." };

export const useAccount = create<AccountData>(() => ({ ...EMPTY }));
const set = useAccount.setState;

/** Sign-out drops what the last account saw. */
export function resetAccountData() {
  set({ ...EMPTY });
}

const errorText = (error: unknown, fallback: string) => (error as Error)?.message || fallback;

export async function loadAccountStorage() {
  const current = session.current();
  if (!current) return;
  try {
    const payload = await fetchStorage(current);
    set({ storageItems: Array.isArray(payload?.items) ? payload.items : [], storageMessage: "" });
  } catch (error) {
    set({ storageItems: null, storageMessage: errorText(error, "Could not load files.") });
  }
}

/** After an upload is deleted: the usage meter and the file list. */
export function refreshAccountStorage() {
  return loadMe().then(loadAccountStorage).catch(() => {});
}

export async function loadMemorySettings() {
  const current = session.current();
  if (!current) return;
  set({ memoryNotice: "Loading memory..." });
  try {
    const payload = await fetchMemory(current);
    set({ memory: payload.memory, memoryNotice: "" });
  } catch (error) {
    set({ memoryNotice: errorText(error, "Could not load memory.") });
  }
}

export async function setMemoryEnabled(enabled: boolean) {
  const current = session.current();
  if (!current) return;
  set({ memoryBusy: true, memoryNotice: enabled ? "Turning memory on..." : "Turning memory off..." });
  try {
    const payload = await updateMemory(current, { enabled });
    set({
      memory: payload.memory,
      memoryNotice: enabled
        ? "Memory is on. Only new messages you send from now on can be remembered."
        : "Memory is off. Your existing summary is kept but will not be used or updated."
    });
  } catch (error) {
    set({ memoryNotice: errorText(error, "Could not update memory.") });
  } finally {
    set({ memoryBusy: false });
  }
}

/** Resolves true once saved, so the editor can drop its draft. */
export async function saveMemoryContent(content: string) {
  const current = session.current();
  if (!current) return false;
  set({ memoryBusy: true, memoryNotice: "Saving..." });
  try {
    const payload = await updateMemory(current, { content });
    set({ memory: payload.memory, memoryNotice: "Saved. Changes apply to future replies." });
    return true;
  } catch (error) {
    set({ memoryNotice: errorText(error, "Could not save memory.") });
    return false;
  } finally {
    set({ memoryBusy: false });
  }
}

export async function clearMemorySummary() {
  const current = session.current();
  if (!current) return false;
  set({ memoryBusy: true });
  try {
    const payload = await clearMemory(current);
    set({ memory: payload.memory, memoryNotice: "Memory cleared." });
    return true;
  } catch (error) {
    set({ memoryNotice: errorText(error, "Could not clear memory.") });
    return false;
  } finally {
    set({ memoryBusy: false });
  }
}

export function setMemoryNotice(memoryNotice: string) {
  set({ memoryNotice });
}

/** What picking a tab loads, every time it is picked (the old settingsTabSelected). */
export function loadSettingsTab(tab: string) {
  if (!session.current()) return;
  if (tab === "memory" && !useAccount.getState().memory) void loadMemorySettings();
  if (tab === "storage") {
    set({ storageItems: null, storageMessage: "Loading files..." });
    void Promise.all([loadMe(), loadAccountStorage()]).catch(() => {});
  }
  if (tab === "account") void loadMe().catch(() => {});
}
