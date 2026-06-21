import { homedir } from 'os';
import { join } from 'path';
import type { BackendType } from './backend-detector.js';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────
export interface GgufFile {
  filename: string;
  quant:    string;  // e.g. 'Q4_K_M'
  sizeGb:   string;  // e.g. '4.9'
}

export interface CatalogModel {
  id:          string;
  name:        string;
  family:      string;
  desc:        string;
  tags:        string[];           // 'coding' | 'general' | 'fast' | 'reasoning' | 'draft'
  minVram:     string;             // minimum VRAM (Q4_K_M)
  ollama?:     string;             // ollama tag,  e.g. 'qwen3:8b'
  hfId?:       string;             // HuggingFace model ID for full-precision download (vLLM/SGLang)
  ggufRepo?:   string;             // HF repo for GGUF files (llama.cpp)
  ggufFiles?:  GgufFile[];         // available GGUF quantizations
  backends:    BackendType[];      // which backends support this model
}

// ─────────────────────────────────────────────────────────────────
// Curated catalog
// ─────────────────────────────────────────────────────────────────
export const CATALOG: CatalogModel[] = [
  {
    id: 'qwen3-8b', name: 'Qwen3 8B', family: 'Qwen3',
    desc: 'Best all-round local coding model. Strong reasoning, fast at Q4_K_M. Top pick for most hardware.',
    tags: ['coding', 'balanced'], minVram: '5.5 GB',
    ollama: 'qwen3:8b', hfId: 'Qwen/Qwen3-8B',
    ggufRepo: 'bartowski/Qwen3-8B-GGUF',
    ggufFiles: [
      { filename: 'Qwen3-8B-Q4_K_M.gguf', quant: 'Q4_K_M', sizeGb: '5.2' },
      { filename: 'Qwen3-8B-Q5_K_M.gguf', quant: 'Q5_K_M', sizeGb: '6.1' },
      { filename: 'Qwen3-8B-Q8_0.gguf',   quant: 'Q8_0',   sizeGb: '8.6' },
    ],
    backends: ['ollama', 'vllm', 'llamacpp', 'sglang'],
  },
  {
    id: 'qwen3-14b', name: 'Qwen3 14B', family: 'Qwen3',
    desc: 'Noticeably better reasoning than 8B. Good for architecture decisions and debugging. Needs ~10 GB VRAM.',
    tags: ['coding', 'reasoning'], minVram: '9.5 GB',
    ollama: 'qwen3:14b', hfId: 'Qwen/Qwen3-14B',
    ggufRepo: 'bartowski/Qwen3-14B-GGUF',
    ggufFiles: [
      { filename: 'Qwen3-14B-Q4_K_M.gguf', quant: 'Q4_K_M', sizeGb: '9.0' },
      { filename: 'Qwen3-14B-Q5_K_M.gguf', quant: 'Q5_K_M', sizeGb: '10.6' },
    ],
    backends: ['ollama', 'vllm', 'llamacpp', 'sglang'],
  },
  {
    id: 'qwen3-0.6b', name: 'Qwen3 0.6B', family: 'Qwen3',
    desc: 'Ultra-fast draft model. Use as the speculative-decoding draft for Qwen3 8B to get ~1.9× speed.',
    tags: ['draft', 'fast'], minVram: '0.5 GB',
    ollama: 'qwen3:0.6b', hfId: 'Qwen/Qwen3-0.6B',
    ggufRepo: 'bartowski/Qwen3-0.6B-GGUF',
    ggufFiles: [
      { filename: 'Qwen3-0.6B-Q4_K_M.gguf', quant: 'Q4_K_M', sizeGb: '0.4' },
      { filename: 'Qwen3-0.6B-Q8_0.gguf',   quant: 'Q8_0',   sizeGb: '0.7' },
    ],
    backends: ['ollama', 'llamacpp'],
  },
  {
    id: 'qwen3-32b', name: 'Qwen3 32B', family: 'Qwen3',
    desc: 'High-end reasoning model. Comparable to GPT-4 class on coding benchmarks. Needs 20+ GB VRAM.',
    tags: ['coding', 'reasoning'], minVram: '20 GB',
    ollama: 'qwen3:32b', hfId: 'Qwen/Qwen3-32B',
    ggufRepo: 'bartowski/Qwen3-32B-GGUF',
    ggufFiles: [
      { filename: 'Qwen3-32B-Q4_K_M.gguf', quant: 'Q4_K_M', sizeGb: '19.8' },
    ],
    backends: ['ollama', 'vllm', 'llamacpp', 'sglang'],
  },
  {
    id: 'llama31-8b', name: 'Llama 3.1 8B', family: 'Llama',
    desc: "Meta's solid general-purpose model. Well-tested, broad tool-use support, large community.",
    tags: ['general'], minVram: '5.5 GB',
    ollama: 'llama3.1:8b', hfId: 'meta-llama/Llama-3.1-8B-Instruct',
    ggufRepo: 'bartowski/Meta-Llama-3.1-8B-Instruct-GGUF',
    ggufFiles: [
      { filename: 'Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf', quant: 'Q4_K_M', sizeGb: '4.9' },
      { filename: 'Meta-Llama-3.1-8B-Instruct-Q8_0.gguf',   quant: 'Q8_0',   sizeGb: '8.5' },
    ],
    backends: ['ollama', 'vllm', 'llamacpp', 'sglang'],
  },
  {
    id: 'llama33-70b', name: 'Llama 3.3 70B', family: 'Llama',
    desc: 'Top-tier open model. Best for complex multi-file refactors and architectural reasoning. Needs a big GPU.',
    tags: ['general', 'reasoning'], minVram: '40 GB',
    ollama: 'llama3.3:70b', hfId: 'meta-llama/Llama-3.3-70B-Instruct',
    ggufRepo: 'bartowski/Llama-3.3-70B-Instruct-GGUF',
    ggufFiles: [
      { filename: 'Llama-3.3-70B-Instruct-Q4_K_M.gguf', quant: 'Q4_K_M', sizeGb: '42.5' },
    ],
    backends: ['ollama', 'vllm', 'llamacpp', 'sglang'],
  },
  {
    id: 'deepseek-coder-v2-lite', name: 'DeepSeek-Coder-V2-Lite', family: 'DeepSeek',
    desc: 'Excellent coding model, especially strong on multi-file edits and agentic tasks. SGLang gives 3× speed boost on DeepSeek models.',
    tags: ['coding'], minVram: '11 GB',
    ollama: 'deepseek-coder-v2:16b', hfId: 'deepseek-ai/DeepSeek-Coder-V2-Lite-Instruct',
    ggufRepo: 'bartowski/DeepSeek-Coder-V2-Lite-Instruct-GGUF',
    ggufFiles: [
      { filename: 'DeepSeek-Coder-V2-Lite-Instruct-Q4_K_M.gguf', quant: 'Q4_K_M', sizeGb: '10.6' },
    ],
    backends: ['ollama', 'vllm', 'llamacpp', 'sglang'],
  },
  {
    id: 'gemma3-4b', name: 'Gemma 3 4B', family: 'Gemma',
    desc: "Google's efficient small model. Punches above its weight on general tasks. Only 3 GB VRAM.",
    tags: ['general', 'fast'], minVram: '3 GB',
    ollama: 'gemma3:4b', hfId: 'google/gemma-3-4b-it',
    ggufRepo: 'bartowski/gemma-3-4b-it-GGUF',
    ggufFiles: [
      { filename: 'gemma-3-4b-it-Q4_K_M.gguf', quant: 'Q4_K_M', sizeGb: '2.9' },
      { filename: 'gemma-3-4b-it-Q8_0.gguf',   quant: 'Q8_0',   sizeGb: '4.7' },
    ],
    backends: ['ollama', 'vllm', 'llamacpp', 'sglang'],
  },
  {
    id: 'phi4-mini', name: 'Phi-4 Mini', family: 'Phi',
    desc: "Microsoft's compact model. Great for fast code completion tasks. Very low VRAM footprint.",
    tags: ['general', 'fast'], minVram: '2.5 GB',
    ollama: 'phi4-mini', hfId: 'microsoft/Phi-4-mini-instruct',
    ggufRepo: 'bartowski/Phi-4-mini-instruct-GGUF',
    ggufFiles: [
      { filename: 'Phi-4-mini-instruct-Q4_K_M.gguf', quant: 'Q4_K_M', sizeGb: '2.5' },
    ],
    backends: ['ollama', 'vllm', 'llamacpp', 'sglang'],
  },
  {
    id: 'mistral-7b', name: 'Mistral 7B v0.3', family: 'Mistral',
    desc: 'Fast, reliable general model. Good instruction following and function calling. Wide tool support.',
    tags: ['general'], minVram: '4.5 GB',
    ollama: 'mistral:7b', hfId: 'mistralai/Mistral-7B-Instruct-v0.3',
    ggufRepo: 'bartowski/Mistral-7B-Instruct-v0.3-GGUF',
    ggufFiles: [
      { filename: 'Mistral-7B-Instruct-v0.3-Q4_K_M.gguf', quant: 'Q4_K_M', sizeGb: '4.4' },
    ],
    backends: ['ollama', 'vllm', 'llamacpp', 'sglang'],
  },
];

