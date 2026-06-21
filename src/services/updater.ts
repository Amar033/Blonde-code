import { writeFileSync, renameSync, chmodSync } from 'fs';
import { VERSION, GITHUB_REPO } from '../version.js';

export interface UpdateInfo {
  version: string;   // "v1.2.0"
  downloadUrl: string;
  hasUpdate: boolean;
}

// Stored here so StartupScreen can set it and WelcomeScreen can read it
// without prop-drilling across the whole tree.
let _pendingUpdate: UpdateInfo | null = null;
export function getPendingUpdate(): UpdateInfo | null { return _pendingUpdate; }
export function clearPendingUpdate(): void { _pendingUpdate = null; }

function platformAsset(): string {
  const os   = process.platform; // 'linux' | 'darwin' | 'win32'
  const arch = process.arch;     // 'x64' | 'arm64'
  const name = os === 'darwin' ? 'darwin' : os === 'win32' ? 'windows' : 'linux';
  const a    = arch === 'arm64' ? 'arm64' : 'x64';
  const ext  = os === 'win32' ? '.exe' : '';
  return `blonde-${name}-${a}${ext}`;
}

function isNewer(a: string, b: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const [aMaj, aMin, aPat] = parse(a);
  const [bMaj, bMin, bPat] = parse(b);
  if (aMaj !== bMaj) return aMaj > bMaj;
  if (aMin !== bMin) return aMin > bMin;
  return aPat > bPat;
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  // Don't check in dev mode (no compiled binary to replace)
  if ((VERSION as string) === 'dev') return null;

  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        signal: AbortSignal.timeout(4000),
        headers: { 'User-Agent': `blonde/${VERSION}` },
      }
    );
    if (!res.ok) return null;

    const data = await res.json() as {
      tag_name: string;
      assets: Array<{ name: string; browser_download_url: string }>;
    };

    const latestTag = data.tag_name; // "v1.2.0"
    if (!isNewer(latestTag, VERSION)) return null;

    const assetName = platformAsset();
    const asset = data.assets.find(a => a.name === assetName);
    if (!asset) return null;

    const info: UpdateInfo = {
      version: latestTag,
      downloadUrl: asset.browser_download_url,
      hasUpdate: true,
    };
    _pendingUpdate = info;
    return info;
  } catch {
    return null;
  }
}

export async function downloadAndInstall(
  info: UpdateInfo,
  onProgress?: (pct: number) => void
): Promise<void> {
  const execPath = process.execPath; // path to the running blonde binary
  const tmpPath  = execPath + '.update';

  const res = await fetch(info.downloadUrl, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);

  const total   = Number(res.headers.get('content-length') ?? 0);
  let received  = 0;
  const chunks: Uint8Array[] = [];
  const reader  = res.body!.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total > 0 && onProgress) onProgress(Math.round((received / total) * 100));
  }

  const buf = Buffer.concat(chunks);
  writeFileSync(tmpPath, buf);
  chmodSync(tmpPath, 0o755);

  // Atomic replace — works on Linux/macOS even while the binary is running
  renameSync(tmpPath, execPath);

  _pendingUpdate = null;
}
