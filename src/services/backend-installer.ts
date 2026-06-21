import { homedir } from 'os';
import { join } from 'path';
import type { BackendType, SystemCapabilities } from './backend-detector.js';

// Python server script embedded as a string — written to ~/.blonde/airllm_server.py on install
const AIRLLM_SERVER_PY = `#!/usr/bin/env python3
"""Blonde AirLLM server — OpenAI-compatible endpoint. Runs large models on small GPUs via layer-by-layer loading."""
import argparse, sys, time, uuid

parser = argparse.ArgumentParser()
parser.add_argument('--model', required=True)
parser.add_argument('--port', type=int, default=8002)
parser.add_argument('--max-new-tokens', type=int, default=512)
parser.add_argument('--max-length', type=int, default=2048)
args = parser.parse_args()

print(f'[airllm] Loading {args.model} (layer-by-layer — first load may take a few minutes)...')
try:
    from airllm import AutoModel
except ImportError:
    print('[airllm] ERROR: run pip3 install airllm fastapi uvicorn first'); sys.exit(1)

model = AutoModel.from_pretrained(args.model)
print(f'[airllm] Ready on :{args.port}')

try:
    import torch; DEVICE = 'cuda' if torch.cuda.is_available() else 'cpu'
except ImportError:
    DEVICE = 'cpu'

try:
    from fastapi import FastAPI, Request; import uvicorn
except ImportError:
    print('[airllm] ERROR: run pip3 install fastapi uvicorn first'); sys.exit(1)

app = FastAPI()

def msgs_to_prompt(msgs):
    out = []
    for m in msgs:
        r, c = m.get('role', 'user'), m.get('content', '')
        out.append({'system': f'System: {c}', 'user': f'Human: {c}', 'assistant': f'Assistant: {c}'}.get(r, c))
    out.append('Assistant:')
    return '\\n\\n'.join(out)

@app.get('/v1/models')
async def list_models():
    return {'object': 'list', 'data': [{'id': args.model, 'object': 'model'}]}

@app.post('/v1/chat/completions')
async def completions(req: Request):
    body = await req.json()
    prompt = msgs_to_prompt(body.get('messages', []))
    max_tok = int(body.get('max_tokens', args.max_new_tokens))
    ids = model.tokenizer([prompt], return_tensors='pt', truncation=True,
                          max_length=args.max_length, padding=False, return_attention_mask=False)['input_ids']
    if DEVICE == 'cuda':
        ids = ids.cuda()
    out = model.generate(ids, max_new_tokens=max_tok, use_cache=True, return_dict_in_generate=True)
    decoded = model.tokenizer.decode(out.sequences[0])
    text = decoded.split('Assistant:')[-1].strip() if 'Assistant:' in decoded else decoded[len(prompt):].strip()
    return {'id': f'chatcmpl-{uuid.uuid4().hex[:8]}', 'object': 'chat.completion', 'created': int(time.time()),
            'model': args.model, 'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': text}, 'finish_reason': 'stop'}],
            'usage': {'prompt_tokens': ids.shape[1], 'completion_tokens': max_tok, 'total_tokens': ids.shape[1] + max_tok}}

if __name__ == '__main__':
    uvicorn.run(app, host='0.0.0.0', port=args.port)
`;

export type InstallMethod = 'native' | 'docker';

export interface Requirement {
  name:  string;
  met:   boolean;
  hint?: string;
}

export interface InstallStep {
  label:   string;
  command: string;
  args:    string[];
}

export interface BackendAction {
  title:         string;
  method:        InstallMethod;
  requirements:  Requirement[];
  steps:         InstallStep[];
  modelRequired: boolean;
}

export function supportsDocker(type: BackendType): boolean {
  return type === 'vllm' || type === 'sglang';
}

export function isDesktopApp(type: BackendType): boolean {
  return type === 'lmstudio';
}

