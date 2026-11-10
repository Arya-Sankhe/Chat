import { TUNING } from "./constants.js";
import { addMissingCharacterSlots, canRenderSlotLayout, getCharacterSlots, isSlotLayoutReady, measureChangedSlots, measureCharacterHeight, prepareSlotAnimation, renderPlainText, renderCharacterSlots, scheduleSlotAnimation, } from "./dom.js";
import { segmentTextIntoGraphemes } from "./text.js";
import { resolveAnimationOptions } from "./timing.js";
const { chromatic: chromaticTuning, lifecycle } = TUNING;
/** Build a color function that sweeps a hue range across the text. */
export function chromatic({ from = chromaticTuning.hueStartDegrees, spread = chromaticTuning.hueSpreadDegrees, saturation = chromaticTuning.saturationPercent, lightness = chromaticTuning.lightnessPercent, } = {}) {
    return (segmentIndex, segmentCount) => {
        const lastSegmentIndex = segmentCount - 1;
        const progress = segmentCount <= 1 ? 0 : segmentIndex / lastSegmentIndex;
        const hueDegrees = (from + progress * spread) % chromaticTuning.fullHueRotationDegrees;
        return `hsl(${hueDegrees} ${saturation}% ${lightness}%)`;
    };
}
const animationStates = new WeakMap();
const initializedContainers = new WeakSet();
function cancelRunningAnimation(container) {
    const animationState = animationStates.get(container);
    if (!animationState)
        return undefined;
    animationState.timerIds.forEach((timerId) => window.clearTimeout(timerId));
    animationStates.delete(container);
    return animationState;
}
/** Render settled text, falling back to plain text until the CSS is ready. */
export function renderTextWithCssFallback(container, text) {
    initializedContainers.add(container);
    if (canRenderSlotLayout())
        renderCharacterSlots(container, text);
    else
        renderPlainText(container, text);
}
function finishRunningAnimationImmediately(container) {
    const animationState = cancelRunningAnimation(container);
    if (animationState) {
        renderTextWithCssFallback(container, animationState.targetText);
    }
}
/** Build slot markup immediately and cancel any animation that owns it. */
export function buildSlotText(container, text) {
    cancelRunningAnimation(container);
    initializedContainers.add(container);
    renderCharacterSlots(container, text);
}
function scheduleAnimationTask(animationState, callback, delayMs) {
    const timerId = window.setTimeout(callback, delayMs);
    animationState.timerIds.push(timerId);
}
export function animateSlotText(container, targetText, options = {}) {
    const resolvedOptions = resolveAnimationOptions(options);
    const runningAnimation = animationStates.get(container);
    if (runningAnimation && !resolvedOptions.interrupt) {
        runningAnimation.pendingAnimation =
            targetText === runningAnimation.targetText
                ? undefined
                : { text: targetText, options };
        return;
    }
    finishRunningAnimationImmediately(container);
    let characterSlots = getCharacterSlots(container);
    if (characterSlots.length === 0) {
        if (!initializedContainers.has(container)) {
            renderTextWithCssFallback(container, targetText);
            return;
        }
        if (!canRenderSlotLayout()) {
            renderPlainText(container, targetText);
            return;
        }
        renderCharacterSlots(container, container.textContent ?? "");
        characterSlots = getCharacterSlots(container);
    }
    const firstCharacterSlot = characterSlots[0];
    if (firstCharacterSlot && !isSlotLayoutReady(firstCharacterSlot)) {
        renderPlainText(container, targetText);
        return;
    }
    const currentSegments = characterSlots.map((slot) => slot.dataset.char ?? "");
    const targetSegments = segmentTextIntoGraphemes(targetText);
    if (!resolvedOptions.interrupt &&
        currentSegments.length === targetSegments.length &&
        currentSegments.every((segment, index) => segment === targetSegments[index])) {
        return;
    }
    const requiredSlotCount = Math.max(currentSegments.length, targetSegments.length);
    addMissingCharacterSlots(container, characterSlots, requiredSlotCount);
    const containerStyle = getComputedStyle(container);
    const characterHeight = measureCharacterHeight(container, characterSlots, containerStyle);
    const restingColor = resolvedOptions.color ? containerStyle.color : "";
    const changedSlotMeasurements = measureChangedSlots(characterSlots, currentSegments, targetSegments, resolvedOptions.skipUnchanged);
    if (changedSlotMeasurements.length === 0) {
        renderCharacterSlots(container, targetText);
        return;
    }
    const animationState = { timerIds: [], targetText };
    animationStates.set(container, animationState);
    const preparedSlotAnimations = changedSlotMeasurements.map((measurement) => prepareSlotAnimation(measurement, targetSegments.length, characterHeight, resolvedOptions));
    // Commit every start style with one layout flush instead of one per glyph.
    void container.offsetWidth;
    preparedSlotAnimations.forEach((preparedSlotAnimation) => scheduleSlotAnimation(preparedSlotAnimation, characterHeight, restingColor, resolvedOptions, (callback, delayMs) => scheduleAnimationTask(animationState, callback, delayMs)));
    const completionDelayMs = Math.max(...preparedSlotAnimations.map(({ completionTimeMs }) => completionTimeMs)) +
        lifecycle.completionBufferMs;
    scheduleAnimationTask(animationState, () => {
        if (animationStates.get(container) !== animationState)
            return;
        const pendingAnimation = animationState.pendingAnimation;
        animationStates.delete(container);
        renderTextWithCssFallback(container, targetText);
        if (pendingAnimation) {
            animateSlotText(container, pendingAnimation.text, pendingAnimation.options);
        }
    }, completionDelayMs);
}
export function clearSlotText(container, text = "") {
    cancelRunningAnimation(container);
    initializedContainers.delete(container);
    renderPlainText(container, text);
}
