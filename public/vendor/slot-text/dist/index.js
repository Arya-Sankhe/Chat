export { animateSlotText, buildSlotText, chromatic, clearSlotText, } from "./slotText.js";
import { TUNING } from "./constants.js";
import { animateSlotText, clearSlotText, renderTextWithCssFallback, } from "./slotText.js";
/**
 * Create a text-roll controller for one element.
 *
 * Import `slot-text/style.css` once in your app, then call:
 *
 *   const label = slotText(buttonLabel, "Copy");
 *   label.set("Copied", { direction: "up" });
 *   label.flash("Copied", { revertAfter: 1400 }); // auto-reverts to "Copy"
 */
export function slotText(element, initialText, defaultOptions = {}) {
    let currentValue = initialText;
    let revertTimerId;
    let restingText;
    renderTextWithCssFallback(element, initialText);
    const animateWithoutInterrupt = (text, overrides) => animateSlotText(element, text, {
        ...defaultOptions,
        interrupt: false,
        ...overrides,
    });
    return {
        element,
        get value() {
            return currentValue;
        },
        set(text, optionOverrides = {}) {
            // An explicit set wins over a pending flash revert.
            clearTimeout(revertTimerId);
            restingText = undefined;
            currentValue = text;
            animateSlotText(element, text, {
                ...defaultOptions,
                ...optionOverrides,
            });
        },
        flash(text, { revertAfter = TUNING.lifecycle.flashRevertDelayMs, enter: enterOptions, exit: exitOptions, } = {}) {
            // Capture the resting text only on the first flash of a burst, so a
            // flash-during-flash still reverts to the original label.
            if (restingText === undefined) {
                restingText = currentValue;
            }
            // Flashes default to non-interrupting rolls: spam-friendly, no mid-roll
            // cutoffs. Callers can still override via `enter`/`exit`.
            currentValue = text;
            animateWithoutInterrupt(text, enterOptions);
            // Restart the revert timer: one revert per burst, after the last flash.
            clearTimeout(revertTimerId);
            revertTimerId = window.setTimeout(() => {
                const originalText = restingText;
                restingText = undefined;
                revertTimerId = undefined;
                currentValue = originalText;
                animateWithoutInterrupt(originalText, exitOptions);
            }, revertAfter);
        },
        destroy() {
            clearTimeout(revertTimerId);
            clearSlotText(element, currentValue);
        },
    };
}
