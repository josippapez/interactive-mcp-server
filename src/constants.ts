/**
 * Shared constants for the application.
 */

/**
 * Timeout duration in seconds for waiting for user input in both single-input and intensive chat modes.
 * This aligns with the default timeout expected by the MCP tool.
 */
export const USER_INPUT_TIMEOUT_SECONDS = 60;

/**
 * Sentinel string written by UI processes when a prompt times out.
 * This should be handled consistently across command and tool layers.
 */
export const USER_INPUT_TIMEOUT_SENTINEL = '__TIMEOUT__';
