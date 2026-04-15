import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

let gsapReactRegistered = false;

if (!gsapReactRegistered) {
  gsap.registerPlugin(useGSAP);
  gsapReactRegistered = true;
}

export function prefersReducedMotion(): boolean {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return false;
  }

  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export { gsap, useGSAP };
