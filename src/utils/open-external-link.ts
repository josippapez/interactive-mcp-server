import os from 'node:os';
import { spawn } from 'node:child_process';

interface OpenCommand {
  command: string;
  args: string[];
}

type EditorTarget = 'default' | 'vscode' | 'vscode-insiders';

const normalizeEditorUrl = (url: string, target: EditorTarget): string => {
  if (target === 'default') {
    return url;
  }

  if (!/^vscode(-insiders)?:\/\//.test(url)) {
    return url;
  }

  if (target === 'vscode') {
    return url.replace(/^vscode-insiders:\/\//, 'vscode://');
  }

  return url.replace(/^vscode:\/\//, 'vscode-insiders://');
};

const getOpenCommand = (url: string): OpenCommand => {
  const platform = os.platform();

  if (platform === 'darwin') {
    return { command: 'open', args: [url] };
  }

  if (platform === 'linux') {
    return { command: 'xdg-open', args: [url] };
  }

  if (platform === 'win32') {
    return { command: 'cmd', args: ['/c', 'start', '', url] };
  }

  throw new Error(`Opening links is not supported on platform: ${platform}`);
};

export async function openExternalLink(
  url: string,
  target: EditorTarget = 'default',
): Promise<void> {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    throw new Error('Cannot open an empty link.');
  }

  const targetUrl = normalizeEditorUrl(trimmedUrl, target);
  const { command, args } = getOpenCommand(targetUrl);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'ignore',
      detached: true,
    });

    child.once('error', (error) => {
      reject(error);
    });

    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
