/* The modal voice picker: the first-run chooser (`first: true`) and the in-call
   voice switcher. shell/VoicePicker.tsx renders it; openVoicePicker() resolves
   when it closes, with the choice when confirmed and null when dismissed. */
import { create } from "zustand";

export type VoiceChoice = { voice: string; speed: number };

export type VoicePickerRequest = {
  id: number;
  voice: string;
  speed: number;
  engine?: string;
  first: boolean;
  reducedMotion: boolean;
  onSave?: (choice: VoiceChoice) => void;
  onError?: (message: string) => void;
  /** Set once closed; the dialog fades out before it is removed. */
  closing: boolean;
};

export const useVoicePicker = create<{ dialog: VoicePickerRequest | null }>(() => ({ dialog: null }));

const CLOSE_MS = 240;
let nextId = 0;
const resolvers = new Map<number, (choice: VoiceChoice | null) => void>();

export function openVoicePicker({
  voice,
  speed,
  engine,
  first = false,
  onSave,
  onError,
  reducedMotion = false
}: Omit<VoicePickerRequest, "id" | "closing" | "first" | "reducedMotion"> & { first?: boolean; reducedMotion?: boolean }) {
  const open = useVoicePicker.getState().dialog;
  if (open && !open.closing) finishVoicePicker(open.id, null);
  const id = ++nextId;
  return new Promise<VoiceChoice | null>((resolve) => {
    resolvers.set(id, resolve);
    useVoicePicker.setState({ dialog: { id, voice, speed, engine, first, reducedMotion, onSave, onError, closing: false } });
  });
}

/** Closes the dialog `id`: `choice` saves it, null dismisses it. */
export function finishVoicePicker(id: number, choice: VoiceChoice | null) {
  const dialog = useVoicePicker.getState().dialog;
  const resolve = resolvers.get(id);
  if (!dialog || dialog.id !== id || dialog.closing || !resolve) return;
  resolvers.delete(id);
  useVoicePicker.setState({ dialog: { ...dialog, closing: true } });
  setTimeout(() => {
    if (useVoicePicker.getState().dialog?.id === id) useVoicePicker.setState({ dialog: null });
  }, CLOSE_MS);
  if (choice) dialog.onSave?.(choice);
  resolve(choice);
}
