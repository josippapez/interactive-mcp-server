/**
 * Main-side barrel for the OpenCode layer.
 *
 * After Phase 4b, the only main-resident opencode file is `./health`
 * (the startup/watchdog HTTP probe). All SDK and server lifecycle helpers
 * live in the utility process and are accessed via dedicated proxy
 * clients (`utility/opencode-client.ts`, `utility/opencode-server-client.ts`).
 * Import those directly in new code — this barrel exists only to keep the
 * watchdog health helper discoverable.
 */

export { checkOpenCodeHealth, type OpenCodeHealthStatus } from './health';
