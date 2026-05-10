/**
 * Ambient type declaration for the `virtual:opencode-server` module.
 *
 * At build/dev time, electron-vite's `opencode:virtual-server-module` plugin
 * rewrites this specifier to the prebuilt OpenCode Node bundle at
 * `resources/opencode-node/node.js` (produced by `bun run script/build-node.ts`
 * inside the opencode repo, copied here via `npm run copy:opencode-node`).
 *
 * The bundle's runtime entrypoint is `packages/opencode/src/node.ts` which
 * exports `Server`, `Log`, `Config`, `Database`, `JsonMigration`, `bootstrap`.
 *
 * We only declare the surface we actually use (`Server.listen`, `Log.init`).
 * Shapes mirror the upstream contract — see
 * `packages/opencode/src/server/server.ts` in the opencode repo.
 *
 * IMPORTANT: this module declaration must stay co-located with the only
 * file that actually imports `virtual:opencode-server` —
 * `runtime-in-process.ts`. Other files MUST NOT import the virtual module
 * directly; go through the `OpenCodeRuntime` facade instead.
 */
declare module 'virtual:opencode-server' {
  export namespace Server {
    export interface ListenOptions {
      port: number;
      hostname: string;
      mdns?: boolean;
      mdnsDomain?: string;
      cors?: string[];
    }

    export interface Listener {
      url: string;
      stop: () => Promise<void> | void;
    }

    export function listen(options: ListenOptions): Promise<Listener>;
  }

  export namespace Log {
    export interface InitOptions {
      level?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
      print?: boolean;
    }
    export function init(options?: InitOptions): Promise<void>;
  }
}
