// Keep the original artwork; face turns and brief body gestures use separate layers.
const POSES = {
  idle: [[.24, .05], [-.3, .12], [.4, .02]],
  hello: [[.3, .12], [-.22, .08], [.2, .04]],
  curious: [[.55, .2], [-.45, .12], [.3, -.08]],
  thinking: [[.46, .3], [-.34, .22], [.18, .1]],
  reading: [[-.4, -.16], [.08, -.16], [.42, -.2]],
  searching: [[-.6, .08], [.6, .18], [.3, -.16]],
  writing: [[.35, -.24], [-.16, -.18], [.46, -.2]],
  generating: [[.3, .22], [-.32, .16], [.44, .1]],
  reviewing: [[.2, .05], [-.2, -.15], [.3, .08]],
  sleepy: [[.2, -.12], [-.15, -.08]],
};
const ALIASES = { think: "thinking", spark: "generating", happy: "reviewing", wink: "curious" };
const mascots = new Map();
let timer;

export function kluiGazePose(state, index) {
  const poses = POSES[state] || POSES.idle;
  // Return to the user between activities, with distinct straight up/down glances.
  return [[0, 0], poses[0], [0, .32], poses[1], [0, 0], poses[2] || poses[0], [0, -.3]][index % 7];
}

export function projectKluiFace(yaw, pitch, mood = "idle") {
  yaw = Math.max(-.65, Math.min(.65, yaw));
  pitch = Math.max(-.35, Math.min(.35, pitch));
  const x = 14 * Math.cos(pitch) * Math.sin(yaw);
  const y = -14 * Math.sin(pitch) + x * x * .024;
  const d = x / (14 * Math.sin(.65));
  const compression = Math.abs(d);
  const gap = 10 * compression * .35;
  const focused = mood === "reading" || mood === "writing";
  const height = mood === "sleepy" ? .42 : focused ? .76 : mood === "searching" ? 1.1 : 1;
  return {
    face: `translate(${x}px, ${y}px) rotate(${yaw * 28}deg) scaleX(${1 - compression * .08})`,
    left: `translateX(${gap + (focused ? 1 : 0)}px) rotate(${focused ? 7 : -2}deg) scale(${1 - Math.max(0, -d) * .25}, ${height})`,
    right: `translateX(${-gap - (focused ? 1 : 0)}px) rotate(${focused ? -7 : 2}deg) scale(${1 - Math.max(0, d) * .25}, ${height * (mood === "curious" ? 1.12 : 1)})`,
  };
}

function gaze(record, pose, mood, animate) {
  const previous = record.pose || pose;
  // Sample the curved surface during the saccade, including a tiny spring settle.
  const steps = animate ? [0, .7, 1.025, 1] : [1];
  const frames = steps.map((t) => projectKluiFace(
    previous[0] + (pose[0] - previous[0]) * t,
    previous[1] + (pose[1] - previous[1]) * t,
    mood,
  ));
  for (const [key, element] of Object.entries(record.parts)) {
    element.getAnimations().forEach((animation) => animation.cancel());
    element.style.transform = frames.at(-1)[key];
    if (animate) element.animate(frames.map((frame, i) => ({
      transform: frame[key], offset: [0, .55, .82, 1][i],
    })), { duration: 95, easing: "linear" });
  }
  record.pose = pose;
}

function blink(record, wink = false) {
  record.eyes.forEach((eye, i) => {
    if (wink && i % 2 === 0) return;
    eye.getAnimations().forEach((animation) => animation.cancel());
    eye.animate([
      { transform: "scaleY(1)", offset: 0 },
      { transform: "scaleY(.05)", offset: .28 },
      { transform: "scaleY(.05)", offset: .44 },
      { transform: "scaleY(1.06)", offset: .8 },
      { transform: "scaleY(1)", offset: 1 },
    ], { duration: 250, delay: (i % 2) * 18, easing: "linear" });
  });
}

function moveBody(record, state) {
  const playful = state === "hello" || state === "curious" || state === "generating" || state === "idle";
  const direction = Math.random() < .5 ? -1 : 1;
  const tilt = (playful ? 4 : 2.5) * direction;
  // A small rock onto one rounded corner, a counter-wiggle, then a quiet settle.
  record.body.animate([
    { transform: "translateY(0) rotate(0) scale(1)", offset: 0 },
    { transform: `translateY(-.6%) rotate(${tilt}deg) scale(1.015, .985)`, offset: .24 },
    { transform: `translateY(-1%) rotate(${-tilt * .75}deg) scale(.99, 1.015)`, offset: .54 },
    { transform: `translateY(0) rotate(${tilt * .22}deg) scale(1)`, offset: .8 },
    { transform: "translateY(0) rotate(0) scale(1)", offset: 1 },
  ], { duration: playful ? 850 : 700, easing: "cubic-bezier(.22, 1, .36, 1)" });
}

