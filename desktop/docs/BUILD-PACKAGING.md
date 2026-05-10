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

Runs (in order) `rebuild:electron`, `copy:opencode-bin` (per-platform native binary stage), `electron-vite build`, then `electron-builder --config`, producing a platform-native installer in `release/`.

> The committed runtime is **Mode C (`native-subprocess`)** — the OpenCode HTTP server is spawned from a per-platform native binary at runtime. The historical Mode A path (`virtual:opencode-server` → prebuilt Node bundle under `resources/opencode-node/`) is dormant; its `copy:opencode-node` script and `opencode:copy-server-assets` Vite plugin have been removed. To reactivate Mode A, see the stub error message thrown by the `opencode:virtual-server-module` plugin in `electron.vite.config.ts`.

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

The `main` build ships the wiring needed to spawn the **OpenCode native subprocess** (committed Mode C — `RUNTIME_KIND = 'native-subprocess'`). It is configured with two custom Rollup plugins, a platform-specific native-module narrowing step, and ESM output:

```ts
// electron.vite.config.ts (summary)
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
      /* opencode:node-pty-narrower       — rewrite bare @lydell/node-pty → platform pkg          */
      /* opencode:virtual-server-module   — STUB: throws if Mode A is reactivated without re-adding assets */
    ],
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    /* React + Tailwind + @ alias */
  },
});
```

### `main` — OpenCode native-subprocess wiring

Two custom plugins remain:

1. **`opencode:node-pty-narrower`** (`enforce: 'pre'`) rewrites any `@lydell/node-pty` import inside the main bundle to the platform-specific package `@lydell/node-pty-<platform>-<arch>`. This mirrors the upstream `packages/desktop-electron` Vite config and is still needed in Mode C for the renderer/main side that consumes pty bindings outside the OpenCode subprocess.
2. **`opencode:virtual-server-module`** (`enforce: 'pre'`) — historically rewrote `virtual:opencode-server` to the prebuilt Node bundle path. Now resolves to an in-memory **stub** that throws a descriptive runtime error if the Mode A code path (`runtime/in-process.ts`, `factory.ts case 'in-process-utility'`) is ever reached. The stub message points at the reactivation steps: restore `desktop/scripts/copy-opencode-node.mjs`, the `resources/opencode-node/**` glob in `extraResources`, and the original Vite plugins.

> **Removed:** the `opencode:copy-server-assets` plugin (which copied `tree-sitter-*.wasm` into `out/main/`) and the `OPENCODE_NODE_DIR` constant. The native `opencode` binary loads its own grammars internally; the Electron main bundle no longer ships them.

### `main` — ESM output

The main-process build emits ESM. Two constraints follow:

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

