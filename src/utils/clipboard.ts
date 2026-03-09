import os from 'os';
import { spawn } from 'child_process';

interface RunResult {
  stdout: string;
}

function decodeFileUri(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('file://')) {
    return trimmed;
  }

  return decodeURIComponent(trimmed.replace(/^file:\/\//, ''));
}

function normalizePathCandidate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const decoded = decodeFileUri(trimmed);
  if (decoded.startsWith('/')) {
    return decoded;
  }

  if (/^[a-zA-Z]:[\\/]/.test(decoded)) {
    return decoded;
  }

  return null;
}

function parseNonEmptyLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => Boolean(line) && !line.startsWith('#'));
}

function parseFilePaths(value: string): string[] {
  return parseNonEmptyLines(value)
    .map((line) => normalizePathCandidate(line))
    .filter((line): line is string => typeof line === 'string');
}

function uniquePaths(values: string[]): string[] {
  return Array.from(new Set(values));
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

export async function readFilePathsFromClipboard(): Promise<string[]> {
  const platform = os.platform();

  if (platform === 'darwin') {
    const aliasResult = await runCommand('osascript', [
      '-e',
      'try',
      '-e',
      'POSIX path of (the clipboard as alias)',
      '-e',
      'on error',
      '-e',
      'return ""',
      '-e',
      'end try',
    ]);
    const aliasPaths = parseFilePaths(aliasResult.stdout);
    if (aliasPaths.length > 0) {
      return aliasPaths;
    }

    const listResult = await runCommand('osascript', [
      '-e',
      'try',
      '-e',
      'set L to the clipboard as list',
      '-e',
      'set out to {}',
      '-e',
      'repeat with i in L',
      '-e',
      'set end of out to POSIX path of i',
      '-e',
      'end repeat',
      '-e',
      'set text item delimiters of AppleScript to linefeed',
      '-e',
      'return out as text',
      '-e',
      'on error',
      '-e',
      'return ""',
      '-e',
      'end try',
    ]);
    const listPaths = parseFilePaths(listResult.stdout);
    if (listPaths.length > 0) {
      return listPaths;
    }

    const jxaResult = await runCommand('osascript', [
      '-l',
      'JavaScript',
      '-e',
      'ObjC.import("AppKit")',
      '-e',
      'ObjC.import("Foundation")',
      '-e',
      'const pb = $.NSPasteboard.generalPasteboard',
      '-e',
      'const classes = $.NSArray.arrayWithObject($.NSURL)',
      '-e',
      'const urls = pb.readObjectsForClassesOptions(classes, $())',
      '-e',
      'if (!urls || urls.count === 0) { "" } else { const out = []; for (let i = 0; i < urls.count; i += 1) { out.push(ObjC.unwrap(urls.objectAtIndex(i).path)); } out.join("\\n"); }',
    ]);
    const jxaPaths = parseFilePaths(jxaResult.stdout);
    if (jxaPaths.length > 0) {
      return uniquePaths(jxaPaths);
    }

    const jxaTypeProbeResult = await runCommand('osascript', [
      '-l',
      'JavaScript',
      '-e',
      'ObjC.import("AppKit")',
      '-e',
      'ObjC.import("Foundation")',
      '-e',
      'const pb = $.NSPasteboard.generalPasteboard',
      '-e',
      'const out = []',
      '-e',
      'const pushLine = (value) => { if (!value) { return; } const text = String(value).trim(); if (!text) { return; } out.push(text); }',
      '-e',
      'const types = ObjC.deepUnwrap(pb.types) || []',
      '-e',
      'for (const type of types) { const data = pb.dataForType(type); if (!data || data.isNil()) { continue; } let text = ""; const utf8 = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding); if (utf8 && !utf8.isNil()) { text = ObjC.unwrap(utf8); } if (!text) { const utf16 = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF16StringEncoding); if (utf16 && !utf16.isNil()) { text = ObjC.unwrap(utf16); } } if (!text) { continue; } const lines = String(text).split(/\\r?\\n/); for (const line of lines) { const trimmed = line.trim(); if (!trimmed || trimmed.startsWith("#")) { continue; } pushLine(trimmed); } }',
      '-e',
      'out.join("\\n")',
    ]);
    return uniquePaths(parseFilePaths(jxaTypeProbeResult.stdout));
  }

  if (platform === 'linux') {
    try {
      const uriListResult = await runCommand('xclip', [
        '-selection',
        'clipboard',
        '-o',
        '-t',
        'text/uri-list',
      ]);
      return parseFilePaths(uriListResult.stdout);
    } catch {
      return [];
    }
  }

  if (platform === 'win32') {
    try {
      const fileDropResult = await runCommand('powershell', [
        '-NoProfile',
        '-Command',
        '$paths = Get-Clipboard -Format FileDropList; if ($paths) { $paths | ForEach-Object { $_.FullName } }',
      ]);
      return parseFilePaths(fileDropResult.stdout);
    } catch {
      return [];
    }
  }

  return [];
}

export async function readImageDataUrlFromClipboard(): Promise<string | null> {
  const platform = os.platform();
  if (platform !== 'darwin') {
    return null;
  }

  try {
    const imageResult = await runCommand('osascript', [
      '-l',
      'JavaScript',
      '-e',
      'ObjC.import("AppKit")',
      '-e',
      'ObjC.import("Foundation")',
      '-e',
      'const pb = $.NSPasteboard.generalPasteboard',
      '-e',
      'const image = $.NSImage.alloc.initWithPasteboard(pb)',
      '-e',
      'if (!image || image.isNil()) { "" } else { const tiff = image.TIFFRepresentation; if (!tiff || tiff.isNil()) { "" } else { const rep = $.NSBitmapImageRep.imageRepWithData(tiff); if (!rep || rep.isNil()) { "" } else { const pngData = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $()); if (!pngData || pngData.isNil()) { "" } else { ObjC.unwrap(pngData.base64EncodedStringWithOptions(0)); } } } }',
    ]);
    const base64Payload = imageResult.stdout.trim();
    if (!base64Payload) {
      return null;
    }

    return `data:image/png;base64,${base64Payload}`;
  } catch {
    return null;
  }
}
