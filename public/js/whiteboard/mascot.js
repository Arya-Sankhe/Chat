// The whiteboard's pixel Klui: the composer sprite's body with its arms drawn separately so the
// right one can wave while Klui works on an answer. States (data-state on the wrapper):
// working (waves), ready (a speech bubble pops up), seen (sits quietly), error.
const C = { body: "#8fd3fb", eye: "#16202e" };
const px = (x, y, w, h, fill) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;

export function boardKluiMarkup() {
  return `<svg class="wb-klui-svg" viewBox="0 1 16 11" shape-rendering="crispEdges" aria-hidden="true">
    <g class="wb-klui-body">
      ${px(3, 3.5, 10, 6, C.body)}
      ${px(5, 9.5, 1, 2.5, C.body)}${px(10, 9.5, 1, 2.5, C.body)}
      <g class="wb-klui-eyes">${px(5, 5, 1, 1.5, C.eye)}${px(10, 5, 1, 1.5, C.eye)}</g>
      ${px(1, 5.5, 2, 2, C.body)}
      <g class="wb-klui-arm">${px(13, 4.5, 2, 2, C.body)}${px(14, 2.5, 1, 2, C.body)}</g>
    </g>
  </svg>`;
}

/** A mascot button with its bubble. `label` is the accessible name. */
export function mascotMarkup({ id, state = "working", label = "Klui" }) {
  return `<button class="wb-klui" type="button" data-wb-thread="${id}" data-state="${state}" aria-label="${label}">
    <span class="wb-klui-bubble" aria-hidden="true">${state === "error" ? "!" : "…"}</span>
    ${boardKluiMarkup()}
  </button>`;
}
