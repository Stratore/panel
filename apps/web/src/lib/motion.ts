import { paused, prefs } from './state.js';
import { prefersReducedMotion } from './theme.js';

/** Motion is allowed unless the user paused it (WCAG 2.2.2) or asked for less motion. */
export function motionAllowed(): boolean {
  return !paused.get() && !prefs.get().reduceMotion && !prefersReducedMotion();
}

/**
 * Calls `fn` every `ms` while motion is allowed (rotations, auto-advance). The first tick can
 * be offset to stagger boxes (SPEC § 4.2). Returns a stop function.
 */
export function every(ms: number, fn: () => void, offsetMs = 0): () => void {
  let interval: ReturnType<typeof setInterval> | null = null;
  const start = setTimeout(() => {
    interval = setInterval(() => {
      if (motionAllowed() && document.visibilityState === 'visible') fn();
    }, ms);
  }, offsetMs);
  return () => {
    clearTimeout(start);
    if (interval !== null) clearInterval(interval);
  };
}

/** Animates a number from 0 to `target` in 1.3 s with easeOutCubic (SPEC § 4.2). */
export function countUp(el: HTMLElement, target: number, format: (n: number) => string): void {
  if (!motionAllowed() || target === 0) {
    el.textContent = format(target);
    return;
  }
  const duration = 1300;
  const start = performance.now();
  const frame = (now: number) => {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - progress) ** 3;
    el.textContent = format(Math.round(target * eased));
    if (progress < 1) requestAnimationFrame(frame);
  };
  el.textContent = format(0);
  requestAnimationFrame(frame);
}
