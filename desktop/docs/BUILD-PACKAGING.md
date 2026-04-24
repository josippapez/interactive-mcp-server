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

Runs (in order) `rebuild:electron`, `copy:opencode-node`, the legacy `copy:opencode`, `electron-vite build`, then `electron-builder --config`, producing a platform-native installer in `release/`.

> `copy:opencode-node` must succeed before the main-process build can resolve `virtual:opencode-server`. If `resources/opencode-node/node.js` is missing, the main-process bundle will fail at build time.

---

## Build System Overview

The project uses **electron-vite 5** as its build tool. electron-vite wraps Vite and applies separate, purpose-built configurations for the three distinct Electron processes:

| Process    | Entry source        | Output                             | Environment                               |
| ---------- | ------------------- | ---------------------------------- | ----------------------------------------- |
| `main`     | `src/main/`         | `out/main/*.mjs` (three entries)   | Node.js (Electron main + utility process) |
| `preload`  | `src/preload/`      | `out/preload/index.js`             | Node.js                                   |
| `renderer` | `src/renderer/src/` | `out/renderer/index.html` + assets | Browser (DOM)                             |

The `main` build declares **three rollup inputs** so a single `electron-vite build` emits
all three Node-side entries:

| Input source                                 | Artifact                                      | Runtime                                        |
| -------------------------------------------- | --------------------------------------------- | ---------------------------------------------- |
| `src/main/index.ts`                          | `out/main/index.mjs`                          | Electron main process                          |
| `src/main/context-injector-worker.thread.ts` | `out/main/context-injector-worker.thread.mjs` | Worker thread spawned by main                  |
| `src/main/utility/entry.ts`                  | `out/main/opencode-utility.thread.mjs`        | Electron `utilityProcess` child (backend host) |

> The utility artifact filename (`opencode-utility.thread.mjs`) is historical and kept
> stable. The source entry is `src/main/utility/entry.ts`; the "opencode-utility" name
> dates back to the Phase 1 scaffolding when the utility process was scoped to OpenCode
> only. Do not rename without updating the `utilityProcess.fork(...)` call site in
> `src/main/utility/supervisor.ts`.

**Why separate builds matter:**

- The `main` and `preload` processes run inside Node.js. Their dependencies must be _externalized_ (not bundled) so they resolve via `require()` at runtime.
- The `renderer` process runs inside a sandboxed Chromium context. Its dependencies are fully bundled by Vite, exactly as in a standard web app build.

Running `electron-vite build` executes all three builds in one command, ensuring a consistent, synchronized output.

---

## electron.vite.config.ts Explained

The `main` build ships the **in-process OpenCode server** (Phase C). It is configured with three custom Rollup plugins, a platform-specific native-module narrowing step, and ESM output:

```ts
// electron.vite.config.ts (summary)
const OPENCODE_NODE_DIR = resolve(__dirname, 'resources/opencode-node');
const nodePtyPkg = `@lydell/node-pty-${process.platform}-${process.arch}`;

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: [
          '@lydell/node-pty',
          '@lydell/node-pty-darwin-arm64',
          '@lydell/node-pty-darwin-x64',
          '@lydell/node-pty-linux-arm64',
          '@lydell/node-pty-linux-x64',
          '@lydell/node-pty-win32-x64',
          'jsonc-parser',
        ],
        output: { format: 'es', entryFileNames: '[name].mjs' },
      },
    },
    plugins: [
      externalizeDepsPlugin({ exclude: ['@opencode-ai/sdk'] }),
      /* opencode:node-pty-narrower       — rewrite bare @lydell/node-pty → platform pkg */
      /* opencode:virtual-server-module   — rewrite virtual:opencode-server → bundle path */
      /* opencode:copy-server-assets      — copy tree-sitter-*.wasm → out/main/          */
    ],
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    /* React + Tailwind + @ alias */
  },
});
```

### `main` — in-process OpenCode server wiring

Three custom plugins cooperate to make `import('virtual:opencode-server')` resolve to the prebuilt Node bundle at runtime:

