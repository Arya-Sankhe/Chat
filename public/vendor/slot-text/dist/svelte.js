import { slotText as createSlotText } from "./index.js";
export function slotText(element, params) {
    const controller = createSlotText(element, params.text);
    let previousText = params.text;
    return {
        update(params) {
            if (params.text === previousText)
                return;
            previousText = params.text;
            controller.set(params.text, params.options);
        },
        destroy() {
            controller.destroy();
        },
    };
}