export function buildInstallAction(
  type:   BackendType,
  method: InstallMethod,
  caps:   SystemCapabilities,
): BackendAction {
  switch (type) {
    case 'ollama':
      return {
        title:         'Install Ollama',
        method:        'native',
        requirements:  [],
        steps: [
          { label: 'Download & install', command: 'sh', args: ['-c', 'curl -fsSL https://ollama.com/install.sh | sh'] },
        ],
        modelRequired: false,
      };

    case 'llamacpp':
      return {
        title:  'Install llama.cpp server',
        method: 'native',
        requirements: [
          { name: 'Python 3', met: !!caps.pythonVersion, hint: 'Install Python 3 from python.org' },
        ],
        steps: [{
          label:   'Install llama-cpp-python[server]',
          command: 'sh',
          args:    ['-c', caps.hasCuda
            ? 'CMAKE_ARGS="-DGGML_CUDA=on" pip3 install "llama-cpp-python[server]"'
            : 'pip3 install "llama-cpp-python[server]"'],
        }],
        modelRequired: false,
      };

    case 'vllm':
      if (method === 'docker') {
        return {
          title:  'Install vLLM (Docker)',
          method: 'docker',
          requirements: [
            { name: 'Docker',                   met: caps.hasDocker,                   hint: 'https://docs.docker.com/get-docker/'                                           },
            { name: 'nvidia-container-toolkit', met: caps.hasNvidiaContainerToolkit,   hint: 'https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html' },
            { name: 'CUDA GPU',                 met: caps.hasCuda,                     hint: 'NVIDIA GPU required'                                                           },
          ],
          steps: [
            { label: 'Pull vLLM Docker image', command: 'docker', args: ['pull', 'vllm/vllm-openai:latest'] },
          ],
          modelRequired: false,
        };
      }
      return {
        title:  'Install vLLM (Native)',
        method: 'native',
        requirements: [
          { name: 'Python 3.10+', met: !!caps.pythonVersion, hint: 'Python 3.10 or newer required' },
          { name: 'CUDA GPU',     met: caps.hasCuda,         hint: 'NVIDIA GPU required'           },
        ],
        steps: [
          { label: 'Install via pip', command: 'pip3', args: ['install', 'vllm'] },
        ],
        modelRequired: false,
      };

    case 'sglang':
      if (method === 'docker') {
        return {
          title:  'Install SGLang (Docker)',
          method: 'docker',
          requirements: [
            { name: 'Docker',                   met: caps.hasDocker,                   hint: 'https://docs.docker.com/get-docker/'                                           },
            { name: 'nvidia-container-toolkit', met: caps.hasNvidiaContainerToolkit,   hint: 'https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html' },
            { name: 'CUDA GPU',                 met: caps.hasCuda,                     hint: 'NVIDIA GPU required'                                                           },
          ],
          steps: [
            { label: 'Pull SGLang Docker image', command: 'docker', args: ['pull', 'lmsysorg/sglang:latest'] },
          ],
          modelRequired: false,
        };
      }
      return {
        title:  'Install SGLang (Native)',
        method: 'native',
        requirements: [
          { name: 'Python 3.10+', met: !!caps.pythonVersion, hint: 'Python 3.10 or newer required' },
          { name: 'CUDA GPU',     met: caps.hasCuda,         hint: 'NVIDIA GPU required'           },
        ],
        steps: [
          { label: 'Install via pip', command: 'pip3', args: ['install', 'sglang[all]'] },
        ],
        modelRequired: false,
      };

    case 'airllm': {
      const blondeDir = join(homedir(), '.blonde');
      const scriptDst = join(blondeDir, 'airllm_server.py');
      const writeScript = `node -e "const fs=require('fs');fs.mkdirSync('${blondeDir}',{recursive:true});fs.writeFileSync('${scriptDst}',${JSON.stringify(AIRLLM_SERVER_PY)},'utf-8');console.log('Server script written to ${scriptDst}')"`;
      return {
        title:  'Install AirLLM (Apache 2.0)',
        method: 'native',
        requirements: [
          { name: 'Python 3', met: !!caps.pythonVersion, hint: 'Install Python 3 from python.org' },
        ],
        steps: [
          { label: 'Install airllm + fastapi + uvicorn', command: 'pip3', args: ['install', 'airllm', 'fastapi', 'uvicorn'] },
          { label: 'Write AirLLM server script',         command: 'sh',   args: ['-c', writeScript] },
        ],
        modelRequired: false,
      };
    }

    case 'lmstudio':
      return {
        title:         'LM Studio (desktop app)',
        method:        'native',
        requirements:  [],
        steps:         [{ label: 'Download from lmstudio.ai', command: 'sh', args: ['-c', 'echo "Download LM Studio from lmstudio.ai and enable its local server"'] }],
        modelRequired: false,
      };
  }
}

