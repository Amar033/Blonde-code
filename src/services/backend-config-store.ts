import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { BackendType } from './backend-detector.js';
import type { InstallMethod } from './backend-installer.js';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────
export interface FlagDef {
  key:     string;  // actual flag name, e.g. 'max-model-len'
  label:   string;  // short display label
  default: string;
  desc:    string;
}

export interface BackendConfig {
  model:  string;
  method: InstallMethod;
  flags:  Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────
// Flag definitions per backend
// ─────────────────────────────────────────────────────────────────
export const FLAG_DEFS: Record<BackendType, FlagDef[]> = {
  ollama:   [],  // Ollama flags are per-model via Modelfile, not server flags
  lmstudio: [],  // LM Studio is a desktop app — no CLI flags
  airllm: [
    { key: 'max-new-tokens', label: 'max-tokens', default: '512',  desc: 'Default max new tokens per response' },
    { key: 'max-length',     label: 'max-input',  default: '2048', desc: 'Max input context length (tokens)'  },
  ],
  llamacpp: [
    { key: 'n_gpu_layers', label: 'gpu-layers',  default: '-1',   desc: 'GPU layers to offload (-1 = all)'  },
    { key: 'n_ctx',        label: 'context',      default: '8192', desc: 'Context window size'               },
    { key: 'n_batch',      label: 'batch',        default: '512',  desc: 'Prompt batch size'                 },
    { key: 'flash_attn',   label: 'flash-attn',   default: 'true', desc: 'Enable Flash Attention'            },
  ],
  vllm: [
    { key: 'max-model-len',          label: 'max-ctx',     default: '8192', desc: 'Max context window'               },
    { key: 'gpu-memory-utilization', label: 'gpu-mem',     default: '0.90', desc: 'GPU VRAM fraction (0.1–1.0)'      },
    { key: 'dtype',                  label: 'dtype',       default: 'auto', desc: 'float16 / bfloat16 / fp8 / auto'  },
    { key: 'quantization',           label: 'quant',       default: '',     desc: 'awq, fp8, bitsandbytes (blank=off)'},
    { key: 'tensor-parallel-size',   label: 'tensor-par',  default: '1',    desc: 'Number of GPUs'                   },
  ],
  sglang: [
    { key: 'context-length',       label: 'ctx-len',     default: '8192', desc: 'Max context window'               },
    { key: 'mem-fraction-static',  label: 'gpu-mem',     default: '0.90', desc: 'GPU VRAM fraction (0.1–1.0)'      },
    { key: 'dtype',                label: 'dtype',       default: 'auto', desc: 'float16 / bfloat16 / fp8 / auto'  },
    { key: 'tp',                   label: 'tensor-par',  default: '1',    desc: 'Tensor parallelism (num GPUs)'     },
    { key: 'chunked-prefill-size', label: 'prefill',     default: '8192', desc: 'Chunked prefill size'              },
  ],
};

// ─────────────────────────────────────────────────────────────────
// Persistence
// ─────────────────────────────────────────────────────────────────
const CONFIG_DIR = join(homedir(), '.blonde', 'backend-configs');

export async function loadConfig(type: BackendType): Promise<BackendConfig | null> {
  try {
    const raw = await fs.readFile(join(CONFIG_DIR, `${type}.json`), 'utf-8');
    return JSON.parse(raw) as BackendConfig;
  } catch {
    return null;
  }
}

export async function saveConfig(type: BackendType, config: BackendConfig): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(
    join(CONFIG_DIR, `${type}.json`),
    JSON.stringify(config, null, 2),
    'utf-8'
  );
}

