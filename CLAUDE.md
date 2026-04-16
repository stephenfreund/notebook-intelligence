# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Notebook Intelligence (NBI) is an AI coding assistant extension for JupyterLab 4.0+. It has a hybrid architecture: TypeScript/React frontend running in JupyterLab's UI and a Python backend running as a Jupyter Server extension. Communication between them uses WebSocket for real-time bidirectional messaging.

## Build & Development Commands

The frontend uses `jlpm` (JupyterLab's pinned yarn). The backend uses pip with hatchling.

```bash
# Initial dev setup
pip install -e "."
jupyter labextension develop . --overwrite
jupyter server extension enable notebook_intelligence

# Build frontend (TypeScript)
jlpm build           # dev build with source maps
jlpm build:prod      # production build (clean + minified)

# Watch mode (run in separate terminals)
jlpm watch           # watches both src and labextension
jupyter lab          # run JupyterLab

# Lint & format
jlpm lint:check      # check all (stylelint + prettier + eslint)
jlpm lint            # fix all
jlpm eslint:check    # ESLint only
jlpm prettier:check  # Prettier only

# Python tests
python -m pytest tests/               # all tests
python -m pytest tests/test_rule_manager.py  # single file
python -m pytest tests/ -v            # verbose
```

## Architecture

### Frontend (`src/`)
- **index.ts** - JupyterLab plugin activation, command registration, inline completion provider
- **chat-sidebar.tsx** - Main chat UI component (message history, streaming, settings)
- **api.ts** - WebSocket client connecting to the Python backend
- **tokens.ts** - Token definitions and interfaces
- **components/** - React UI components (settings panel, dialogs, etc.)

### Backend (`notebook_intelligence/`)
- **extension.py** - Jupyter server extension: HTTP/WebSocket handlers, tool execution coordination
- **ai_service_manager.py** - Orchestrates LLM providers, chat participants, MCP servers, and rules
- **claude.py** - Claude SDK integration using `claude_agent_sdk` for agent mode
- **github_copilot.py** - GitHub Copilot device-flow auth, token management, completions API
- **base_chat_participant.py** - Base class for chat participant implementations
- **mcp_manager.py** - Model Context Protocol server discovery, connection, and tool/prompt execution (uses `fastmcp`)
- **rule_manager.py** / **rule_injector.py** / **ruleset.py** - Custom rules system: YAML+markdown files loaded from `~/.jupyter/nbi/rules/`, scoped by file pattern/kernel/mode, priority-ordered
- **built_in_toolsets.py** - Agent tools for notebook/file editing, search, and command execution
- **config.py** - Config from `~/.jupyter/nbi/config.json` (user) and `<env>/share/jupyter/nbi/` (env-wide)
- **llm_providers/** - Provider implementations: GitHub Copilot, OpenAI-compatible, Ollama, LiteLLM

### Generated output directories
- `lib/` - Compiled TypeScript
- `notebook_intelligence/labextension/` - Built JupyterLab extension assets

## Code Style

**TypeScript:** Single quotes, interfaces prefixed with `I` (PascalCase), curly braces required, `===` required. Config in `package.json` (eslintConfig, prettier, stylelint sections).

**Python:** Python 3.10+. Heavy use of asyncio. WebSocket operations are thread-safe via `ThreadSafeWebSocketConnector`.

## Key Environment Variables

- `NBI_LOG_LEVEL` - Logging level
- `NBI_RULES_AUTO_RELOAD` - Auto-reload rules on file change
- `NBI_ENABLED_BUILTIN_TOOLS` - Re-enable specific disabled tools
- `NBI_CLAUDE_AGENT_CLIENT_RESPONSE_TIMEOUT` - Agent response timeout
- `NBI_MCP_SERVER_RESPONSE_TIMEOUT` - MCP server response timeout

## CI

GitHub Actions (`.github/workflows/build.yml`): lint check, build extension, package wheel/sdist, test isolated install (no NodeJS). Python 3.10, JupyterLab 4.x.