function pausedNow(element, record, reduced) {
  return document.hidden
    || reduced
    || !record.visible
    || !!element.closest(".klui-bar")?.matches(".is-done, .is-leaving");
}

function tick() {
  const now = performance.now();
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  for (const [element, record] of mascots) {
    if (!element.isConnected) {
      record.observer.disconnect();
      mascots.delete(element);
      continue;
    }
    const bar = element.closest(".klui-bar");
    const mood = element.dataset.mood || bar?.dataset.state || "idle";
    const state = ALIASES[mood] || mood;
    const paused = pausedNow(element, record, reduced);
    record.state = state;
    element.dataset.motion = paused ? "paused" : "active";
    if (paused) {
      if (!record.paused || record.mood !== mood) {
        element.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
        gaze(record, [0, 0], state, false);
      }
    } else if (record.paused || record.mood !== mood || now >= record.nextGaze) {
      record.index = record.mood !== mood ? 0 : (record.index + 1) % 7;
      gaze(record, kluiGazePose(state, record.index), state, !record.paused);
      record.nextGaze = now + 1500 + Math.random() * 1500;
      const wink = mood === "wink" && record.mood !== mood;
      if (wink || Math.random() < .3) {
        blink(record, wink);
        record.nextBlink = now + 2200 + Math.random() * 3200;
      }
    }
    if (!paused && now >= record.nextBlink) {
      blink(record);
      record.nextBlink = now + 2400 + Math.random() * 3600;
    }
    if (!paused && now >= record.nextBody) {
      moveBody(record, state);
      record.nextBody = now + 5000 + Math.random() * 5000;
    }
    record.mood = mood;
    record.paused = paused;
  }
  timer = mascots.size ? setTimeout(tick, 180) : null;
}

// Tap reaction: look at the user, crouch, hop, and land with a blink. Ignored
// while the mascot is paused, so reduced motion and completed bars stay still.
export function playKluiReaction(element) {
  const record = element ? mascots.get(element) : null;
  if (!record) return;
  if (pausedNow(element, record, matchMedia("(prefers-reduced-motion: reduce)").matches)) return;

  record.body.getAnimations().forEach((animation) => animation.cancel());
  record.body.animate([
    { transform: "translateY(0) scale(1, 1)", offset: 0 },
    { transform: "translateY(3%) scale(1.07, .9)", offset: .18 },
    { transform: "translateY(-16%) scale(.95, 1.07)", offset: .48 },
    { transform: "translateY(0) scale(1.05, .93)", offset: .76 },
    { transform: "translateY(0) scale(1, 1)", offset: 1 },
  ], { duration: 720, easing: "cubic-bezier(.22, 1, .36, 1)" });
  gaze(record, [0, 0], record.state, true);
  blink(record);

  // Hold the hop: the scheduled gaze/blink/wiggle must not stomp it.
  const now = performance.now();
  record.nextGaze = now + 900;
  record.nextBlink = now + 900;
  record.nextBody = now + 1200;
}

export function mountKluiMotion(element) {
  if (!element || mascots.has(element)) return;
  const parts = {
    face: element.querySelector(".face"),
    left: element.querySelector(".eye-surface-l"),
    right: element.querySelector(".eye-surface-r"),
  };
  const body = element.querySelector(".klui-svg");
  // Partial markup would throw mid-tick and stop the shared timer, freezing
  // every mascot on the page. Only mount mascots carrying all four layers.
  if (!parts.face || !parts.left || !parts.right || !body) return;
  const record = {
    parts,
    body,
    eyes: [...element.querySelectorAll(".eye, .fx-stars path, .fx-happy path")],
    visible: true, index: -1, nextGaze: 0,
    nextBlink: performance.now() + 800 + Math.random() * 2200,
    nextBody: performance.now() + 2200 + Math.random() * 3000,
  };
  record.observer = new IntersectionObserver(([entry]) => { record.visible = entry.isIntersecting; });
  record.observer.observe(element);
  element.addEventListener("click", () => playKluiReaction(element));
  mascots.set(element, record);
  if (!timer) tick();
}
