/**
 * OpenCode SDK client factory.
 *
 * Provides a typed SDK client for interacting with the OpenCode HTTP API.
 * This replaces manual fetch calls with the official SDK methods.
 */

import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk';

// Singleton client for consistent port usage
let _client: OpencodeClient | null = null;
let _port = 4096;

// Client factory function - can be replaced in tests
let _clientFactory: (port: number, directory?: string) => OpencodeClient = (
  port: number,
  directory?: string,
) =>
  createOpencodeClient({
    baseUrl: `http://localhost:${port}`,
    directory,
  });

/**
 * Set a custom client factory for testing purposes.
 * @internal
 */
export function _setClientFactory(
  factory: (port: number, directory?: string) => OpencodeClient,
): void {
  _clientFactory = factory;
  _client = null; // Reset singleton
}

/**
 * Reset the client factory to the default implementation.
 * @internal
 */
export function _resetClientFactory(): void {
  _clientFactory = (port: number, directory?: string) =>
    createOpencodeClient({
      baseUrl: `http://localhost:${port}`,
      directory,
    });
  _client = null;
}

/**
 * Initialize the SDK client with a specific port.
 * Resets the client if the port changes.
 *
 * @param port - The port number where OpenCode server is running
 */
export function initSdkClient(port: number): void {
  if (_port !== port) {
    _port = port;
    _client = null;
  }
}

/**
 * Get the singleton SDK client, creating it if necessary.
 *
 * @returns Configured OpencodeClient instance
 */
export function getSdkClient(): OpencodeClient {
  if (!_client) {
    _client = _clientFactory(_port);
  }
  return _client;
}

/**
 * Get the current SDK port.
 *
 * @returns The port number the SDK client is configured for
 */
export function getSdkPort(): number {
  return _port;
}

/**
 * Create an OpenCode SDK client configured for a specific port.
 * This is a non-singleton version for cases where you need a client
 * for a different port than the singleton.
 *
 * @param port - The port number where OpenCode server is running
 * @returns Configured OpencodeClient instance
 */
export function getClient(port: number, directory?: string): OpencodeClient {
  return _clientFactory(port, directory);
}
