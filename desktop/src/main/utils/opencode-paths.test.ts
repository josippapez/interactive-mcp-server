import { describe, it, expect } from 'vitest';
import { homedir } from 'os';
import { join } from 'path';
import {
  getGlobalOpencodeDir,
  getProjectOpencodeDir,
  getGlobalAgentDir,
  getProjectAgentDir,
  getGlobalOpencodeConfigPath,
  getProjectOpencodeConfigPath,
} from './opencode-paths';

describe('opencode-paths', () => {
  it('getGlobalOpencodeDir returns ~/.config/opencode', () => {
    expect(getGlobalOpencodeDir()).toBe(join(homedir(), '.config', 'opencode'));
  });

  it('getProjectOpencodeDir returns <base>/.opencode', () => {
    expect(getProjectOpencodeDir('/tmp/proj')).toBe('/tmp/proj/.opencode');
  });

  it('getGlobalAgentDir returns ~/.config/opencode/agent', () => {
    expect(getGlobalAgentDir()).toBe(
      join(homedir(), '.config', 'opencode', 'agent'),
    );
  });

  it('getProjectAgentDir returns <base>/.opencode/agent', () => {
    expect(getProjectAgentDir('/tmp/proj')).toBe('/tmp/proj/.opencode/agent');
  });

  it('getGlobalOpencodeConfigPath returns ~/.config/opencode/opencode.json', () => {
    expect(getGlobalOpencodeConfigPath()).toBe(
      join(homedir(), '.config', 'opencode', 'opencode.json'),
    );
  });

  it('getProjectOpencodeConfigPath defaults to jsonc variant', () => {
    expect(getProjectOpencodeConfigPath('/tmp/proj')).toBe(
      '/tmp/proj/.opencode/opencode.jsonc',
    );
  });

  it('getProjectOpencodeConfigPath supports json variant', () => {
    expect(getProjectOpencodeConfigPath('/tmp/proj', 'json')).toBe(
      '/tmp/proj/.opencode/opencode.json',
    );
  });

  it('getProjectOpencodeConfigPath supports jsonc variant explicitly', () => {
    expect(getProjectOpencodeConfigPath('/tmp/proj', 'jsonc')).toBe(
      '/tmp/proj/.opencode/opencode.jsonc',
    );
  });
});
