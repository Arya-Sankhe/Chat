// Starting dimensions in scene units; small images retain their natural size.
export function fitImageSize(width, height, state) {
  const zoom = state.zoom.value;
  const scale = Math.min(1, Math.min(320, state.width * .4) / (width * zoom), Math.min(240, state.height * .4) / (height * zoom));
  return { width: width * scale, height: height * scale };
}

// New images keep up to 2560 px on their longest side, so screenshots stay sharp when zoomed in
// (Excalidraw's own limit is 1440). A lossless image that would still be too heavy steps down.
export const IMAGE_SIDES = [2560, 1920, 1440];
export const IMAGE_TARGET_BYTES = 3 * 1024 * 1024;

/** `file` resized for a board with Excalidraw's `resize(file, { maxWidthOrHeight })`. */
export async function resizeForBoard(file, resize) {
  let out = file;
  for (const side of IMAGE_SIDES) {
    out = await resize(file, { maxWidthOrHeight: side });
    if (out.size <= IMAGE_TARGET_BYTES) break;
  }
  return out;
}
