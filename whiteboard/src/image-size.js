// Starting dimensions in scene units; small images retain their natural size.
export function fitImageSize(width, height, state) {
  const zoom = state.zoom.value;
  const scale = Math.min(1, Math.min(320, state.width * .4) / (width * zoom), Math.min(240, state.height * .4) / (height * zoom));
  return { width: width * scale, height: height * scale };
}