// ─────────────────────────────────────────────────────────────────
// Build the docker run args with stored flags applied
// ─────────────────────────────────────────────────────────────────
export function buildDockerArgs(
  type:  BackendType,
  model: string,
  flags: Record<string, string>,
): string[] {
  const home = process.env.HOME ?? '/root';

  if (type === 'vllm') {
    const args = [
      'run', '--rm', '--runtime', 'nvidia', '--gpus', 'all',
      '-v', `${home}/.cache/huggingface:/root/.cache/huggingface`,
      '-p', '8000:8000', '--name', 'blonde-vllm', '-d',
      'vllm/vllm-openai:latest', '--model', model,
    ];
    if (flags['max-model-len'])           args.push('--max-model-len',          flags['max-model-len']);
    if (flags['gpu-memory-utilization'])  args.push('--gpu-memory-utilization', flags['gpu-memory-utilization']);
    if (flags['dtype'])                   args.push('--dtype',                  flags['dtype']);
    if (flags['quantization'])            args.push('--quantization',           flags['quantization']);
    if (flags['tensor-parallel-size'] && flags['tensor-parallel-size'] !== '1') {
      args.push('--tensor-parallel-size', flags['tensor-parallel-size']);
    }
    return args;
  }

  if (type === 'sglang') {
    const args = [
      'run', '--rm', '--gpus', 'all', '-p', '30000:30000',
      '--name', 'blonde-sglang', '-d', 'lmsysorg/sglang:latest',
      'python3', '-m', 'sglang.launch_server',
      '--model-path', model, '--host', '0.0.0.0', '--port', '30000',
    ];
    if (flags['context-length'])      args.push('--context-length',      flags['context-length']);
    if (flags['mem-fraction-static']) args.push('--mem-fraction-static', flags['mem-fraction-static']);
    if (flags['dtype'])               args.push('--dtype',               flags['dtype']);
    if (flags['tp'] && flags['tp'] !== '1') args.push('--tp', flags['tp']);
    return args;
  }

  return [];
}

// ─────────────────────────────────────────────────────────────────
// Build native start command string with stored flags
// ─────────────────────────────────────────────────────────────────
export function buildNativeStartCmd(
  type:    BackendType,
  model:   string,
  flags:   Record<string, string>,
  hasCuda: boolean,
): string {
  if (type === 'llamacpp') {
    const parts = [`python3 -m llama_cpp.server --model "${model}" --port 8080`];
    if (flags['n_gpu_layers']) parts.push(`--n_gpu_layers ${flags['n_gpu_layers']}`);
    else if (hasCuda)          parts.push('--n_gpu_layers -1');
    if (flags['n_ctx'])        parts.push(`--n_ctx ${flags['n_ctx']}`);
    if (flags['n_batch'])      parts.push(`--n_batch ${flags['n_batch']}`);
    if (flags['flash_attn'] === 'true') parts.push('--flash_attn true');
    parts.push('&');
    return parts.join(' ');
  }
  if (type === 'vllm') {
    const parts = [`python3 -m vllm.entrypoints.openai.api_server --model "${model}" --port 8000`];
    if (flags['max-model-len'])          parts.push(`--max-model-len ${flags['max-model-len']}`);
    if (flags['gpu-memory-utilization']) parts.push(`--gpu-memory-utilization ${flags['gpu-memory-utilization']}`);
    if (flags['dtype'])                  parts.push(`--dtype ${flags['dtype']}`);
    if (flags['quantization'])           parts.push(`--quantization ${flags['quantization']}`);
    parts.push('&');
    return parts.join(' ');
  }
  if (type === 'sglang') {
    const parts = [`python3 -m sglang.launch_server --model-path "${model}" --port 30000 --host 0.0.0.0`];
    if (flags['context-length'])      parts.push(`--context-length ${flags['context-length']}`);
    if (flags['mem-fraction-static']) parts.push(`--mem-fraction-static ${flags['mem-fraction-static']}`);
    if (flags['dtype'])               parts.push(`--dtype ${flags['dtype']}`);
    if (flags['tp'])                  parts.push(`--tp ${flags['tp']}`);
    parts.push('&');
    return parts.join(' ');
  }
  return '';
}

// ─────────────────────────────────────────────────────────────────
// Build a combined stop + restart shell command (used by switch + configure)
// ─────────────────────────────────────────────────────────────────
export function buildSwitchShellCmd(
  type:    BackendType,
  method:  InstallMethod,
  model:   string,
  flags:   Record<string, string>,
  hasCuda: boolean,
): string {
  const stopPart: Record<BackendType, string> = {
    ollama:   'pkill -f "ollama serve" 2>/dev/null; sleep 1',
    vllm:     'docker stop blonde-vllm 2>/dev/null; docker rm blonde-vllm 2>/dev/null; sleep 1',
    llamacpp: 'pkill -f "llama_cpp.server" 2>/dev/null; sleep 1',
    sglang:   'docker stop blonde-sglang 2>/dev/null; docker rm blonde-sglang 2>/dev/null; sleep 1',
    lmstudio: 'true',  // LM Studio is a desktop app — cannot stop programmatically
    airllm:   'pkill -f "airllm_server.py" 2>/dev/null; sleep 1',
  };

  const startPart =
    method === 'docker'
      ? `docker ${buildDockerArgs(type, model, flags).join(' ')}`
      : buildNativeStartCmd(type, model, flags, hasCuda);

  return `${stopPart[type]}; ${startPart}`;
}
