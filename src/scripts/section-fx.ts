import { ensureScrollFlight } from "./scroll-flight";
import { clamp01, smoothstep } from "./scroll-helpers";

/**
 * Scroll-LINKED section drama. Each `[data-fx]` element is driven continuously
 * by how far it has climbed through the viewport, not a one-shot reveal — so
 * the motion tracks the scroll exactly and reads as cinematic.
 *
 * Effects write the individual `scale` / `translate` / `rotate` CSS properties
 * (NOT `transform`), so they compose cleanly on top of the one-shot `transform`
 * entrances from the `[data-reveal]` system without either clobbering the other.
 *
 * Desktop + motion-OK only: on touch the existing cheap IntersectionObserver
 * reveals carry the drama, keeping momentum scrolling perfectly smooth.
 */
export function initSectionFx(): () => void {
  const noop = () => {};
  if (typeof window === "undefined") return noop;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return noop;
  if (!window.matchMedia("(min-width: 640px)").matches) return noop;

  const items = Array.from(
    document.querySelectorAll<HTMLElement>("[data-fx]"),
  ).map((el) => ({ el, fx: el.dataset.fx || "" }));
  if (!items.length) return noop;

  const flight = ensureScrollFlight();

  // 0 when the element's top sits at the bottom edge of the viewport, 1 once it
  // has risen ~72% of a screen height — the band over which the effect plays.
  function enterP(top: number, vh: number): number {
    return smoothstep(clamp01((vh - top) / (vh * 0.72)));
  }

  // Every effect resolves to the element's untouched resting state at p=1
  // (scale 1, no offset, no rotation) so nothing is left displaced or clipped.
  //
  // Takes `top` as an argument rather than measuring it. See paint() — the
  // measurement has to happen before any of the writes, not next to them.
  function apply(el: HTMLElement, fx: string, vh: number, top: number) {
    const p = enterP(top, vh);
    const inv = 1 - p;
    switch (fx) {
      // Satellite: BANKS in from orbit — swings around its Y axis while zooming,
      // like a panel turning to face you. (3D on the Y axis.)
      case "orbit":
        el.style.scale = (0.72 + 0.28 * p).toFixed(4);
        el.style.rotate = `y ${(inv * 42).toFixed(2)}deg`;
        el.style.translate = `${(inv * 70).toFixed(1)}px 0`;
        break;
      // Dashboard: tips up out of a steep 3D lean into a flat, face-on panel.
      // (3D on the X axis — the one you liked, pushed further.)
      case "tilt":
        el.style.scale = (0.84 + 0.16 * p).toFixed(4);
        el.style.translate = `0 ${(inv * 110).toFixed(1)}px`;
        el.style.rotate = `x ${(inv * 28).toFixed(2)}deg`;
        break;
      // Footer wordmark: PUNCHES in from tiny to full, straight zoom, no tilt.
      // Ends exactly at the designed size (scale 1) so it never clips.
      case "punch":
        el.style.scale = (0.48 + 0.52 * p).toFixed(4);
        el.style.translate = `0 ${(inv * 44).toFixed(1)}px`;
        break;
    }
  }

  // Read everything, then write everything.
  //
  // This used to measure and write inside one loop: getBoundingClientRect on an
  // element, then style writes to that same element, then the next element. Each
  // read after a write forces the browser to flush layout before it can answer,
  // so a three-item list cost three synchronous layouts EVERY frame of every
  // scroll. Two testers described the scroll as heavy and stuttering, and this
  // is the shape that produces exactly that.
  //
  // Split into phases, the writes from the previous pass are flushed once by the
  // first read and the rest come free: three forced layouts per frame become one.
  const tops: number[] = new Array(items.length);
  function paint() {
    const vh = flight.vh;
    for (let i = 0; i < items.length; i += 1) {
      tops[i] = items[i].el.getBoundingClientRect().top;
    }
    for (let i = 0; i < items.length; i += 1) {
      apply(items[i].el, items[i].fx, vh, tops[i]);
    }
  }

  for (const { el } of items) el.style.willChange = "transform";

  const off = flight.on(paint);
  paint();
  flight.kick();

  return () => {
    off();
    for (const { el } of items) {
      el.style.willChange = "";
      el.style.scale = "";
      el.style.translate = "";
      el.style.rotate = "";
    }
  };
}
