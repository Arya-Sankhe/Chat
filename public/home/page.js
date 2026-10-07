// Below the hero: sections ease in as they scroll into view, and the Dojo recording clock ticks
// while it's on screen. The Compare & Council card flips between its two modes. Without this
// script everything is simply shown as is.
(() => {
  "use strict";

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const items = document.querySelectorAll("[data-reveal]");
  if (!reduced && "IntersectionObserver" in window) {
    document.documentElement.classList.add("reveal-ready");
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("is-in");
        io.unobserve(e.target);
      }
    }, { rootMargin: "0px 0px -12% 0px" });
    items.forEach((el) => io.observe(el));
  }

  // Compare & Council card: flip between four side-by-side answers and one merged answer while visible.
  const council = document.querySelector("[data-council]");
  if (council && !reduced && "IntersectionObserver" in window) {
    let flip = 0;
    new IntersectionObserver((entries) => {
      clearInterval(flip);
      if (!entries[0].isIntersecting) return;
      council.classList.remove("is-council");
      flip = setInterval(() => council.classList.toggle("is-council"), 3200);
    }).observe(council);
  }

  const clock = document.querySelector("[data-rec]");
  if (!clock || reduced) return;
  let secs = 1 * 3600 + 12 * 60 + 48, timer = 0;
  const pad = (n) => String(n).padStart(2, "0");
  const tick = () => {
    secs += 1;
    clock.textContent = `${pad(Math.floor(secs / 3600))}:${pad(Math.floor(secs / 60) % 60)}:${pad(secs % 60)}`;
  };
  new IntersectionObserver((entries) => {
    clearInterval(timer);
    if (entries[0].isIntersecting) timer = setInterval(tick, 1000);
  }).observe(clock);
})();

// The demo video dialog. The suitcase in the hero opens it; Escape, the close button or a click
// outside the frame shuts it, and the player is unloaded so the video stops.
(() => {
  "use strict";

  const dialog = document.getElementById("demo");
  const open = document.querySelector(".hero-bag");
  if (!dialog || !open || typeof dialog.showModal !== "function") return;
  const frame = dialog.querySelector("iframe");

  open.addEventListener("click", () => {
    frame.src = frame.dataset.src;
    dialog.showModal();
  });
  dialog.querySelector(".demo-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => {
    frame.removeAttribute("src");
    open.focus({ preventScroll: true });
  });
})();
