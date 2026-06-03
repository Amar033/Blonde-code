# Blonde-code

A proper AI developer tool taking inspiration from Claude Code and opencode, built from scratch by myself. [01-02-2026]

## Why?

I am trying to build this project from scratch — the agent runtime and almost all components built by me — so that I can understand first-hand how an agentic system works.

I did a simpler AI dev tool in the past with the same name (Blonde), which also had an offline mode since some models could run via llama.cpp on CPU. That version was dependency hell, developed in Python, and most important portions of it were vibe-coded — which caused errors in the long run.

Blonde v2 was proper at first but the TUI failed (again, due to vibe coding that part). v2 was downloadable and executable and looked better, but had inherent flaws that couldn't be fixed because of misconceptions I had while building it.

So from scratch: a proper plan, step by step, build this system and apply it across developer use cases. I also plan to use other methods for running local models and get at least half the capability of online API models.

---

## Stack & Architecture

Language: **TypeScript** (learning as I go — why not? it will be fun!)

All processes in the agent runtime are event-based. TypeScript felt right for the tooling and format guarantees that an agent runtime needs.

Runtime target: **Node.js** (with Bun as a potential future target)

```
Blonde/
  src/
    planner/     — LLM layer (provider-agnostic service layer)
    runtime/     — Agent runtime (plan → act → observe loop)
    tools/       — Tool implementations
    types/       — TypeScript definitions
    ui/          — TUI (Ink/React)
  main.ts        — Entry point
```

The LLM layer is built against a custom service interface rather than vendor SDKs — raw HTTP to the provider APIs. This makes it easier to swap providers and support local models (Ollama) alongside remote ones (OpenRouter).

---

## Current State

- Plan/Act/Observe agent loop implemented
- Streaming planning and acting phases with live `<think>` block display
- OpenRouter (remote) + Ollama (local) providers
- Ollama auto-discovers model directories including USB drives
- Intent-based tool filtering — selects only the relevant tool subset per query to keep prompts small and the model fast
- 12 built-in tools: `read_file`, `write_file`, `edit_file`, `list_files`, `glob`, `grep`, `file_tree`, `git_status`, `git_diff`, `bash`, `web_search`, `web_fetch`
- Session persistence with conversation history

## Future Plans

- [ ] Add more tools
- [ ] Improve performance
- [ ] Add documentation

## Future Plans
- Continue building out the agent runtime
- Add more tools and capabilities
- Improve the TUI experience
- TUI built with Ink — coloured diff view, live thinking stream, tool approval flow

---

## Running

```bash
cp .env.example .env   # set LLM_PROVIDER, LLM_MODEL, OPENROUTER_API_KEY
npm install
npm run agent
```

For Ollama (local):
```bash
LLM_PROVIDER=ollama LLM_MODEL=qwen3.5:latest npm run agent
```

### Customising the welcome screen banner

Place any PNG or JPG at `assets/blonde-banner.png` — it will render automatically on the welcome screen. Supported in all terminals (pixel-perfect in Kitty/iTerm2/WezTerm, colored blocks everywhere else).

To use a different file without touching the repo:
```
BLONDE_BANNER=~/Pictures/my-logo.png
```

Add it to your `.env`. Leave it unset to fall back to the default wordmark.

---

## Roadmap

- [ ] Streaming token counts and context window display improvements
- [ ] MCP (Model Context Protocol) tool support
- [ ] Local model hosting layer (alternative to llama.cpp dependency hell)
- [ ] Multi-agent support

---

*Building this to understand it — not to ship fast.*