| Script                   | Command                                                                                                 | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dev`                    | `electron-vite dev`                                                                                     | Start dev server with hot-reload for all three processes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `build`                  | `electron-vite build`                                                                                   | Production build to `out/` (no installer)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `preview`                | `electron-vite preview`                                                                                 | Preview the production build locally without packaging                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `rebuild:electron`       | `electron-rebuild -w better-sqlite3`                                                                    | Fast (~0.7 s) idempotent ABI check for `better-sqlite3`. Runs as `postinstall`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `rebuild:electron:force` | `rm -rf node_modules/better-sqlite3/build && electron-rebuild -f -w better-sqlite3 --build-from-source` | Force a full rebuild of `better-sqlite3` from source. Use when the fast ABI check is insufficient (e.g. after switching Electron major versions).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `copy:opencode-bin`      | `node scripts/copy-opencode-bin.mjs [--local-source <path>] [--all] [--no-prune]`                       | Stage the per-platform native `opencode` binary into `resources/opencode-bin/<platform>-<arch>/opencode[.exe]`. Source priority: `--local-source <path>` flag → `OPENCODE_LOCAL_SOURCE` env var → default `~/Desktop/opencode` (expects `packages/opencode/dist/opencode-<platform>-<arch>/bin/opencode[.exe]`). If no local source is found, the script falls back to fetching the version pinned in `desktop/resources/opencode-bin/manifest.json` from the `anomalyco/opencode` GitHub release. `chmod +x` is applied on POSIX. **Auto-prune:** after staging, the script deletes any sibling `<platform>-<arch>/` directories in `resources/opencode-bin/` that aren't part of the current run's targets, so electron-builder doesn't bake foreign-platform binaries into the asar (see [Per-platform native `opencode` binary](#opencode-subprocess-prerequisites)). Skipped when `--all` is passed (cross-build); pass `--no-prune` to opt out for debugging or multi-run staging. `manifest.json` and any non-directory entries are always preserved. |
| `copy:opencode[:*]`      | `node scripts/copy-opencode.js [--platform …]`                                                          | **Legacy** — copies a per-platform `opencode` native binary into `resources/bin/opencode`. Superseded by `copy:opencode-bin` and the `resources/opencode-bin/` layout; retained transitionally for any callers that still reference the legacy path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `package`                | `rebuild:electron && copy:opencode-bin && electron-vite build && electron-builder --config`             | Full build + package for the current platform                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `package:mac`            | _(macOS target)_                                                                                        | Package for macOS only (DMG + ZIP). Runs `rebuild:electron`, `copy:opencode-bin`, `electron-vite build`, `electron-builder --mac`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `package:mac-arm64`      | _(macOS arm64 target, bytecode enabled)_                                                                | arm64-only macOS package with `ENABLE_BYTECODE=1` for main-process V8 bytecode cache.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `package:mac-x64`        | _(macOS x64 target)_                                                                                    | x64-only macOS package.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `package:win`            | _(Windows target)_                                                                                      | Package for Windows only (NSIS installer + ZIP).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `package:linux`          | _(Linux target)_                                                                                        | Package for Linux only (AppImage + DEB).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `package:dir`            | _(directory output)_                                                                                    | Build to an unpacked directory without creating an installer — useful for inspection or manual signing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

> **Note:** There is no working `package:all` script. Cross-platform packaging must run per-platform because `copy:opencode-bin` stages a per-platform native binary (sourced locally or fetched per-arch from the pinned GitHub release in `resources/opencode-bin/manifest.json`) and the `@lydell/node-pty-*` native packages must match the target platform — see [Dependencies → OpenCode subprocess prerequisites](#opencode-subprocess-prerequisites).

---

## Build Output Structure

After running `npm run build`, the `out/` directory contains:

```
out/
├── main/
│   ├── index.mjs                # Compiled Electron main process (ESM)
│   ├── chunks/
│   │   └── …                    # Rollup-emitted chunks
│   └── …
├── preload/
│   └── index.js                 # Compiled preload script
└── renderer/
    ├── index.html               # Renderer entry point
    └── assets/                  # Bundled JS, CSS, and static assets
        ├── index-[hash].js
        └── index-[hash].css
