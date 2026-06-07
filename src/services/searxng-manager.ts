import { execSync, execFileSync } from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

const CONTAINER_NAME = 'blonde-searxng';
const HOST_PORT      = 8888;
const BASE_URL       = `http://localhost:${HOST_PORT}`;
const IMAGE          = 'searxng/searxng';

// ── Runtime detection ───────────────────────────────────────────────────────

type ContainerRuntime = 'docker' | 'podman' | null;

/**
 * Finds the first available container runtime.
 * podman-docker installs a `docker` shim, so `docker` covers both.
 * We check `podman` explicitly as a fallback in case only native podman is present.
 */
function detectRuntime(): ContainerRuntime {
  for (const cmd of ['docker', 'podman']) {
    try {
      // `docker info` exits 0 on both Docker and podman-docker; we don't parse the output
      execFileSync(cmd, ['info'], { stdio: 'pipe', timeout: 5000 });
      return cmd as ContainerRuntime;
    } catch (e: any) {
      const stderr = (e.stderr?.toString() ?? '').toLowerCase();
      const stdout = (e.stdout?.toString() ?? '').toLowerCase();
      const combined = stderr + stdout;

      if (combined.includes('permission denied') || combined.includes('connect: permission')) {
        throw new SetupError(
          `Docker is installed but your user can't access the socket.\n` +
          `Run these commands then open a new terminal:\n` +
          `  sudo usermod -aG docker $USER\n` +
          `  sudo chgrp docker /var/run/docker.sock`
        );
      }

      if (combined.includes('cannot connect') || combined.includes('is the docker daemon running')) {
        throw new SetupError(
          `Docker daemon is not running.\n` +
          `Start it with:  sudo systemctl start docker\n` +
          `Or for snap Docker:  sudo systemctl start snap.docker.dockerd`
        );
      }

      // Binary not in PATH — try next runtime
    }
  }
  return null;
}

class SetupError extends Error {}

// ── Container lifecycle ─────────────────────────────────────────────────────

async function containerStatus(cmd: string): Promise<'running' | 'stopped' | 'missing'> {
  try {
    const { stdout } = await execAsync(
      `${cmd} ps -a --filter name=^/${CONTAINER_NAME}$ --format "{{.Status}}"`,
      { timeout: 5000 }
    );
    const status = stdout.trim();
    if (!status) return 'missing';
    return status.toLowerCase().startsWith('up') ? 'running' : 'stopped';
  } catch {
    // podman uses a different filter syntax — try without anchor
    try {
      const { stdout } = await execAsync(
        `${cmd} ps -a --filter name=${CONTAINER_NAME} --format "{{.Status}}"`,
        { timeout: 5000 }
      );
      const lines = stdout.trim().split('\n').filter(Boolean);
      if (!lines.length) return 'missing';
      return lines[0].toLowerCase().startsWith('up') ? 'running' : 'stopped';
    } catch {
      return 'missing';
    }
  }
}

async function waitForHealth(retries = 8, delayMs = 1500): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${BASE_URL}/healthz`, { signal: controller.signal });
      clearTimeout(t);
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise(r => setTimeout(r, delayMs));
  }
  return false;
}

// ── Public API ──────────────────────────────────────────────────────────────

export type SearXNGStatus =
  | { ok: true;  url: string; started: boolean }
  | { ok: false; reason: string };

/**
 * Ensure the SearXNG search container is running.
 * Works with Docker (native or via snap), Podman, or podman-docker.
 * Returns the local base URL on success, or a human-readable reason on failure.
 * Falls back gracefully — callers should use DuckDuckGo when this returns ok:false.
 */
export async function ensureSearXNG(
  onLog?: (msg: string, level?: 'info' | 'ok' | 'warn' | 'error') => void
): Promise<SearXNGStatus> {
  const log = (msg: string, level: 'info' | 'ok' | 'warn' | 'error' = 'info') =>
    onLog?.(msg, level);

  // If user manually set the URL, trust it and skip container management
  if (process.env.SEARXNG_BASE_URL) {
    log('Using configured search URL', 'ok');
    return { ok: true, url: process.env.SEARXNG_BASE_URL, started: false };
  }

  log('Detecting container runtime...');

  let runtime: ContainerRuntime;
  try {
    runtime = detectRuntime();
  } catch (e: any) {
    if (e instanceof SetupError) {
      const firstLine = e.message.split('\n')[0];
      log(firstLine, 'error');
      return { ok: false, reason: e.message };
    }
    log(`Runtime check failed: ${e.message}`, 'error');
    return { ok: false, reason: `Container runtime error: ${e.message}` };
  }

  if (!runtime) {
    log('No container runtime found — using DuckDuckGo', 'warn');
    return {
      ok: false,
      reason:
        'No container runtime found — install Docker or Podman to enable SearXNG.\n' +
        '  Ubuntu/Pop!_OS: sudo apt install podman-docker   (rootless, recommended)\n' +
        '  Or: sudo apt install docker.io  then  sudo usermod -aG docker $USER',
    };
  }

  log(`Found ${runtime}`, 'ok');
  log(`Checking ${CONTAINER_NAME} container...`);

  const status = await containerStatus(runtime);

  if (status === 'running') {
    log('Container already running', 'ok');
    process.env.SEARXNG_BASE_URL = BASE_URL;
    return { ok: true, url: BASE_URL, started: false };
  }

  if (status === 'stopped') {
    log('Container stopped — restarting...');
    try {
      await execAsync(`${runtime} start ${CONTAINER_NAME}`, { timeout: 15000 });
      log('Container started', 'ok');
    } catch (e: any) {
      log(`Failed to start container: ${e.message.split('\n')[0]}`, 'error');
      return { ok: false, reason: `Failed to start SearXNG container: ${e.message}` };
    }
  } else {
    log('Container not found — creating (first run may pull image)...');
    try {
      await execAsync(
        `${runtime} run -d --name ${CONTAINER_NAME} -p ${HOST_PORT}:8080 ` +
        `-e SEARXNG_SECRET=blonde-local ${IMAGE}`,
        { timeout: 120000 }
      );
      log('Container created', 'ok');
    } catch (e: any) {
      // Race condition: two startups at once
      if (e.message?.includes('already in use') || e.message?.includes('already exists')) {
        try {
          await execAsync(`${runtime} start ${CONTAINER_NAME}`, { timeout: 15000 });
          log('Container started', 'ok');
        } catch (e2: any) {
          log(`Container conflict: ${e2.message.split('\n')[0]}`, 'error');
          return { ok: false, reason: `Container conflict: ${e2.message}` };
        }
      } else {
        log(`Failed to create container: ${e.message.split('\n')[0]}`, 'error');
        return { ok: false, reason: `Failed to create SearXNG container: ${e.message}` };
      }
    }
  }

  log('Waiting for health check...');
  const healthy = await waitForHealth();
  if (!healthy) {
    log('Health check timed out — using DuckDuckGo', 'warn');
    return {
      ok: false,
      reason: 'SearXNG container started but did not become healthy in time — using DuckDuckGo fallback',
    };
  }

  log(`Search engine ready on :${HOST_PORT}`, 'ok');
  process.env.SEARXNG_BASE_URL = BASE_URL;
  return { ok: true, url: BASE_URL, started: true };
}
