import os from 'os';
import { spawn } from 'child_process';

interface RunResult {
  stdout: string;
}

function runCommand(
  command: string,
  args: string[],
  input?: string,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout });
        return;
      }

      reject(
        new Error(
          `Command "${command} ${args.join(' ')}" failed with code ${code}: ${stderr || 'no stderr output'}`,
        ),
      );
    });

    if (typeof input === 'string') {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

export async function copyTextToClipboard(text: string): Promise<void> {
  const platform = os.platform();

  if (platform === 'darwin') {
    await runCommand('pbcopy', [], text);
    return;
  }

  if (platform === 'linux') {
    await runCommand('xclip', ['-selection', 'clipboard'], text);
    return;
  }

  if (platform === 'win32') {
    await runCommand('clip', [], text);
    return;
  }

  throw new Error(`Clipboard copy is not supported on platform: ${platform}`);
}

export async function readTextFromClipboard(): Promise<string> {
  const platform = os.platform();

  if (platform === 'darwin') {
    const result = await runCommand('pbpaste', []);
    return result.stdout;
  }

  if (platform === 'linux') {
    const result = await runCommand('xclip', ['-selection', 'clipboard', '-o']);
    return result.stdout;
  }

  if (platform === 'win32') {
    const result = await runCommand('powershell', [
      '-NoProfile',
      '-Command',
      'Get-Clipboard -Raw',
    ]);
    return result.stdout;
  }

  throw new Error(`Clipboard paste is not supported on platform: ${platform}`);
}
