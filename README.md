# Cherry AI Platform

Cherry AI is now scaffolded as a web-first agent platform with three runnable surfaces:

- `apps/web`: hosted React frontend for workspace, pairing, campaigns, and history
- `apps/backend`: pairing/task/campaign API plus websocket event bus
- `apps/agent`: downloadable local agent runtime that pairs with the backend, plans tasks, and executes them through attached or managed browser controllers

The legacy extension code is still in the repo as reference for selector logic and old browser automation behavior:

- `background/`
- `modules/`
- `src/`

## Workspace layout

```text
apps/
  web/
  backend/
  agent/
packages/
  shared/
  planner/
  browser-attached/
  browser-managed/
  platform-skills/
  campaign-engine/
  artifacts/
```

## What is implemented now

- npm workspaces for the new multi-app platform
- hosted workspace UI with:
  - chat task dispatch
  - pairing code screen
  - campaign creation screen
  - live websocket event feed
- backend with:
  - `POST /agent/pairing/code`
  - `POST /agent/pairing/claim`
  - `GET /agents`
  - `POST /tasks`
  - `GET /tasks`
  - `GET /tasks/:id`
  - `POST /campaigns`
  - `PATCH /campaigns/:id`
  - `GET /campaigns`
  - websocket event bridge for web clients and agents
- local agent with:
  - one-time pairing via `CHERRY_PAIRING_CODE`
  - local task planning
  - attached browser controller over Chrome CDP
  - managed browser controller with persistent profiles
  - platform skill registry
  - artifact export to `.cherry-agent/artifacts`
- shared schemas for tasks, plans, campaigns, lead sources, stop rules, and events

## What is still scaffold-level

The architecture is in place, but this is not yet feature-complete production automation:

- local LLM planning is still a rules-based planner scaffold, not a full natural-language planner over the GGUF engine
- social/email/WhatsApp skills are bootstrapped to platform-aware browser opening/snapshot behavior, not yet full write-capable parity
- campaign execution engine supports lifecycle/state shape, not the full always-on scheduler/monitor loops from the product plan
- release packaging is still based on the older local runtime flow and will need to be replaced with a proper downloadable local-agent bundle

## Run locally

Install dependencies:

```bash
npm install
```

Start backend:

```bash
npm run dev:backend
```

Start web app:

```bash
npm run dev:web
```

Open the UI at:

```text
http://localhost:3000
```

Generate a pairing code from the Pairing page, then start the local agent with that code:

```bash
CHERRY_PAIRING_CODE=ABC123 npm run dev:agent
```

## Browser prerequisites

For attached real-Chrome mode, launch Chrome with remote debugging enabled:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

The attached browser controller expects:

```text
http://127.0.0.1:9222
```

You can override that with:

```bash
CHERRY_ATTACHED_CDP_URL=http://127.0.0.1:9223
```

For managed browser mode, Playwright launches a persistent Chrome profile under:

```text
~/.cherry-agent/profiles
```

## Next implementation targets

1. Replace the scaffold planner with real local GGUF planning/tool-use orchestration
2. Move existing Instagram/X/LinkedIn selector logic into the new platform skills
3. Add real Facebook/Gmail/WhatsApp action handlers
4. Implement durable campaign scheduling, inbox watchers, and lead-refresh loops
5. Replace the legacy extension packaging flow with a local-agent desktop/download packaging flow
