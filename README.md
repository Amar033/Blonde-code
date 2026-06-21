# Blonde-code

A proper AI developer tool taking inspiration from Claude Code and opencode, built from scratch by myself. [01-02-2026]

## Why?

I am trying to build this project from scratch — the agent runtime and almost all components built by me — so that I can understand first-hand how an agentic system works.

I did a simpler AI dev tool in the past with the same name (Blonde), which also had an offline mode since some models could run via llama.cpp on CPU. That version was dependency hell, developed in Python, and most important portions of it were vibe-coded — which caused errors in the long run.

Blonde v2 was proper at first but the TUI failed (again, due to vibe coding that part). v2 was downloadable and executable and looked better, but had inherent flaws that couldn't be fixed because of misconceptions I had while building it.

So from scratch: a proper plan, step by step, build this system and apply it across developer use cases. I also plan to use other methods for running local models and get at least half the capability of online API models.

---

## A note on AI involvement

The core plan — agent runtime architecture, plan/act/observe loop, provider abstraction, tool system — was designed and written by me from scratch as a learning exercise.

After the base architecture was working, I used AI assistance (Claude) primarily for UI improvements, TUI polish, and accelerating the implementation of secondary features like the settings screen, session management, and the release pipeline. The reasoning system, LLM client, and tool execution loop remain hand-built.

If you're looking at this project to understand how an agent runtime works, the `src/runtime/`, `src/planner/`, and `src/tools/` directories are the parts I built and understand deeply. The `src/ui/` layer has more AI-assisted code.

---

## Stack & Architecture

Language: **TypeScript** (learning as I go — why not? it will be fun!)

All processes in the agent runtime are event-based. TypeScript felt right for the tooling and format guarantees that an agent runtime needs.

Runtime target: **Bun** (fast startup, native fetch, single-binary compile)

```
Blonde/
  src/
    agent/       — Agent config and entry point
    planner/     — LLM layer: provider-agnostic client + multi-provider registry
    runtime/     — Agent runtime (plan → act → observe loop)
    services/    — Backend detection, SearXNG search, session management, updater
    tools/       — Tool implementations (bash, file ops, git, web, search)
    types/       — TypeScript definitions
    ui/          — TUI (OpenTUI/React) — screens, components, hooks
  main.ts        — CLI entry point
```

The LLM layer is built against a custom service interface rather than vendor SDKs — raw HTTP to the provider APIs. This makes it easier to swap providers and support local models (Ollama) alongside remote ones (OpenRouter, Anthropic, OpenAI-compatible endpoints).

---

## Current State

- Plan/Act/Observe agent loop implemented
- Streaming planning and acting phases with live `<think>` block display
- **Multi-provider support:** Anthropic, OpenRouter, Ollama, LM Studio, and any OpenAI-compatible endpoint
- Provider config persists to `~/.blonde/providers.json` — switch models without touching env vars
- Ollama auto-discovers model directories including USB drives
- Intent-based tool filtering — selects only the relevant tool subset per query to keep prompts small
- **Full tool suite:** `read_file`, `write_file`, `edit_file`, `replace_block`, `list_files`, `glob`, `grep`, `file_tree`, `bash`, `git_status`, `git_diff`, `git_log`, `git_add`, `git_commit`, `git_branch`, `git_stash`, `web_search`, `web_fetch`, `search_codebase`, `delete_file`, `rename_file`
- Self-hosted web search via SearXNG (Docker/Podman) with DuckDuckGo fallback
- Session persistence with sliding conversation history and async compaction
- Settings screen for managing providers, models, and backends
- Auto-updater (`blonde --update`)

---

## For Developers

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.1
- Node.js ≥ 18 (only needed for `tsc` type checking)
- At least one LLM provider (see Configuration below)

### Running from source

```bash
git clone https://github.com/Amar033/Blonde-code.git
cd Blonde-code
bun install
cp .env.example .env   # edit to set your provider
bun src/ui/run.tsx
```

### Configuration

Set your provider via env vars in `.env`, or configure them interactively from the Settings screen inside the app.

**Anthropic:**
```env
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
LLM_MODEL=claude-haiku-4-5-20251001
```

**Ollama (local):**
```env
LLM_PROVIDER=ollama
LLM_MODEL=qwen3:8b
# OLLAMA_BASE_URL=http://localhost:11434  # optional
```

**OpenRouter:**
```env
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-...
LLM_MODEL=arcee-ai/trinity-large-preview:free
```

**OpenAI / OpenAI-compatible:**
```env
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini
```

### SearXNG web search (optional)

Blonde can spin up a local SearXNG container for private web search. Requires Docker or Podman.

```bash
# Docker
sudo apt install docker.io && sudo usermod -aG docker $USER
# Podman (rootless, recommended)
sudo apt install podman-docker
```

The container starts automatically on first web search and persists between sessions. Falls back to DuckDuckGo if no container runtime is found.

To use an existing SearXNG instance:
```env
SEARXNG_BASE_URL=http://your-instance:8080
```

### Type checking

```bash
npx tsc --noEmit
```

### Building a single binary

```bash
# Current platform
bun build --compile --target=bun-linux-x64 --outfile=blonde src/ui/run.tsx

# All platforms (runs locally — requires each platform's native packages)
bun run compile:linux-x64
bun run compile:darwin-arm64
bun run compile:windows
```

> **Note:** Cross-compilation doesn't work for this project because `@opentui/core` uses platform-native binaries. Each target must be built on its own OS. The release CI handles this automatically using platform-specific runners.

### Project layout for contributors

| Directory | What's in it |
|---|---|
| `src/runtime/core.ts` | The main agent event loop — plan → act → observe → complete |
| `src/planner/llm-client.ts` | LLM abstraction: plan/act/stream methods |
| `src/planner/provider-registry.ts` | Persisted provider config |
| `src/planner/providers/` | Per-provider HTTP clients (Anthropic, OpenAI-compat, Ollama, OpenRouter) |
| `src/tools/` | All tool implementations — each is a self-contained class |
| `src/planner/intent-classifier.ts` | Maps user queries to relevant tool subsets |
| `src/services/` | Backend detection, SearXNG, session persistence, auto-updater |
| `src/ui/screens/` | Full-screen TUI views (chat, settings, sessions, startup) |

---

## Customising the welcome screen banner

Place any PNG or JPG at `assets/blonde-banner.png` — it will render automatically on the welcome screen. Supported in all terminals (pixel-perfect in Kitty/iTerm2/WezTerm, colored blocks everywhere else).

To use a different file without touching the repo:
```env
BLONDE_BANNER=~/Pictures/my-logo.png
```

Add it to your `.env`. Leave it unset to fall back to the default wordmark.

---

## Roadmap

- [ ] Streaming token counts and context window display improvements
- [ ] MCP (Model Context Protocol) tool support
- [ ] Local model hosting layer (alternative to llama.cpp dependency hell)
- [ ] Multi-agent support
- [ ] Add more tools
- [ ] Improve performance

---

*Building this to understand it — not to ship fast.*
