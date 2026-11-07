// Scroll-driven behaviour for the Statement. Content is visible by default: motion classes apply only after
// this script runs and only when the reader has not asked for reduced motion.
import { useEffect, useRef, useState, type RefObject } from "react";

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Marks the document so CSS may hide not-yet-posted rows. Without JS, or with reduced motion, nothing hides.
export function useMotionOk(): void {
  useEffect(() => {
    if (reducedMotion()) return;
    document.documentElement.classList.add("motion-ok");
    return () => document.documentElement.classList.remove("motion-ok");
  }, []);
}

// Which chapter the reader is in, and how far through the statement: scroll-linked, one rAF per frame.
export function useReadingPosition(ids: string[]): { current: number; progress: number } {
  const [pos, setPos] = useState({ current: 0, progress: 0 });
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const progress = max <= 0 ? 0 : Math.min(1, Math.max(0, window.scrollY / max));
      const line = window.innerHeight * 0.3;
      let current = 0;
      ids.forEach((id, i) => {
        const el = document.getElementById(id);
        if (el !== null && el.getBoundingClientRect().top <= line) current = i;
      });
      setPos((p) => (p.current === current && Math.abs(p.progress - progress) < 0.001 ? p : { current, progress }));
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [ids]);
  return pos;
}

// Adds .is-in to every [data-reveal] inside the container once it enters the viewport.
export function useReveal(container: RefObject<HTMLElement | null>, deps: unknown[]): void {
  useEffect(() => {
    const root = container.current;
    if (root === null) return;
    const items = [...root.querySelectorAll<HTMLElement>("[data-reveal]")];
    if (reducedMotion()) {
      for (const el of items) el.classList.add("is-in");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("is-in");
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    for (const el of items) io.observe(el);
    return () => io.disconnect();
    // The caller's deps name what changes the set of items.
  }, deps);
}

// A pinned section whose vertical scroll moves its track sideways: the gate runs read left to right in time.
// Returns the section height to reserve and the current shift. Off (native sideways scroll) for reduced motion
// and narrow screens.
export function useHorizontalPin(): {
  section: RefObject<HTMLElement | null>;
  track: RefObject<HTMLDivElement | null>;
  pinned: boolean;
  height: number;
  shift: number;
} {
  const section = useRef<HTMLElement | null>(null);
  const track = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState({ pinned: false, height: 0, shift: 0 });

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const s = section.current;
      const t = track.current;
      if (s === null || t === null) return;
      const travel = t.scrollWidth - t.clientWidth;
      const pinned = !reducedMotion() && window.innerWidth >= 900 && travel > 0;
      if (!pinned) {
        setState((p) => (p.pinned ? { pinned: false, height: 0, shift: 0 } : p));
        return;
      }
      // The pinned frame sticks below the nav and running head; its CSS `top` says how far below.
      const pin = s.firstElementChild;
      const offset = pin === null ? 0 : parseFloat(getComputedStyle(pin).top) || 0;
      const height = window.innerHeight - offset + travel;
      const shift = Math.min(travel, Math.max(0, offset - s.getBoundingClientRect().top));
      setState((p) => (p.pinned && p.height === height && Math.abs(p.shift - shift) < 0.5 ? p : { pinned: true, height, shift }));
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };
    measure();
    const ro = new ResizeObserver(onScroll);
    if (track.current !== null) ro.observe(track.current);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return { section, track, ...state };
}