export function buildStartAction(
  type:   BackendType,
  method: InstallMethod,
  caps:   SystemCapabilities,
  model:  string,
): BackendAction {
  const home = process.env.HOME ?? '/root';

  switch (type) {
    case 'ollama':
      return {
        title:         'Start Ollama',
        method:        'native',
        requirements:  [],
        steps: [
          { label: 'Start Ollama server', command: 'sh', args: ['-c', 'ollama serve &'] },
        ],
        modelRequired: false,
      };

    case 'llamacpp': {
      const cmd = [
        'python3 -m llama_cpp.server',
        `--model "${model}"`,
        '--port 8080',
        caps.hasCuda ? '--n_gpu_layers -1' : '',
        '&',
      ].filter(Boolean).join(' ');
      return {
        title:         'Start llama.cpp server',
        method:        'native',
        requirements:  [],
        steps: [{ label: `Load ${model}`, command: 'sh', args: ['-c', cmd] }],
        modelRequired: true,
      };
    }

    case 'vllm':
      if (method === 'docker') {
        return {
          title:         'Start vLLM (Docker)',
          method:        'docker',
          requirements:  [],
          steps: [{
            label:   `Run vLLM container with ${model}`,
            command: 'docker',
            args: [
              'run', '--rm', '--runtime', 'nvidia', '--gpus', 'all',
              '-v', `${home}/.cache/huggingface:/root/.cache/huggingface`,
              '-p', '8000:8000', '--name', 'blonde-vllm', '-d',
              'vllm/vllm-openai:latest', '--model', model,
            ],
          }],
          modelRequired: true,
        };
      }
      return {
        title:         'Start vLLM (Native)',
        method:        'native',
        requirements:  [],
        steps: [{
          label:   `Launch vLLM API with ${model}`,
          command: 'sh',
          args:    ['-c', `python3 -m vllm.entrypoints.openai.api_server --model "${model}" --port 8000 &`],
        }],
        modelRequired: true,
      };

    case 'sglang':
      if (method === 'docker') {
        return {
          title:         'Start SGLang (Docker)',
          method:        'docker',
          requirements:  [],
          steps: [{
            label:   `Run SGLang container with ${model}`,
            command: 'docker',
            args: [
              'run', '--rm', '--gpus', 'all', '-p', '30000:30000',
              '--name', 'blonde-sglang', '-d',
              'lmsysorg/sglang:latest',
              'python3', '-m', 'sglang.launch_server',
              '--model-path', model, '--host', '0.0.0.0', '--port', '30000',
            ],
          }],
          modelRequired: true,
        };
      }
      return {
        title:         'Start SGLang (Native)',
        method:        'native',
        requirements:  [],
        steps: [{
          label:   `Launch SGLang server with ${model}`,
          command: 'sh',
          args:    ['-c', `python3 -m sglang.launch_server --model-path "${model}" --port 30000 --host 0.0.0.0 &`],
        }],
        modelRequired: true,
      };

    case 'airllm': {
      const scriptPath = join(homedir(), '.blonde', 'airllm_server.py');
      return {
        title:         'Start AirLLM',
        method:        'native',
        requirements:  [],
        steps: [{
          label:   `Load ${model} via AirLLM (layer-by-layer)`,
          command: 'sh',
          args:    ['-c', `python3 "${scriptPath}" --model "${model}" --port 8002 &`],
        }],
        modelRequired: true,
      };
    }

    case 'lmstudio':
      return {
        title:         'LM Studio (desktop app)',
        method:        'native',
        requirements:  [],
        steps:         [{ label: 'LM Studio must be started manually', command: 'sh', args: ['-c', 'echo "Start LM Studio and enable its local server on port 1234"'] }],
        modelRequired: false,
      };
  }
}

export function buildStopStep(type: BackendType, inDocker: boolean): InstallStep {
  if (inDocker) {
    return { label: `Stop ${type} container`, command: 'docker', args: ['stop', `blonde-${type}`] };
  }
  const killCmds: Partial<Record<BackendType, string>> = {
    ollama:   'pkill -f "ollama serve" || true',
    vllm:     'pkill -f "vllm.entrypoints" || true',
    llamacpp: 'pkill -f "llama_cpp.server" || true',
    sglang:   'pkill -f "sglang.launch_server" || true',
  };
  const cmd = killCmds[type] ?? 'true';
  return { label: `Stop ${type}`, command: 'sh', args: ['-c', cmd] };
}