// ─────────────────────────────────────────────────────────────────
// Download action builders
// ─────────────────────────────────────────────────────────────────
export type DownloadFormat = 'ollama' | 'huggingface' | 'gguf';

export interface DownloadOption {
  format:   DownloadFormat;
  label:    string;
  command:  string;
  args:     string[];
  backends: BackendType[];
  note?:    string;
}

export function getDownloadOptions(model: CatalogModel): DownloadOption[] {
  const opts: DownloadOption[] = [];
  const modelsDir = join(homedir(), '.blonde', 'models');

  if (model.ollama) {
    opts.push({
      format:   'ollama',
      label:    `Ollama  —  ollama pull ${model.ollama}`,
      command:  'ollama',
      args:     ['pull', model.ollama],
      backends: ['ollama'],
    });
  }

  if (model.hfId) {
    opts.push({
      format:   'huggingface',
      label:    `HuggingFace  —  ${model.hfId}`,
      command:  'huggingface-cli',
      args:     ['download', model.hfId],
      backends: ['vllm', 'sglang'],
      note:     `Downloads to ~/.cache/huggingface — use model ID "${model.hfId}" when starting vLLM/SGLang`,
    });
  }

  if (model.ggufRepo && model.ggufFiles && model.ggufFiles.length > 0) {
    const rec = model.ggufFiles[0]; // first = recommended (Q4_K_M)
    opts.push({
      format:   'gguf',
      label:    `GGUF ${rec.quant}  —  ${rec.sizeGb} GB  (recommended for llama.cpp)`,
      command:  'huggingface-cli',
      args:     ['download', model.ggufRepo, rec.filename, '--local-dir', modelsDir],
      backends: ['llamacpp'],
      note:     `Saves to ~/.blonde/models/${rec.filename}`,
    });
    // Add other quantizations as extra options
    for (const f of model.ggufFiles.slice(1)) {
      opts.push({
        format:   'gguf',
        label:    `GGUF ${f.quant}  —  ${f.sizeGb} GB`,
        command:  'huggingface-cli',
        args:     ['download', model.ggufRepo, f.filename, '--local-dir', modelsDir],
        backends: ['llamacpp'],
        note:     `Saves to ~/.blonde/models/${f.filename}`,
      });
    }
  }

  return opts;
}

export function getHuggingFaceCliRequirement(): { met: boolean; hint: string } {
  // Checked at runtime by the UI — this just returns the hint
  return {
    met:  false,  // will be overridden by actual check
    hint: 'pip3 install huggingface-hub',
  };
}