```

> Mode A historically copied `tree-sitter-*.wasm` files into `out/main/` (sibling to the OpenCode bundle chunk). With the commit to Mode C those copies are no longer emitted — the native `opencode` binary loads its grammars internally. If Mode A is reactivated, see the historical wasm-copy note in [KNOWN-ISSUES.md](./KNOWN-ISSUES.md).

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
- `resources/opencode-bin/<platform>-<arch>/opencode[.exe]` — per-platform native `opencode` binary. Spawned at runtime by the Mode C `NativeBinaryStrategy` (see [ARCHITECTURE.md](./ARCHITECTURE.md#opencode-server-runs-as-a-native-subprocess-mode-c--committed-default)). Staged by `npm run copy:opencode-bin`.
- `resources/opencode-bin/manifest.json` — pins the upstream OpenCode release version used by `copy:opencode-bin` when no local source is provided.
- `resources/bin/opencode` — **legacy** per-platform OpenCode binary path. Superseded by `resources/opencode-bin/`; can be dropped once all callers have migrated.

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

**`files`** — Instructs electron-builder which files to include in the app bundle. Only `out/**/*` is included; source files and `node_modules` are not re-packaged (they are either bundled into `out/` by electron-vite or resolved via `extraResources`). The array also keeps a defense-in-depth `"!resources/opencode-bin/**"` exclusion, but that exclusion alone is **not** sufficient: when an `extraResources` entry references the same path, electron-builder force-includes the source directory into the asar regardless of the `files` exclusion. The load-bearing fix is the auto-prune step in `scripts/copy-opencode-bin.mjs` — see [Per-platform native `opencode` binary](#opencode-subprocess-prerequisites).

**`extraResources`** — Copies additional files into the platform-specific resources directory of the packaged app (`Resources/` on macOS, `resources/` on Windows/Linux). Contents are accessible at runtime via `process.resourcesPath`. One entry is included:

1. `resources/**` — application icons, other static assets, and the per-platform `resources/opencode-bin/<platform>-<arch>/` subtree containing the native `opencode` binary spawned at runtime by the Mode C `NativeBinaryStrategy`.

---

## Dependencies

### Runtime dependencies

These are shipped inside the packaged application.

| Package                         | Version         | Purpose                                                                                                                     |
| ------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `@modelcontextprotocol/sdk`     | `^1.27.1`       | MCP protocol client/server SDK                                                                                              |
| `@opencode-ai/sdk`              | `^1.14.18`      | OpenCode TypeScript SDK (bundled into main process)                                                                         |
| `@lydell/node-pty`              | `1.2.0-beta.10` | Platform-agnostic pty shim; narrowed at build time to the platform-specific package below.                                  |
| `@lydell/node-pty-darwin-arm64` | `1.2.0-beta.10` | Native pty binding (macOS arm64). Used by the main process for any pty-backed flows that bridge to the OpenCode subprocess. |
| `better-sqlite3`                | `^12.9.0`       | Native SQLite binding for session/message persistence. Rebuilt for Electron via `electron-rebuild`.                         |
| `express`                       | `^5.2.1`        | HTTP server for MCP transport                                                                                               |
| `jsonc-parser`                  | `^3.3.1`        | JSONC parsing for OpenCode config — externalized in the main-process build.                                                 |
| `sql.js`                        | _n/a (legacy)_  | (Historical — see DATABASE.md; current DB is `better-sqlite3`.)                                                             |
| `zod`                           | `^4.3.6`        | Runtime schema validation                                                                                                   |

### OpenCode subprocess prerequisites

The committed Mode C runtime ships a per-platform native `opencode` binary that the main process spawns at startup. Before a packaged build will succeed, the binary must be staged and the platform-specific native pty packages must be present.

**Per-platform native `opencode` binary.** `npm run copy:opencode-bin` populates `resources/opencode-bin/<platform>-<arch>/opencode[.exe]`. Source priority:

1. `--local-source <path>` flag.
2. `OPENCODE_LOCAL_SOURCE` environment variable.
3. Default local checkout at `~/Desktop/opencode` (script reads `packages/opencode/dist/opencode-<platform>-<arch>/bin/opencode[.exe]`).
4. Fallback: fetches the version pinned in `desktop/resources/opencode-bin/manifest.json` from the `anomalyco/opencode` GitHub release.

`chmod +x` is applied automatically on POSIX targets.

**Auto-prune (asar-bloat fix).** After staging the binary for the current run's targets, the script invokes `pruneForeignTargets()` which deletes any other `<platform>-<arch>/` directory under `resources/opencode-bin/`. This is **load-bearing**, not cosmetic:

- electron-builder's default file-include glob picks up everything under the project root, and `files` exclusion patterns like `"!resources/opencode-bin/**"` are ignored when an `extraResources` entry references the same path — the directory gets force-included into `app.asar` anyway.
- With all six platform binaries staged on disk, a `package:mac` run produced an `app.asar` containing **686 MB of foreign-platform binary directories** on top of the 99 MB host binary already extracted to `Resources/`. Pre-build pruning is the only reliable fix: electron-builder can't pack what isn't on disk.
- Measured impact on a macOS arm64 build: DMG **415 MB → 180 MB** (−57%), `app.asar` **871 MB → 184 MB**, `.app` **1.2 GB → 516 MB** (−58%).

Pruning behaviour:

| Invocation                                                                                                                                                  | Pruned?                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `package`, `package:mac`, `package:mac-arm64`, `package:mac-x64`, `package:win`, `package:linux`, `package:dir`, or any explicit `--platform`/`--arch` pair | Yes — keeps only the run's targets |
| `--all` (cross-build, every platform staged intentionally)                                                                                                  | No (skipped)                       |
| `--no-prune` (escape hatch for debugging or multi-run staging across separate invocations)                                                                  | No (skipped)                       |

`manifest.json` and any non-directory entries in `resources/opencode-bin/` are always preserved.

> **Mode A reactivation.** If a future maintainer flips `RUNTIME_KIND` back to `'in-process-utility'` in `desktop/src/main/opencode/runtime-mode.ts`, the build will fail at runtime via the stub thrown by the `opencode:virtual-server-module` Vite plugin. The reactivation steps are: restore `desktop/scripts/copy-opencode-node.mjs`, re-add the `resources/opencode-node/**` glob to `extraResources` in `desktop/package.json`, and restore the original `opencode:virtual-server-module` and `opencode:copy-server-assets` plugins in `electron.vite.config.ts`.

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
