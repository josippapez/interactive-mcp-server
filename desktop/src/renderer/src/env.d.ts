import type { ElectronAPI } from '../../preload/index';

declare global {
  interface Window {
    api: ElectronAPI;
  }
}

// Vite asset imports (SVG/PNG/etc. resolve to URL strings at build time).
// Must be top-level `declare module` to be picked up as an ambient wildcard.
declare module '*.svg' {
  const url: string;
  export default url;
}

declare module '*.png' {
  const url: string;
  export default url;
}