1. **`opencode:virtual-server-module`** (`enforce: 'pre'`) rewrites the specifier `virtual:opencode-server` to the absolute path `resources/opencode-node/node.js`. This is the entry point that `desktop/src/main/opencode/server.ts:66` dynamically imports and whose `Server.listen()` is called.
2. **`opencode:node-pty-narrower`** (`enforce: 'pre'`) rewrites any `@lydell/node-pty` import inside the OpenCode bundle to the platform-specific package `@lydell/node-pty-<platform>-<arch>`. This mirrors the upstream `packages/desktop-electron` Vite config.
3. **`opencode:copy-server-assets`** copies the three `tree-sitter-*.wasm` grammar files from `resources/opencode-node/` into **`out/main/`** (not `out/main/chunks/`). The OpenCode bundle resolves wasm files via `new URL('tree-sitter.wasm', import.meta.url)`, which is sibling-to-the-chunk. Our rollup layout keeps the main-process chunk at `out/main/`, so the wasm must land there. If the chunk layout ever changes, the copy target must move too — see [KNOWN-ISSUES.md](./KNOWN-ISSUES.md#wasm-copy-layout-sensitivity).

### `main` — ESM output

The main-process build emits ESM because the OpenCode bundle uses top-level `await`, which is only legal in ESM. Two constraints follow:

- `output.format = 'es'` and `output.entryFileNames = '[name].mjs'`.
- `package.json` `"main"` is `./out/main/index.mjs`. Electron 41 supports ESM in the main process natively — no `"type": "module"` flag is needed at the root.

### `main` and `preload` — `externalizeDepsPlugin`

`externalizeDepsPlugin` tells Vite to mark all `node_modules` dependencies as external for the `main` and `preload` builds. This means:

- They are **not** inlined into the output bundle.
- They are resolved via Node's `require()` / `import()` at runtime from the app's `node_modules`.
- This is the correct behavior for Electron main/preload code, where native modules, file-system access, and Node built-ins must remain as proper modules.

The `main` build passes `exclude: ['@opencode-ai/sdk']` so the SDK is bundled (it is shipped as ESM and needs to be converted by Vite for consumption by the main process).

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

| Script                   | Command                                                                                                       | Description                                                                                                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dev`                    | `electron-vite dev`                                                                                           | Start dev server with hot-reload for all three processes                                                                                                                                                                                              |
| `build`                  | `electron-vite build`                                                                                         | Production build to `out/` (no installer)                                                                                                                                                                                                             |
| `preview`                | `electron-vite preview`                                                                                       | Preview the production build locally without packaging                                                                                                                                                                                                |
| `rebuild:electron`       | `electron-rebuild -w better-sqlite3`                                                                          | Fast (~0.7 s) idempotent ABI check for `better-sqlite3`. Runs as `postinstall`.                                                                                                                                                                       |
| `rebuild:electron:force` | `rm -rf node_modules/better-sqlite3/build && electron-rebuild -f -w better-sqlite3 --build-from-source`       | Force a full rebuild of `better-sqlite3` from source. Use when the fast ABI check is insufficient (e.g. after switching Electron major versions).                                                                                                     |
| `copy:opencode-node`     | `node scripts/copy-opencode-node.mjs`                                                                         | Copy the prebuilt OpenCode Node bundle (`node.js` + `tree-sitter-*.wasm`, optionally `node.js.map`) from `~/Desktop/opencode/packages/opencode/dist/node` into `resources/opencode-node/`.                                                            |
| `copy:opencode[:*]`      | `node scripts/copy-opencode.js [--platform …]`                                                                | **Legacy** — copies the 99 MB per-platform `opencode` native binary into `resources/bin/opencode`. Currently still chained from each `package:*` script as a safety net; redundant once the in-process path is smoke-tested on every target platform. |
| `package`                | `rebuild:electron && copy:opencode-node && copy:opencode && electron-vite build && electron-builder --config` | Full build + package for the current platform                                                                                                                                                                                                         |
| `package:mac`            | _(macOS target)_                                                                                              | Package for macOS only (DMG + ZIP). Runs `rebuild:electron`, `copy:opencode-node`, `copy:opencode:mac`, `electron-vite build`, `electron-builder --mac`.                                                                                              |
| `package:mac-arm64`      | _(macOS arm64 target, bytecode enabled)_                                                                      | arm64-only macOS package with `ENABLE_BYTECODE=1` for main-process V8 bytecode cache.                                                                                                                                                                 |
| `package:mac-x64`        | _(macOS x64 target)_                                                                                          | x64-only macOS package.                                                                                                                                                                                                                               |
| `package:win`            | _(Windows target)_                                                                                            | Package for Windows only (NSIS installer + ZIP).                                                                                                                                                                                                      |
| `package:linux`          | _(Linux target)_                                                                                              | Package for Linux only (AppImage + DEB).                                                                                                                                                                                                              |
| `package:dir`            | _(directory output)_                                                                                          | Build to an unpacked directory without creating an installer — useful for inspection or manual signing.                                                                                                                                               |

> **Note:** There is no working `package:all` script. Cross-platform packaging must run per-platform because `copy:opencode-node` pulls from a hardcoded local source directory (`~/Desktop/opencode/packages/opencode/dist/node`) and the `@lydell/node-pty-*` native packages must match the target platform — see [Dependencies → OpenCode in-process prerequisites](#opencode-in-process-prerequisites).

---

## Build Output Structure

After running `npm run build`, the `out/` directory contains:

```
out/
├── main/
│   ├── index.mjs                # Compiled Electron main process (ESM)
│   ├── chunks/
│   │   └── …                    # Rollup-emitted chunks (including the OpenCode bundle's chunks)
│   ├── tree-sitter.wasm         # Tree-sitter runtime wasm (copied by opencode:copy-server-assets)
│   ├── tree-sitter-*.wasm       # Grammar wasms (copied sibling to the chunk — see below)
│   └── …
├── preload/
│   └── index.js                 # Compiled preload script
└── renderer/
    ├── index.html               # Renderer entry point
    └── assets/                  # Bundled JS, CSS, and static assets
        ├── index-[hash].js
        └── index-[hash].css
```

> The tree-sitter wasm files are emitted into **`out/main/`** — the same directory as the OpenCode bundle chunk. They are **not** under `out/main/chunks/`. See the `opencode:copy-server-assets` plugin in `electron.vite.config.ts` and the [KNOWN-ISSUES.md wasm-copy note](./KNOWN-ISSUES.md#wasm-copy-layout-sensitivity).

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

| Setting          | Value                              |
| ---------------- | ---------------------------------- |
| `appId`          | `com.interactive-mcp.desktop`      |
| `productName`    | `Interactive MCP`                  |
| Output directory | `release/`                         |
| Packaged files   | `out/**/*`                         |
| Extra resources  | `resources/**`                     |
| `asarUnpack`     | `node_modules/better-sqlite3/**/*` |

### `asarUnpack` — native sqlite binding

`better-sqlite3`'s native `.node` binding is loaded inside the **utility process** (see
[ARCHITECTURE.md → Main ↔ utility split](./ARCHITECTURE.md#main--utility-split)).
Electron cannot `dlopen` native modules from inside an `app.asar` archive, so the
`package.json` `build` config sets:

```json
"asarUnpack": ["node_modules/better-sqlite3/**/*"]
```

This unpacks the entire `better-sqlite3` tree to
`app.asar.unpacked/node_modules/better-sqlite3/`, where the binding resolves normally at
runtime. The `postinstall` hook (`rebuild:electron`) still rebuilds the binding against
Electron's ABI before packaging — both steps are required.

The `resources/` directory is copied into the app bundle and is accessible at runtime via `process.resourcesPath`. Contents:

- `resources/icon.png` — window/tray icon.
- `resources/opencode-node/` — the prebuilt OpenCode Node bundle (`node.js` + `tree-sitter-*.wasm`). Required for the in-process OpenCode server. The path is also hard-coded into the main-process bundle at build time by the `opencode:virtual-server-module` plugin.
- `resources/bin/opencode` — **legacy** per-platform OpenCode binary. Still copied by the `copy:opencode*` script chain for safety but is not used by the in-process path. Can be dropped once packaged smoke-tests confirm the in-process server works across all signed platforms.

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
    "asarUnpack": ["node_modules/better-sqlite3/**/*"],
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

| Package                         | Version         | Purpose                                                                                             |
| ------------------------------- | --------------- | --------------------------------------------------------------------------------------------------- |
| `@modelcontextprotocol/sdk`     | `^1.27.1`       | MCP protocol client/server SDK                                                                      |
| `@opencode-ai/sdk`              | `^1.14.18`      | OpenCode TypeScript SDK (bundled into main process)                                                 |
| `@lydell/node-pty`              | `1.2.0-beta.10` | Platform-agnostic pty shim; narrowed at build time to the platform-specific package below.          |
| `@lydell/node-pty-darwin-arm64` | `1.2.0-beta.10` | Native pty binding (macOS arm64). Required by the in-process OpenCode server.                       |
| `better-sqlite3`                | `^12.9.0`       | Native SQLite binding for session/message persistence. Rebuilt for Electron via `electron-rebuild`. |
| `express`                       | `^5.2.1`        | HTTP server for MCP transport                                                                       |
| `jsonc-parser`                  | `^3.3.1`        | JSONC parsing for OpenCode config — externalized in the main-process build.                         |
| `sql.js`                        | _n/a (legacy)_  | (Historical — see DATABASE.md; current DB is `better-sqlite3`.)                                     |
| `zod`                           | `^4.3.6`        | Runtime schema validation                                                                           |

### OpenCode in-process prerequisites

The Phase C migration introduces build-time assets and platform-specific native packages that must be staged before a packaged build will succeed.

**Prebuilt OpenCode Node bundle.** The contents of `resources/opencode-node/` (`node.js`, `tree-sitter-*.wasm`, optional `node.js.map`) are populated by `npm run copy:opencode-node`. The script's source is hardcoded to `~/Desktop/opencode/packages/opencode/dist/node` — it expects a local checkout of the OpenCode repo with the Node bundle already built via `bun run script/build-node.ts`. The bundle is a single ESM file that runs on Electron's Node runtime on every platform.

**Platform-specific `@lydell/node-pty-*` packages.** The main-process build lists every supported target as a Rollup external so native bindings are `require()`'d at runtime. Currently only `@lydell/node-pty-darwin-arm64` is declared in `dependencies`. Before a cross-platform packaging run, the remaining packages must be added:

| Package                         | Required for                |
| ------------------------------- | --------------------------- |
| `@lydell/node-pty-darwin-arm64` | macOS arm64 (already added) |
| `@lydell/node-pty-darwin-x64`   | macOS x64                   |
| `@lydell/node-pty-linux-arm64`  | Linux arm64                 |
| `@lydell/node-pty-linux-x64`    | Linux x64                   |
| `@lydell/node-pty-win32-x64`    | Windows x64                 |

All four missing packages must be pinned to `1.2.0-beta.10` to match the narrower plugin in `electron.vite.config.ts`.

### Development dependencies

Used during build, tooling, and local development only — not shipped in the final app.

| Package                | Version   | Purpose                                         |
| ---------------------- | --------- | ----------------------------------------------- |
| `electron`             | `^41.1.0` | Electron runtime (native ESM main support)      |
| `electron-builder`     | `^26.8.1` | Cross-platform packaging and installer creation |
| `electron-vite`        | `^5.0.0`  | Build tool (Vite wrapper for Electron)          |
| `react`                | `^19.2.0` | UI library (renderer)                           |
| `tailwindcss`          | `^4.1.11` | Utility-first CSS framework                     |
| `typescript`           | `^5.9.3`  | TypeScript compiler                             |
| `@vitejs/plugin-react` | `^4.6.1`  | Vite plugin for React JSX and Fast Refresh      |

> `react` appears in `devDependencies` because the renderer process bundles it at build time via electron-vite/Vite. The compiled `out/renderer/` output already contains React — there is no runtime `require('react')` from `node_modules` in the packaged app.
