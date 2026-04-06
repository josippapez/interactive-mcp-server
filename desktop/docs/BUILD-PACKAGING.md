# Build & Packaging Guide

Reference documentation for building, developing, and packaging the Interactive MCP Desktop application.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Build System Overview](#build-system-overview)
3. [electron.vite.config.ts Explained](#electronviteconfigts-explained)
4. [TypeScript Configuration](#typescript-configuration)
5. [npm Scripts Reference](#npm-scripts-reference)
6. [Build Output Structure](#build-output-structure)
7. [Packaging](#packaging)
   - [macOS](#macos)
   - [Windows](#windows)
   - [Linux](#linux)
8. [electron-builder Configuration](#electron-builder-configuration)
9. [Dependencies](#dependencies)

---

## Quick Start

### Development (hot-reload)

```sh
npm run dev
```

Starts electron-vite in dev mode. All three Electron processes (main, preload, renderer) are watched and reloaded on file changes.

### Production Build

```sh
npm run build
```

Compiles all three processes to `out/`. Output is not yet packaged into an installer.

### Package for the current platform

```sh
npm run package
```

Runs `electron-vite build` followed by `electron-builder --config`, producing a platform-native installer in `release/`.

---

## Build System Overview

The project uses **electron-vite 5** as its build tool. electron-vite wraps Vite and applies separate, purpose-built configurations for the three distinct Electron processes:

| Process    | Entry source        | Output                             | Environment   |
| ---------- | ------------------- | ---------------------------------- | ------------- |
| `main`     | `src/main/`         | `out/main/index.js`                | Node.js       |
| `preload`  | `src/preload/`      | `out/preload/index.js`             | Node.js       |
| `renderer` | `src/renderer/src/` | `out/renderer/index.html` + assets | Browser (DOM) |

**Why separate builds matter:**

- The `main` and `preload` processes run inside Node.js. Their dependencies must be _externalized_ (not bundled) so they resolve via `require()` at runtime.
- The `renderer` process runs inside a sandboxed Chromium context. Its dependencies are fully bundled by Vite, exactly as in a standard web app build.

Running `electron-vite build` executes all three builds in one command, ensuring a consistent, synchronized output.

---

## electron.vite.config.ts Explained

```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    resolve: { alias: { '@': resolve('src/renderer/src') } },
    plugins: [react(), tailwindcss()],
  },
});
```

### `main` and `preload` — `externalizeDepsPlugin`

`externalizeDepsPlugin` tells Vite to mark all `node_modules` dependencies as external for the `main` and `preload` builds. This means:

- They are **not** inlined into the output bundle.
- They are resolved via Node's `require()` at runtime from the app's `node_modules`.
- This is the correct behavior for Electron main/preload code, where native modules, file-system access, and Node built-ins must remain as proper CommonJS modules.

### `renderer` — React + Tailwind + `@` alias

The renderer build behaves like a standard Vite web project:

- **`@vitejs/plugin-react`** — Enables JSX transform, React Fast Refresh in dev mode, and production optimizations.
- **`@tailwindcss/vite`** — Integrates Tailwind CSS v4 directly into the Vite pipeline (no separate PostCSS step required).
- **`@` alias** — `@` resolves to `src/renderer/src/`, allowing imports like `import Foo from '@/components/Foo'` instead of deeply nested relative paths.

---

## TypeScript Configuration

Three `tsconfig` files cover the different runtime environments:

| File                 | Scope                        | Environment      | Notes                                          |
| -------------------- | ---------------------------- | ---------------- | ---------------------------------------------- |
| `tsconfig.json`      | Root / project references    | —                | Ties together the two process-specific configs |
| `tsconfig.node.json` | `main` + `preload` processes | Node.js (`node`) | `lib: ["ES2022"]`, no DOM types                |
| `tsconfig.web.json`  | `renderer` process           | Browser (`dom`)  | `lib: ["ES2022", "DOM", "DOM.Iterable"]`       |

Using separate configs ensures that Node.js-only globals (e.g., `process`, `__dirname`) are available in main/preload, while DOM APIs (`document`, `window`) are only available in the renderer. Cross-contamination of types is prevented at the TypeScript level.

---

## npm Scripts Reference

| Script          | Command                                            | Description                                                                                            |
| --------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `dev`           | `electron-vite dev`                                | Start dev server with hot-reload for all three processes                                               |
| `build`         | `electron-vite build`                              | Production build to `out/` (no installer)                                                              |
| `preview`       | `electron-vite preview`                            | Preview the production build locally without packaging                                                 |
| `package`       | `electron-vite build && electron-builder --config` | Full build + package for the current platform                                                          |
| `package:mac`   | _(macOS target)_                                   | Package for macOS only (DMG + ZIP)                                                                     |
| `package:win`   | _(Windows target)_                                 | Package for Windows only (NSIS installer + ZIP)                                                        |
| `package:linux` | _(Linux target)_                                   | Package for Linux only (AppImage + DEB)                                                                |
| `package:all`   | _(all platforms)_                                  | Package for macOS, Windows, and Linux in one run                                                       |
| `package:dir`   | _(directory output)_                               | Build to an unpacked directory without creating an installer — useful for inspection or manual signing |

> **Note:** Cross-platform packaging (e.g., building a Windows installer on macOS) requires appropriate toolchains or CI environments. `package:all` is primarily intended for CI pipelines.

---

## Build Output Structure

After running `npm run build`, the `out/` directory contains:

```
out/
├── main/
│   └── index.js          # Compiled Electron main process
├── preload/
│   └── index.js          # Compiled preload script
└── renderer/
    ├── index.html         # Renderer entry point
    └── assets/            # Bundled JS, CSS, and static assets
        ├── index-[hash].js
        └── index-[hash].css
```

After running a `package` script, distributable installers are written to:

```
release/
└── <version>/
    ├── Interactive MCP-<version>.dmg          # macOS disk image
    ├── Interactive MCP-<version>-mac.zip      # macOS ZIP archive
    ├── Interactive MCP Setup <version>.exe    # Windows NSIS installer
    ├── Interactive MCP-<version>-win.zip      # Windows ZIP archive
    ├── Interactive MCP-<version>.AppImage     # Linux AppImage
    └── interactive-mcp_<version>_amd64.deb    # Linux Debian package
```

---

## Packaging

The packaging step is handled by **electron-builder 26**. It reads configuration from `package.json` (`"build"` key) and takes the compiled `out/` artifacts as input.

### Core electron-builder settings

| Setting          | Value                         |
| ---------------- | ----------------------------- |
| `appId`          | `com.interactive-mcp.desktop` |
| `productName`    | `Interactive MCP`             |
| Output directory | `release/`                    |
| Packaged files   | `out/**/*`                    |
| Extra resources  | `resources/**`                |

The `resources/` directory is copied into the app bundle and is accessible at runtime. It contains application icons (`icon.png`) used by the window and system tray.

---

### macOS

| Setting        | Value                                 |
| -------------- | ------------------------------------- |
| App category   | `public.app-category.developer-tools` |
| Icon           | `build/icon.icns`                     |
| Output formats | DMG + ZIP                             |

- **DMG** — Standard macOS drag-to-install disk image.
- **ZIP** — Archive of the `.app` bundle, useful for auto-updater or manual distribution.

---

### Windows

| Setting        | Value                |
| -------------- | -------------------- |
| Icon           | `build/icon.ico`     |
| Output formats | NSIS installer + ZIP |
| Architectures  | x64, arm64           |

**NSIS installer options:**

| Option                               | Value   | Effect                                                  |
| ------------------------------------ | ------- | ------------------------------------------------------- |
| `oneClick`                           | `false` | Shows the installer wizard instead of silent one-click  |
| `perMachine`                         | `false` | Installs per-user by default (no admin rights required) |
| `allowToChangeInstallationDirectory` | `true`  | User can customize the install path                     |
| `createDesktopShortcut`              | `true`  | Creates a shortcut on the user's Desktop                |
| `createStartMenuShortcut`            | `true`  | Creates a shortcut in the Start Menu                    |

---

### Linux

| Setting        | Value            |
| -------------- | ---------------- |
| Category       | `Development`    |
| Icon           | `build/icon.png` |
| Output formats | AppImage + DEB   |
| Architectures  | x64, arm64       |

- **AppImage** — Self-contained portable executable; runs on most distributions without installation.
- **DEB** — Debian/Ubuntu package for system-level installation via `dpkg` or `apt`.

---

## electron-builder Configuration

The full `build` configuration lives in `package.json`. Key structural points:

```json
{
  "build": {
    "appId": "com.interactive-mcp.desktop",
    "productName": "Interactive MCP",
    "directories": { "output": "release/" },
    "files": ["out/**/*"],
    "extraResources": ["resources/**"],
    "mac": {
      "category": "public.app-category.developer-tools",
      "icon": "build/icon.icns",
      "target": ["dmg", "zip"]
    },
    "win": {
      "icon": "build/icon.ico",
      "target": [
        { "target": "nsis", "arch": ["x64", "arm64"] },
        { "target": "zip", "arch": ["x64", "arm64"] }
      ]
    },
    "nsis": {
      "oneClick": false,
      "perMachine": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true
    },
    "linux": {
      "category": "Development",
      "icon": "build/icon.png",
      "target": [
        { "target": "AppImage", "arch": ["x64", "arm64"] },
        { "target": "deb", "arch": ["x64", "arm64"] }
      ]
    }
  }
}
```

**`files`** — Instructs electron-builder which files to include in the app bundle. Only `out/**/*` is included; source files and `node_modules` are not re-packaged (they are either bundled into `out/` by electron-vite or resolved via `extraResources`).

**`extraResources`** — Copies additional files into the platform-specific resources directory of the packaged app (`Resources/` on macOS, `resources/` on Windows/Linux). Contents are accessible at runtime via `process.resourcesPath`. One entry is included:

1. `resources/**` — application icons and other static assets.

---

## Dependencies

### Runtime dependencies

These are shipped inside the packaged application.

| Package                     | Version   | Purpose                                                   |
| --------------------------- | --------- | --------------------------------------------------------- |
| `@modelcontextprotocol/sdk` | `^1.27.1` | MCP protocol client/server SDK                            |
| `express`                   | `^5.1.0`  | HTTP server for IPC/tool communication                    |
| `react-markdown`            | `^10.1.0` | Markdown rendering in the renderer                        |
| `react-syntax-highlighter`  | `^16.1.1` | Syntax-highlighted code blocks                            |
| `remark-gfm`                | `^4.0.1`  | GitHub Flavored Markdown support for react-markdown       |
| `sql.js`                    | `^1.12.0` | SQLite compiled to WebAssembly for local data persistence |
| `zod`                       | `^4.3.6`  | Runtime schema validation                                 |

### Development dependencies

Used during build, tooling, and local development only — not shipped in the final app.

| Package                | Version   | Purpose                                         |
| ---------------------- | --------- | ----------------------------------------------- |
| `electron`             | `^41.1.0` | Electron runtime                                |
| `electron-builder`     | `^26.8.1` | Cross-platform packaging and installer creation |
| `electron-vite`        | `^5.0.0`  | Build tool (Vite wrapper for Electron)          |
| `react`                | `^19.2.0` | UI library (renderer)                           |
| `tailwindcss`          | `^4.1.11` | Utility-first CSS framework                     |
| `typescript`           | `^5.9.3`  | TypeScript compiler                             |
| `@vitejs/plugin-react` | `^4.6.1`  | Vite plugin for React JSX and Fast Refresh      |

> `react` appears in `devDependencies` because the renderer process bundles it at build time via electron-vite/Vite. The compiled `out/renderer/` output already contains React — there is no runtime `require('react')` from `node_modules` in the packaged app.
