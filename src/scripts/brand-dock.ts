import { clamp01, getScroll, smoothstep } from "./scroll-helpers";
import { ensureScrollFlight } from "./scroll-flight";

type Pt = { x: number; y: number; w: number; fs: number };

export function initBrandDock() {
  const fly = document.querySelector<HTMLElement>("[data-brand-fly]");
  const spacer = document.querySelector<HTMLElement>("[data-brand-spacer]");
  const slot = document.querySelector<HTMLElement>("[data-nav-brand-slot]");
  // Optional. It exists for the floating glass pill, which had to materialise
  // as the wordmark arrived or it read as two unrelated things moving. A full
  // header bar is visible from the top of the page instead, so it has nothing
  // to fade in — the dock still runs, it just has no pill to reveal.
  const glass = document.querySelector<HTMLElement>("[data-glass-nav]");
  if (!fly || !spacer || !slot) return;

  const prev = (fly as unknown as { __morphAbort?: AbortController }).__morphAbort;
  prev?.abort();
  const ac = new AbortController();
  (fly as unknown as { __morphAbort?: AbortController }).__morphAbort = ac;
  const { signal } = ac;
  const flight = ensureScrollFlight();
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let from: Pt | null = null;
  let dockFs = 15;
  let dockX = 0;
  let dockY = 0;
  let dockW = 48;
  let ready = false;
  let running = true;
  let latch = 0;
  let lastInteractive: boolean | null = null;
  // font-size is constant for the whole flight (only the transform scales the
  // wordmark down), so writing it every frame just forces a needless style
  // recalc — a real source of mobile jank. Track it and only write on change.
  let lastFs = -1;

  /**
   * Measure the hero wordmark's UNTRANSFORMED layout box.
   *
   * getBoundingClientRect() includes transforms, and the spacer starts life at
   * `transform: translateY(0.4em) scale(1.55)` for its entrance (Hero.astro).
   * If the capture races that animation it reads a 680px-wide box starting at
   * x=300 instead of the real 439px box at x=421 — and the flyer then rests
   * 121px left of the heading it is supposed to be standing in for.
   * offsetLeft/offsetWidth are layout metrics and ignore transforms entirely,
   * so this is correct no matter when it runs.
   */
  function captureFrom() {
    const y = getScroll();
    const parent = spacer.offsetParent as HTMLElement | null;
    const pr = parent
      ? parent.getBoundingClientRect()
      : ({ left: 0, top: 0 } as DOMRect);
    from = {
      x: pr.left + spacer.offsetLeft,
      y: pr.top + spacer.offsetTop + y,
      w: spacer.offsetWidth,
      fs: parseFloat(getComputedStyle(spacer).fontSize),
    };
  }

  function measureDock() {
    const r = slot.getBoundingClientRect();
    dockX = r.left;
    dockY = r.top;
    dockW = r.width;
    dockFs = parseFloat(getComputedStyle(slot).fontSize);
  }

  /**
   * Horizontal position for a given progress, derived from the CENTRE.
   *
   * Lerping the left edge instead looks broken: the hero wordmark is 439px
   * wide and the nav slot is 48px, so while the left edge crawls right the
   * width collapses much faster and the visual centre drifts LEFT before
   * swinging right. Anchoring the centre keeps the path monotonic.
   */
  function xFor(t: number, scale: number): number {
    if (!from) return 0;
    const heroCx = from.x + from.w / 2;
    const dockCx = dockX + dockW / 2;
    const cx = heroCx + (dockCx - heroCx) * t;
    return cx - (from.w * scale) / 2;
  }

  const WORD_START = 10;

  /**
   * Progress is a pure function of scroll, and the flight ENDS exactly where
   * the wordmark's natural scrolled position meets the dock.
   *
   * That endpoint is not a taste call. `top` is lerped between the natural
   * position (which falls 1px per 1px of scroll) and the fixed dock. Past
   * `from.y - dockY` the natural position is ABOVE the dock, so the lerp
   * returns something above it too — the wordmark flies up past the navbar
   * and then sinks back down as t finishes. Ending here makes `top` bounded
   * below by dockY and monotonically decreasing, so it can never bounce.
   */
  function wordEnd(): number {
    return Math.max(160, (from?.y ?? 0) - dockY);
  }

  function progress(y: number): number {
    if (reduce) return y > 20 ? 1 : 0;
    const end = wordEnd();
    // smoothstep rather than smootherstep: both leave the hero and settle into
    // the dock at zero velocity, but smootherstep's steeper middle makes the
    // wordmark travel ~1.9px per px of scroll mid-flight, which reads as it
    // escaping upward. smoothstep keeps the peak nearer the scroll rate.
    return smoothstep(clamp01((y - WORD_START) / (end - WORD_START)));
  }

  function paint() {
    if (!running || !from || !ready) return;
    const y = flight.y;
    let t = progress(y);

    if (reduce) {
      // A step function can chatter on sub-pixel jitter, so latch it with a
      // dead band. This is the one place hysteresis is still warranted.
      if (y > 40) latch = 1;
      else if (y < 12) latch = 0;
      t = latch;
    }

    const natY = from.y - y;
    const top = natY + (dockY - natY) * t;
    // Scale from the WIDTH ratio, not the font-size ratio. They are almost the
    // same number, but only the width ratio makes `from.w * scale` land exactly
    // on the real docked width at t=1 — with the font-size ratio the terminal
    // snap to the true dock rect jumped the wordmark ~11px sideways.
    const scale = Math.pow(dockW / from.w, t);
    const x = xFor(t, scale);

    // Only the docked terminal uses the dock font size; the hero rest and the
    // whole flight use the hero size (the transform's scale does the shrinking).
    const targetFs = t > 0.996 ? dockFs : from.fs;
    if (targetFs !== lastFs) {
      fly.style.fontSize = `${targetFs}px`;
      lastFs = targetFs;
    }

    if (t < 0.004) {
      fly.style.transform = `translate3d(${from.x}px, ${natY}px, 0)`;
      fly.style.willChange = "";
    } else if (t > 0.996) {
      fly.style.transform = `translate3d(${dockX}px, ${dockY}px, 0)`;
      fly.style.willChange = "";
    } else {
      fly.style.transform = `translate3d(${x}px, ${top}px, 0) scale(${scale})`;
      fly.style.willChange = "transform";
    }

    fly.classList.toggle("is-hero", t < 0.04);
    fly.classList.toggle("is-docked", t > 0.97);

    // The pill has no business appearing until the wordmark is most of the way
    // home, or it reads as two unrelated things moving at once.
    if (glass) {
      const alpha = clamp01((t - 0.45) / 0.28);
      glass.style.setProperty("--nav-alpha", String(alpha));
      glass.style.opacity = String(alpha);
      const interactive = alpha > 0.6;
      if (interactive !== lastInteractive) {
        lastInteractive = interactive;
        glass.style.pointerEvents = interactive ? "auto" : "none";
        if (interactive) glass.removeAttribute("inert");
        else glass.setAttribute("inert", "");
      }
    }
  }

  function remeasure() {
    captureFrom();
    measureDock();
    lastFs = -1; // font metrics may have changed; force a re-write next paint
  }

  function reveal() {
    if (signal.aborted) return;
    // Deliberately no scroll correction here. Yanking the page back to 0 at
    // boot fights the user if they have already started scrolling, and under
    // scroll-linking that yank drags the wordmark backwards with it.
    remeasure();
    paint();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (signal.aborted) return;
        remeasure();
        paint();
        fly.classList.add("is-ready");
        if (getScroll() < 8) fly.classList.add("is-hero");
        document.documentElement.classList.add("is-brand-morphing");
        ready = true;
        paint();
        flight.kick();
      });
    });
  }

  document.documentElement.classList.remove("is-brand-morphing");
  fly.classList.remove("is-ready", "is-active", "is-docked", "is-hero");
  if (glass) glass.style.transition = "none";

  const unsub = flight.on(() => {
    if (ready) paint();
  });

  window.addEventListener(
    "scroll",
    () => flight.kick(),
    { passive: true, signal },
  );
  // On mobile the URL bar showing/hiding fires resize with only a HEIGHT
  // change. Re-capturing the hero wordmark's position on that jolts the morph's
  // range mid-scroll (that's the "breaks on mobile" bug). The hero is sized in
  // svh, so its layout doesn't actually move when the URL bar does — only
  // remeasure on a real WIDTH change (orientation / desktop resize).
  let lastW = window.innerWidth;
  window.addEventListener(
    "resize",
    () => {
      const w = window.innerWidth;
      if (w !== lastW) {
        lastW = w;
        remeasure();
      }
      flight.measure();
    },
    { passive: true, signal },
  );
  window.addEventListener(
    "pageshow",
    () => {
      remeasure();
      paint();
    },
    { signal },
  );

  fly.addEventListener(
    "click",
    (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (location.pathname !== "/" && location.pathname !== "") return;
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    { signal },
  );

  let brandBooted = false;
  const bootBrand = () => {
    if (brandBooted || signal.aborted) return;
    brandBooted = true;
    reveal();
  };
  // Race rather than guess. The old fixed 1450/1600ms delay existed only to
  // outlast the hero's `brand-enter` entrance (1.2s + 0.18s). Under
  // scroll-linking that delay is a real bug: anyone who flicks the wheel at
  // 400ms scrolls a third of the page with the wordmark still un-morphed, and
  // it then snaps into place. So boot on whichever comes first — the entrance
  // finishing, the user touching the page, or the old timeout as a backstop.
  spacer.addEventListener(
    "animationend",
    (e) => {
      if ((e as AnimationEvent).animationName === "brand-enter") bootBrand();
    },
    { signal },
  );
  for (const evt of ["wheel", "touchmove", "keydown", "pointerdown"]) {
    window.addEventListener(evt, bootBrand, { once: true, passive: true, signal });
  }
  window.setTimeout(bootBrand, 1500);
  document.fonts?.ready?.then(() => {
    if (brandBooted) remeasure();
  });
  // The wordmark is an image now. Its width/height attributes give the box an
  // aspect-ratio up front, so `height: 1em` measures correctly even before the
  // bytes land — but if the intrinsic ratio ever disagrees with the attributes
  // the flyer would rest on a stale width, so re-measure on decode.
  for (const img of [
    spacer.querySelector("img"),
    slot.querySelector("img"),
  ]) {
    if (!img || img.complete) continue;
    img.addEventListener("load", () => remeasure(), { once: true, signal });
  }

  // The docked wordmark is a fixed element resting on the transparent brand
  // slot. When the nav pill lengthens (the CTA revealed) the slot shifts,
  // so expose a re-measure so that animation can keep the wordmark on its slot.
  const brandSync = () => {
    if (!ready) return;
    measureDock();
    paint();
  };
  (window as Window & { __brandDock?: { sync: () => void } | null }).__brandDock = {
    sync: brandSync,
  };

  signal.addEventListener("abort", () => {
    running = false;
    unsub();
    document.documentElement.classList.remove("is-brand-morphing");
    if (glass) glass.style.transition = "";
    (window as Window & { __brandDock?: { sync: () => void } | null }).__brandDock = null;
  });
}
