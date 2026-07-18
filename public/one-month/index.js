(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Floating Mail World — coordinated animation schedule */
  const mailWorld = document.getElementById("mailWorld");
  if (mailWorld) {
    const flightPath = document.getElementById("mailFlightPath");
    const flightDash = document.getElementById("mailFlightDash");
    const plane = document.getElementById("mailPlane");
    const env = document.getElementById("mailEnv");
    const star = document.getElementById("mailStar");
    const heart = document.getElementById("mailHeart");

    const buildFlightCurve = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      // Stay in the upper band; fade before the central card column.
      const x0 = Math.round(w * 1.08);
      const y0 = Math.round(h * 0.22);
      const x1 = Math.round(w * 0.75);
      const y1 = Math.round(h * 0.1);
      const x2 = Math.round(w * 0.52);
      const y2 = Math.round(h * 0.14);
      const x3 = Math.round(w * 0.34);
      const y3 = Math.round(h * 0.19);
      return `M ${x0} ${y0} C ${x1} ${y1}, ${x2} ${y2}, ${x3} ${y3}`;
    };

    const syncFlightGeometry = () => {
      const d = buildFlightCurve();
      if (flightDash) {
        flightDash.setAttribute("d", d);
        const svg = flightDash.ownerSVGElement;
        if (svg) {
          svg.setAttribute("viewBox", `0 0 ${window.innerWidth} ${Math.round(window.innerHeight * 0.42)}`);
        }
        const len = Math.ceil(flightDash.getTotalLength());
        flightPath?.style.setProperty("--flight-len", String(len));
      }
      if (plane) {
        plane.style.setProperty("--plane-path", `path("${d}")`);
      }
    };

    syncFlightGeometry();
    let resizeTimer = 0;
    window.addEventListener("resize", () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(syncFlightGeometry, 120);
    });

    if (!reduceMotion) {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const play = async (el, cls, ms) => {
        if (!el || document.hidden) return;
        el.classList.add(cls);
        await wait(ms);
        el.classList.remove(cls);
      };

      let cancelled = false;

      const runPlane = async () => {
        if (!plane || !flightPath || document.hidden) return;
        syncFlightGeometry();
        flightPath.classList.remove("is-visible", "is-drawing", "is-drawn");
        void flightPath.offsetWidth;
        flightPath.classList.add("is-visible", "is-drawing");
        await wait(900);
        plane.classList.add("is-flying");
        await wait(3200);
        plane.classList.remove("is-flying");
        flightPath.classList.add("is-drawn");
        await wait(600);
        flightPath.classList.remove("is-visible", "is-drawing", "is-drawn");
      };

      const runCycle = async () => {
        await wait(900 + Math.floor(Math.random() * 700));
        while (!cancelled) {
          if (document.hidden) {
            await wait(500);
            continue;
          }

          const jitter = () => 200 + Math.floor(Math.random() * 500);

          await play(star, "is-sparkle", 650);
          await wait(700 + jitter());

          if (!document.hidden) await play(env, "is-open", 1400);
          await wait(500 + jitter());

          if (!document.hidden) await play(heart, "is-pulse", 800);
          await wait(600 + jitter());

          if (!document.hidden) await runPlane();

          await wait(1200 + jitter());
        }
      };

      runCycle();

      window.addEventListener(
        "pagehide",
        () => {
          cancelled = true;
          window.clearTimeout(resizeTimer);
        },
        { once: true }
      );
    }
  }

  /* Hero: reveal immediately + groundbreaking burst on load */
  const heroSection = document.getElementById("hero");
  if (heroSection) {
    heroSection.classList.add("is-in");
    if (reduceMotion) {
      heroSection.classList.add("is-breakthrough");
    } else {
      setTimeout(() => heroSection.classList.add("is-breakthrough"), 350);
    }
  }

  /* Section navigation dot highlighters */
  const sectionIds = ["top", "letter", "messages", "pocket", "research", "docs", "projects", "bits", "thanks"];
  const sections = sectionIds
    .map(id => document.getElementById(id))
    .filter(el => el !== null);
  const dots = [...document.querySelectorAll(".nav-dots a")];

  const setActiveDot = () => {
    let current = sections[0]?.id;
    for (const s of sections) {
      if (s.getBoundingClientRect().top <= window.innerHeight * 0.4) {
        current = s.id;
      }
    }
    dots.forEach(d => {
      d.classList.toggle("is-active", d.getAttribute("href") === `#${current}`);
    });
    if (current) document.body.dataset.scene = current === "top" ? "hero" : current;
  };
  window.addEventListener("scroll", setActiveDot, { passive: true });
  setActiveDot();
  document.body.dataset.scene = document.body.dataset.scene || "hero";

  /* Intersection Observer for reveal animations */
  const reveals = document.querySelectorAll(".reveal");
  if (reduceMotion) {
    reveals.forEach(el => el.classList.add("is-in"));
  } else if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
    );
    reveals.forEach(el => io.observe(el));
  } else {
    reveals.forEach(el => el.classList.add("is-in"));
  }

  /* Count Up animation for the message stat */
  const counter = document.getElementById("msgCount");
  const target = counter ? parseInt(counter.getAttribute("data-target"), 10) || 2000 : 2000;
  let counted = false;

  const animateCount = () => {
    if (counted || !counter) return;
    counted = true;
    if (reduceMotion) {
      counter.textContent = "2,000+";
      return;
    }
    const duration = 1500;
    const start = performance.now();
    
    const tick = (now) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / duration);
      // Cubic ease-out
      const eased = 1 - Math.pow(1 - t, 3);
      const value = Math.floor(eased * target);
      counter.textContent = value.toLocaleString("en-US") + (t === 1 ? "+" : "");
      
      if (t < 1) {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  };

  if (counter && "IntersectionObserver" in window) {
    const msgIo = new IntersectionObserver(
      (entries) => {
        if (entries.some(e => e.isIntersecting)) {
          animateCount();
          msgIo.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    const messagesSection = document.getElementById("messages");
    if (messagesSection) {
      msgIo.observe(messagesSection);
    }
  } else {
    animateCount();
  }

  /* Duolingo Colored Confetti Canvas Engine */
  const canvas = document.getElementById("confetti");
  const ctx = canvas ? canvas.getContext("2d") : null;
  let pieces = [];
  let raf = null;

  const resizeCanvas = () => {
    if (canvas) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
  };
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  // Duolingo Palette: green, blue, orange, red, yellow, light-green
  const confettiColors = ["#58cc02", "#1cb0f6", "#ff9600", "#ff4b4b", "#ffc800", "#a5f363"];

  function burstConfetti() {
    if (reduceMotion || !canvas || !ctx) return;
    const count = Math.min(100, Math.floor(window.innerWidth / 8));
    for (let i = 0; i < count; i++) {
      pieces.push({
        x: window.innerWidth * 0.5 + (Math.random() - 0.5) * 250,
        y: window.innerHeight * 0.4,
        vx: (Math.random() - 0.5) * 12,
        vy: Math.random() * -12 - 5,
        g: 0.2 + Math.random() * 0.08,
        w: 8 + Math.random() * 8,
        h: 10 + Math.random() * 10,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        color: confettiColors[i % confettiColors.length],
        life: 1
      });
    }
    if (!raf) {
      raf = requestAnimationFrame(drawConfetti);
    }
  }

  function drawConfetti() {
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces = pieces.filter(p => p.life > 0.02);
    
    for (const p of pieces) {
      p.vy += p.g;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.life *= 0.985;
      
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    
    if (pieces.length) {
      raf = requestAnimationFrame(drawConfetti);
    } else {
      raf = null;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  const celebrateBtn = document.getElementById("celebrateBtn");
  if (celebrateBtn) {
    celebrateBtn.addEventListener("click", () => {
      burstConfetti();
    });
  }

  /* Envelope fly-in reverse animation:
   * Paper airplane arcs from top-left -> envelope spot -> morphs to envelope -> opens -> note -> confetti */
  const letterSection = document.getElementById("letter");
  const envelope = document.getElementById("envelope");
  const envelopeWrapper = document.getElementById("envelopeWrapper");
  const paperAirplane = document.getElementById("paperAirplane");
  const FLIGHT_MS = reduceMotion ? 0 : 3200;

  if (letterSection && envelopeWrapper && envelope && paperAirplane && "IntersectionObserver" in window) {
    const letterIo = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const rect = envelope.getBoundingClientRect();
          const planeW = 220;
          const planeH = 165;
          const endX = rect.left + rect.width / 2 - planeW / 2;
          const endY = rect.top + rect.height / 2 - planeH / 2;

          // Top-left entry → high rightward swoop → soft approach into the note
          const startX = -180;
          const startY = Math.max(-40, endY * 0.15 - 80);
          const mid1X = Math.min(window.innerWidth * 0.42, endX + 120);
          const mid1Y = Math.max(36, Math.min(endY - 180, window.innerHeight * 0.18));
          const mid2X = endX - 28;
          const mid2Y = endY - 72;

          const set = (k, v) => paperAirplane.style.setProperty(k, v);
          set("--start-x", `${startX}px`);
          set("--start-y", `${startY}px`);
          set("--start-rot", "16deg");
          set("--mid1-x", `${mid1X}px`);
          set("--mid1-y", `${mid1Y}px`);
          set("--mid1-rot", "-4deg");
          set("--mid2-x", `${mid2X}px`);
          set("--mid2-y", `${mid2Y}px`);
          set("--mid2-rot", "-14deg");
          set("--target-x", `${endX}px`);
          set("--target-y", `${endY}px`);
          set("--end-rot", "-10deg");

          // Stage 1: arc flight
          requestAnimationFrame(() => {
            paperAirplane.classList.add("airplane-arrive");
          });

          // Stage 2: fade airplane → closed envelope (tight handoff, no confetti)
          setTimeout(() => {
            paperAirplane.classList.add("airplane-done");
            envelopeWrapper.classList.add("is-envelope");

            // Stage 3: open flap
            setTimeout(() => {
              envelopeWrapper.classList.add("is-open");

              // Stage 4: note slides out
              setTimeout(() => {
                envelopeWrapper.classList.add("reveal-note");

                // Stage 5: envelope drops, note settles, then confetti
                setTimeout(() => {
                  envelopeWrapper.classList.add("settled");
                  burstConfetti();
                }, 650);

              }, 450);

            }, 400);

          }, FLIGHT_MS);

          letterIo.disconnect();
        }
      });
    }, { threshold: 0.2 });
    letterIo.observe(letterSection);
  }

  /* Pocket: Klui drops on Android pill → rolls to phone → wink → app icon (loops) */
  const pocketSection = document.getElementById("pocket");
  const pocketActor = document.getElementById("pocketActor");
  const androidTag = document.getElementById("androidTag");
  const pocketAppSlot = document.getElementById("pocketAppSlot");
  const LOOP_GAP = 0;

  function centerOf(el, relativeTo) {
    const a = el.getBoundingClientRect();
    const b = relativeTo.getBoundingClientRect();
    return {
      x: a.left - b.left + a.width / 2,
      y: a.top - b.top + a.height / 2,
      w: a.width,
      h: a.height
    };
  }

  function playPocketSequence() {
    if (!pocketSection || !pocketActor || !androidTag || !pocketAppSlot) return;

    const actorSize = 72;
    const iconSize = 44;
    const duration = 4200;

    // Reset actor between loops
    pocketActor.getAnimations().forEach((a) => a.cancel());
    pocketActor.classList.remove("is-winking");
    pocketSection.classList.remove("is-settled");
    androidTag.classList.remove("is-hit");

    if (reduceMotion) {
      const slot = centerOf(pocketAppSlot, pocketSection);
      pocketActor.style.opacity = "1";
      pocketActor.style.width = `${iconSize}px`;
      pocketActor.style.height = `${iconSize}px`;
      pocketActor.style.transform = `translate(${slot.x - iconSize / 2}px, ${slot.y - iconSize / 2}px)`;
      pocketActor.classList.add("is-winking");
      pocketSection.classList.add("is-settled");
      return;
    }

    const tag = centerOf(androidTag, pocketSection);
    const slot = centerOf(pocketAppSlot, pocketSection);
    const phoneBeside = {
      x: slot.x - 78,
      y: slot.y + 18
    };

    const start = { x: tag.x, y: -90 };
    const onTag = { x: tag.x, y: tag.y - 6 };
    const toXY = (pt, size, rot = 0, scale = 1) =>
      `translate(${pt.x - size / 2}px, ${pt.y - size / 2}px) rotate(${rot}deg) scale(${scale})`;
    const iconScale = iconSize / actorSize;

    pocketActor.style.width = `${actorSize}px`;
    pocketActor.style.height = `${actorSize}px`;
    pocketActor.style.opacity = "1";
    pocketActor.style.transform = toXY(start, actorSize, -8, 0.9);

    const anim = pocketActor.animate(
      [
        { transform: toXY(start, actorSize, -12, 0.85), offset: 0 },
        { transform: toXY(onTag, actorSize, 8, 1.05), offset: 0.18 },
        { transform: toXY(onTag, actorSize, -4, 0.92), offset: 0.24 },
        { transform: toXY(onTag, actorSize, 0, 1), offset: 0.3 },
        { transform: toXY({ x: (onTag.x + phoneBeside.x) / 2, y: onTag.y - 28 }, actorSize, 120, 1), offset: 0.48 },
        { transform: toXY(phoneBeside, actorSize, 340, 1), offset: 0.62 },
        { transform: toXY(phoneBeside, actorSize, 360, 1), offset: 0.7 },
        { transform: toXY(phoneBeside, actorSize, 360, 1), offset: 0.78 },
        { transform: toXY({ x: (phoneBeside.x + slot.x) / 2, y: (phoneBeside.y + slot.y) / 2 - 10 }, actorSize, 370, 0.75), offset: 0.88 },
        { transform: toXY(slot, actorSize, 360, iconScale), offset: 1 }
      ],
      {
        duration,
        easing: "cubic-bezier(0.45, 0.05, 0.25, 1)",
        fill: "forwards"
      }
    );

    setTimeout(() => {
      androidTag.classList.add("is-hit");
      setTimeout(() => androidTag.classList.remove("is-hit"), 420);
    }, 750);

    setTimeout(() => {
      pocketActor.classList.add("is-winking");
    }, 2950);

    anim.finished.then(() => {
      anim.cancel();
      pocketActor.style.width = `${iconSize}px`;
      pocketActor.style.height = `${iconSize}px`;
      pocketActor.style.transform = `translate(${slot.x - iconSize / 2}px, ${slot.y - iconSize / 2}px)`;
      pocketSection.classList.add("is-settled");
      // Pause, then replay
      setTimeout(playPocketSequence, LOOP_GAP);
    }).catch(() => {});
  }

  if (pocketSection && "IntersectionObserver" in window) {
    const pocketIo = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setTimeout(playPocketSequence, reduceMotion ? 0 : 280);
          pocketIo.disconnect();
        }
      });
    }, { threshold: 0.35 });
    pocketIo.observe(pocketSection);
  }

  /* CSS scene loops: research / docs / projects — replay after finish + 2s */
  function startCssAnimLoop(section, durationMs) {
    if (!section) return;
    if (reduceMotion) {
      section.classList.add("is-anim");
      return;
    }
    const run = () => {
      section.classList.remove("is-anim");
      void section.offsetWidth;
      section.classList.add("is-anim");
      setTimeout(run, durationMs + LOOP_GAP);
    };
    run();
  }

  function observeAndLoop(id, durationMs) {
    const el = document.getElementById(id);
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setTimeout(() => startCssAnimLoop(el, durationMs), reduceMotion ? 0 : 280);
          io.disconnect();
        }
      });
    }, { threshold: 0.3 });
    io.observe(el);
  }

  observeAndLoop("research", 5200);
  observeAndLoop("docs", 5000);
  observeAndLoop("projects", 3200);

  /* Thanks: Klui blows hearts into the title — loops while section is in view */
  const thanksSection = document.getElementById("thanks");
  const thanksArt = document.getElementById("thanksArt");
  const thanksHearts = document.getElementById("thanksHearts");
  let thanksInView = false;
  let thanksLoopRunning = false;

  function blowHeartToTitle(index) {
    if (!thanksArt || !thanksHearts || !thanksSection) return Promise.resolve();

    return new Promise((resolve) => {
      thanksArt.classList.add("is-blowing");

      const from = thanksArt.getBoundingClientRect();
      const to = thanksHearts.getBoundingClientRect();
      const heart = document.createElement("div");
      heart.className = "flying-heart";
      heart.innerHTML = '<span class="flying-heart__beat" aria-hidden="true">♥</span>';
      document.body.appendChild(heart);

      const startX = from.left + from.width * 0.62;
      const startY = from.top + from.height * 0.48;
      const endX = to.left + Math.max(to.width, 4) + 4 + index * 2;
      const endY = to.top + to.height * 0.15;

      heart.style.left = `${startX}px`;
      heart.style.top = `${startY}px`;

      const anim = heart.animate(
        [
          { transform: "translate(-50%, -50%) scale(0.4)", opacity: 0 },
          { transform: "translate(-50%, -50%) scale(1.15)", opacity: 1, offset: 0.15 },
          {
            transform: `translate(calc(-50% + ${(endX - startX) * 0.55}px), calc(-50% + ${(endY - startY) * 0.35 - 36}px)) scale(1)`,
            opacity: 1,
            offset: 0.55
          },
          {
            transform: `translate(calc(-50% + ${endX - startX}px), calc(-50% + ${endY - startY}px)) scale(0.85)`,
            opacity: 1
          }
        ],
        { duration: 900, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" }
      );

      setTimeout(() => thanksArt.classList.remove("is-blowing"), 420);

      const landHeart = () => {
        heart.remove();
        const landed = document.createElement("span");
        landed.className = "title-heart is-beating";
        landed.setAttribute("aria-hidden", "true");
        landed.textContent = "♥";
        thanksHearts.appendChild(landed);
        resolve();
      };

      anim.finished.then(landHeart).catch(landHeart);
    });
  }

  async function playThanksHeartsLoop() {
    if (!thanksSection || thanksLoopRunning) return;
    thanksLoopRunning = true;

    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    while (thanksInView) {
      if (thanksHearts) thanksHearts.replaceChildren();

      if (reduceMotion) {
        if (thanksHearts) {
          for (let i = 0; i < 3; i++) {
            const landed = document.createElement("span");
            landed.className = "title-heart";
            landed.setAttribute("aria-hidden", "true");
            landed.textContent = "♥";
            thanksHearts.appendChild(landed);
          }
        }
        await wait(4000);
        continue;
      }

      for (let i = 0; i < 3; i++) {
        if (!thanksInView) break;
        await blowHeartToTitle(i);
        if (i < 2) await wait(700);
      }

      // Hold the three beating hearts, then clear and replay
      await wait(4800);
    }

    thanksLoopRunning = false;
  }

  if (thanksSection && "IntersectionObserver" in window) {
    const thanksIo = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        thanksInView = entry.isIntersecting;
        if (entry.isIntersecting) {
          setTimeout(playThanksHeartsLoop, reduceMotion ? 0 : 400);
        }
      });
    }, { threshold: 0.35 });
    thanksIo.observe(thanksSection);
  }
})();
