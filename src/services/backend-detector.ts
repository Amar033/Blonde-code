import { exec as execCb } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execCb);

export type BackendType   = 'ollama' | 'vllm' | 'llamacpp' | 'sglang' | 'lmstudio' | 'airllm';
export type BackendStatus = 'running' | 'installed' | 'not-installed';

export interface DetectedModel {
  id:    string;
  size?: string;
}

export interface BackendInfo {
  type:            BackendType;
  label:           string;
  port:            number;
  status:          BackendStatus;
  models:          DetectedModel[];
  runningInDocker: boolean;
}

export interface SystemCapabilities {
  hasCuda:                   boolean;
  hasDocker:                 boolean;
  hasNvidiaContainerToolkit: boolean;
  pythonVersion?:            string;
}

const DEFS: Array<{ type: BackendType; label: string; port: number }> = [
  { type: 'ollama',   label: 'Ollama',          port: 11434 },
  { type: 'vllm',    label: 'vLLM',             port: 8000  },
  { type: 'llamacpp', label: 'llama.cpp server', port: 8080  },
  { type: 'sglang',  label: 'SGLang',           port: 30000 },
  { type: 'lmstudio', label: 'LM Studio',        port: 1234  },
  { type: 'airllm',  label: 'AirLLM',           port: 8002  },
];

async function probeHttp(port: number, path: string): Promise<{ ok: boolean; data?: any }> {
  try {
    const res = await fetch(`http://localhost:${port}${path}`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return { ok: false };
    return { ok: true, data: await res.json() };
  } catch {
    return { ok: false };
  }
}

function parseModels(type: BackendType, data: any): DetectedModel[] {
  if (!data) return [];
  if (type === 'ollama') {
    return (data.models ?? []).map((m: any) => ({
      id:   m.name as string,
      size: m.size ? `${(m.size / 1e9).toFixed(1)} GB` : undefined,
    }));
  }
  return (data.data ?? []).map((m: any) => ({ id: m.id as string }));
}

async function tryExec(cmd: string): Promise<boolean> {
  try { await exec(cmd); return true; } catch { return false; }
}

async function isInstalled(type: BackendType): Promise<boolean> {
  switch (type) {
    case 'ollama':
      return tryExec('which ollama');
    case 'llamacpp':
      if (await tryExec('which llama-server')) return true;
      return tryExec('pip3 show llama-cpp-python 2>/dev/null || pip show llama-cpp-python 2>/dev/null');
    case 'vllm':
      return tryExec('pip3 show vllm 2>/dev/null || pip show vllm 2>/dev/null');
    case 'sglang':
      return tryExec('pip3 show sglang 2>/dev/null || pip show sglang 2>/dev/null');
    case 'lmstudio': {
      const home = process.env.HOME ?? '';
      // Process running?
      if (await tryExec('pgrep -if "lmstudio" 2>/dev/null')) return true;
      // CLI tool (lms) in PATH?
      if (await tryExec('which lms 2>/dev/null')) return true;
      // Binary in PATH?
      if (await tryExec('which lmstudio 2>/dev/null')) return true;
      // Config dir exists (app has been launched before)?
      if (await tryExec(`test -d "${home}/.config/LM Studio"`)) return true;
      // AppImage in home?
      if (await tryExec(`ls "${home}"/LM*Studio*.AppImage 2>/dev/null | head -1 | grep -q .`)) return true;
      return false;
    }
    case 'airllm':
      return tryExec('pip3 show airllm 2>/dev/null || pip show airllm 2>/dev/null');
  }
}

async function runningInDocker(containerName: string): Promise<boolean> {
  try {
    const { stdout } = await exec(
      `docker ps --filter "name=${containerName}" --format "{{.Names}}" 2>/dev/null`
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function detectBackends(): Promise<BackendInfo[]> {
  return Promise.all(
    DEFS.map(async (def) => {
      const apiPath       = def.type === 'ollama' ? '/api/tags' : '/v1/models';
      const { ok, data }  = await probeHttp(def.port, apiPath);

      if (ok) {
        return {
          ...def,
          status:          'running' as const,
          models:          parseModels(def.type, data),
          runningInDocker: await runningInDocker(`blonde-${def.type}`),
        };
      }

      return {
        ...def,
        status:          (await isInstalled(def.type)) ? 'installed' as const : 'not-installed' as const,
        models:          [],
        runningInDocker: false,
      };
    })
  );
}

export async function checkSystemCapabilities(): Promise<SystemCapabilities> {
  const [hasCuda, hasDocker, hasNct, pyVer] = await Promise.all([
    tryExec('nvidia-smi'),
    tryExec('docker info 2>/dev/null'),
    tryExec('docker info 2>/dev/null | grep -qi nvidia && echo yes'),
    exec('python3 --version 2>/dev/null').then(({ stdout }) => stdout.trim()).catch(() => undefined),
  ]);
  return {
    hasCuda,
    hasDocker,
    hasNvidiaContainerToolkit: hasNct,
    pythonVersion:             pyVer,
  };
}
