// A pixel-art Klui standing on the chat composer. After a reply finishes it pops out of a portal,
// turns sideways to a mini laptop, types for a moment, puts it away and turns back to the user,
// blinking now and then. When the user sends a message it drops into a portal, and the thinking
// bar's own Klui falls out of another portal above the new reply.

const COLORS = {
  body: "#8fd3fb",
  eye: "#16202e",
  lid: "#56637f",
  base: "#434e66",
  screen: "#bfe6ff"
};
const TYPING_MS = 2400;

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Hidden tabs may not run animations; never wait on one forever.
const played = (animation, ms) => Promise.race([animation.finished.catch(() => {}), wait(ms + 250)]);
const px = (x, y, w, h, fill, extra = "") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${extra}/>`;

// Just the eyes. Looking sideways, they move left and sit a little closer together.
function faceMarkup(side) {
  const c = COLORS;
  const [left, right] = side ? [4, 7] : [5, 10];
  return `
    <g class="kp-face kp-face-${side ? "side" : "front"}">
      <g class="kp-eyes-open">${px(left, 5, 1, 1.5, c.eye)}${px(right, 5, 1, 1.5, c.eye)}</g>
      <g class="kp-eyes-shut">${px(left - 0.25, 6, 1.5, 0.5, c.eye)}${px(right - 0.25, 6, 1.5, 0.5, c.eye)}</g>
    </g>`;
}

// One unit is one block, in the flat style of Claude's crab: a plain body, block arms and two
// block legs, with no shading. The body spans x 3–13 and the feet end at y 12; the laptop sits to
// its left (x -6–2) and only shows while Klui is using it.
function spriteMarkup() {
  const c = COLORS;
  return `<svg class="kp-svg" viewBox="-7 0 23 12" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <g class="kp-laptop">
      ${px(-6, 11, 8, 1, c.base)}
      <g class="kp-lid-shut">${px(-6, 10, 8, 1, c.lid)}</g>
      <g class="kp-lid-open">${px(-6, 4, 1, 7, c.lid)}<rect class="kp-screen" x="-5" y="5" width="1" height="5" fill="${c.screen}"/></g>
      <g class="kp-keys" fill="${c.screen}">${px(-3, 8, 1, 1, "inherit")}${px(-1, 8, 1, 1, "inherit")}</g>
    </g>
    <g class="kp-turner" fill="${c.body}">
      <g class="kp-legs">${px(5, 9.5, 1, 2.5, "inherit")}${px(10, 9.5, 1, 2.5, "inherit")}</g>
      ${px(3, 3.5, 10, 6, "inherit")}
      ${faceMarkup(false)}
      ${faceMarkup(true)}
      <g class="kp-arms-front">${px(1, 5.5, 2, 2, "inherit")}${px(13, 5.5, 2, 2, "inherit")}</g>
      <g class="kp-arm-side">${px(1, 7.5, 2, 1, "inherit")}${px(0, 8.5, 1, 1, "inherit")}</g>
    </g>
  </svg>`;
}

// A flat portal, opened and closed with data-open.
function makePortal(className) {
  const portal = document.createElement("span");
  portal.className = `kp-portal ${className}`;
  portal.setAttribute("aria-hidden", "true");
  return portal;
}

/**
 * `host` is the composer. `findTarget()` returns the active thinking bar's mascot, if it is on
 * screen yet. Call sync() whenever messages or the running state change.
 */
export function createComposerKlui({ host, findTarget }) {
  const root = document.createElement("div");
  root.className = "composer-klui";
  root.setAttribute("aria-hidden", "true");
  const back = makePortal("is-back");
  const front = makePortal("is-front");
  const stage = document.createElement("div");
  stage.className = "kp-stage";
  stage.innerHTML = spriteMarkup();
  root.append(back, stage, front);
  host.prepend(root);
  const sprite = stage.firstElementChild;

  let shown = false;
  let lastRunning = false;
  let lastKey = null;
  let run = 0; // bumps whenever a new sequence starts, so an old one stops where it is
  let blinkTimer = 0;
  let teleporting = false;

  function set(attrs) {
    for (const [key, value] of Object.entries(attrs)) root.dataset[key] = value;
  }
  set({ shown: "false", facing: "front", laptop: "none", typing: "false", blink: "false", portal: "closed" });

  function blinkSoon() {
    clearTimeout(blinkTimer);
    if (!shown || reducedMotion()) return;
    blinkTimer = setTimeout(async () => {
      const token = run;
      const times = Math.random() < 0.2 ? 2 : 1;
      for (let i = 0; i < times && token === run; i += 1) {
        set({ blink: "true" });
        await wait(110);
        set({ blink: "false" });
        await wait(150);
      }
      if (token === run) blinkSoon();
    }, 2200 + Math.random() * 3800);
  }

  function hide() {
    run += 1;
    shown = false;
    clearTimeout(blinkTimer);
    root.classList.remove("is-turning");
    set({ shown: "false", facing: "front", laptop: "none", typing: "false", blink: "false", portal: "closed" });
    for (const animation of sprite.getAnimations()) animation.cancel();
  }

  async function arrive({ laptop }) {
    const token = ++run;
    const still = async (ms) => { await wait(ms); return token === run; };
    // A reply that ends mid-teleport skips its hide(), so drop the held sink here or Klui stays
    // below the edge.
    for (const animation of sprite.getAnimations()) animation.cancel();
    shown = true;
    set({ shown: "true", facing: "front", laptop: "none", typing: "false" });
    blinkSoon();
    if (reducedMotion()) return;
    // Pop up out of a portal at its feet.
    set({ portal: "open" });
    if (!await still(70)) return;
    const rise = sprite.animate([
      { transform: "translateY(105%)" },
      { transform: "translateY(-16%)", offset: 0.7 },
      { transform: "none" }
    ], { duration: 230, easing: "cubic-bezier(.2, .8, .3, 1)" });
    if (!await still(150)) return;
    set({ portal: "closed" });
    await played(rise, 80);
    if (!laptop || !await still(260)) return;

    const turn = async (facing) => {
      root.classList.add("is-turning");
      if (!await still(70)) return false;
      set({ facing });
      root.classList.remove("is-turning");
      return still(80);
    };
    if (!await turn("side")) return;
    set({ laptop: "shut" });
    if (!await still(170)) return;
    set({ laptop: "open" });
    if (!await still(200)) return;
    set({ typing: "true" });
    if (!await still(TYPING_MS)) return;
    set({ typing: "false", laptop: "shut" });
    if (!await still(200)) return;
    set({ laptop: "none" });
    if (!await still(160)) return;
    await turn("front");
  }

  // The thinking bar's mascot falls out of a portal just above it and lands with a squash.
  async function dropInto(target) {
    const rect = target.getBoundingClientRect();
    const portal = makePortal("is-drop");
    portal.style.left = `${rect.left + rect.width / 2}px`;
    portal.style.top = `${rect.top - 3}px`;
    portal.style.setProperty("--kp-portal-w", `${Math.round(rect.width * 1.3)}px`);
    document.body.append(portal);
    void portal.offsetWidth;
    portal.dataset.open = "true";
    try {
      await wait(80);
      document.body.classList.remove("klui-portal-pending");
      // Clip the mascot at the portal line as it falls, so it seems to come out of it.
      const fall = rect.height + 3;
      const drop = target.animate([
        { transform: `translateY(${-fall}px)`, clipPath: `inset(${fall - 3}px -40px -40px -40px)` },
        { transform: "translateY(0)", clipPath: "inset(-3px -40px -40px -40px)", offset: 0.75, easing: "cubic-bezier(.3, .6, .6, 1)" },
        { transform: "scale(1.14, .86)", clipPath: "inset(-3px -40px -40px -40px)", offset: 0.88 },
        { transform: "none", clipPath: "inset(-3px -40px -40px -40px)" }
      ], { duration: 260, easing: "cubic-bezier(.5, 0, .9, .5)" });
      await wait(170);
      portal.dataset.open = "false";
      await played(drop, 90);
    } finally {
      document.body.classList.remove("klui-portal-pending");
      setTimeout(() => portal.remove(), 150);
    }
  }

  async function teleport() {
    const token = run;
    teleporting = true;
    document.body.classList.add("klui-portal-pending");
    try {
      // The thinking bar shows up with the reply's first status, which can take a few seconds.
      // Keep looking while the reply runs; its mascot stays hidden until it drops in.
      const found = (async () => {
        const started = Date.now();
        while (lastRunning && Date.now() - started < 30_000) {
          const target = findTarget();
          if (target) return target;
          await wait(40);
        }
        return null;
      })();
      set({ portal: "open" });
      await wait(60);
      if (token === run) {
        const sink = sprite.animate([{ transform: "none" }, { transform: "translateY(105%)" }], { duration: 150, easing: "cubic-bezier(.5, 0, .9, .4)", fill: "forwards" });
        await played(sink, 150);
      }
      if (token === run) hide();
      const target = await found;
      if (target?.isConnected) await dropInto(target);
    } catch {
      // An interrupted teleport just leaves the thinking bar's own mascot showing.
    } finally {
      teleporting = false;
      document.body.classList.remove("klui-portal-pending");
    }
  }

  return {
    root,
    /**
     * show: the chat has messages and the composer is on screen. running: a reply is being
     * written. key: the open conversation ("" for one not saved yet).
     */
    sync({ show, running, key = "" }) {
      const sameChat = lastKey === key || lastKey === "";
      const wasRunning = lastRunning;
      lastRunning = running;
      lastKey = key;
      if (!show) {
        if (shown) hide();
        return;
      }
      if (running) {
        if (!wasRunning && shown && sameChat && !reducedMotion()) void teleport();
        else if (shown && !teleporting) hide();
        return;
      }
      if (wasRunning && sameChat) void arrive({ laptop: true });
      else if (!shown) void arrive({ laptop: false });
    }
  };
}
