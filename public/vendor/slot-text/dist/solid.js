import { createRenderEffect, onCleanup } from "solid-js";
import { slotText as createSlotText } from "./index.js";
export function slotText(element, accessor) {
    const initial = accessor();
    const controller = createSlotText(element, initial.text);
    let previousText = initial.text;
    let isFirstRun = true;
    createRenderEffect(() => {
        const next = accessor();
        if (isFirstRun) {
            isFirstRun = false;
            return;
        }
        if (next.text !== previousText) {
            previousText = next.text;
            controller.set(next.text, next.options);
        }
    });
    onCleanup(() => {
        controller.destroy();
    });
}
