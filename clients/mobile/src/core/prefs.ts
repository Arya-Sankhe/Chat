import { File, Paths } from "expo-file-system";

/* Small values kept across launches, outside secure storage. */
const prefsFile = new File(Paths.document, "klui-preferences.json");
const prefsBackup = new File(Paths.document, "klui-preferences.backup.json");
let cache: Record<string, string> | null = null;

function read(file: File): Record<string, string> | null {
  try {
    return file.exists ? JSON.parse(file.textSync()) : null;
  } catch {
    return null;
  }
}

function values(): Record<string, string> {
  cache ??= read(prefsFile) ?? read(prefsBackup) ?? {};
  return cache;
}

/* Synchronous, so saves land in order and a success reply means it is on disk
   (File.write is async and can overlap). The backup is complete before the main
   file is touched, so a kill during a save leaves one of them whole. */
function save() {
  const contents = JSON.stringify(values());
  prefsBackup.writeSync(contents);
  prefsFile.writeSync(contents);
}

export const prefs = {
  get: (key: string) => values()[key] ?? null,
  has: (key: string) => key in values(),
  set(key: string, value: string) {
    values()[key] = value;
    save();
  },
  remove(key: string) {
    delete values()[key];
    save();
  },
  /** Adds what isn't here yet, as one save. Throws, leaving the stored file as it was read, if the save fails. */
  merge(entries: Record<string, string>) {
    try {
      for (const [key, value] of Object.entries(entries)) if (!(key in values())) values()[key] = value;
      save();
    } catch (error) {
      cache = null;
      throw error;
    }
  }
};
