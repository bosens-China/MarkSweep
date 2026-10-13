# MarkSweep

A local bookmark workspace for checking links, removing duplicates, editing folders, and using AI to classify bookmarks or audit potentially outdated technical content.

The UI uses React, Ant Design, and Vite. A local Hono server handles network checks and AI requests. Long-running tasks communicate over WebSocket.

## Development

Requires Node.js 22.19+ and the pnpm version specified in the project.

```bash
pnpm install
pnpm dev
```

The browser opens automatically. Vite provides frontend hot updates; backend changes restart the local service. Press Ctrl+C to stop.

## Build and run

```bash
pnpm build
pnpm start
```

The service chooses an available port and listens only on `127.0.0.1`. To select a port or skip opening the browser:

```bash
pnpm start --port 3000 --no-open
```

After publishing the new npm package, users can launch it with `npx @boses/marksweep@latest`. This UI is currently unreleased; existing published versions still use the old CLI.

## Workflow

1. Import a browser bookmark `.html` or `.htm` export, up to 10 MB.
2. Search, filter, edit, move, and remove bookmarks using the folder tree and table.
3. Run deduplication, link checks, or an outdated-content audit. Enter optional requirements in the AI conversation panel and start organizing.
4. Open each round’s result as a readable bookmark tree or compare its changes. Continue with follow-up instructions, restore the state before a round, or use a historical result as the current working copy.
5. Review the working copy and download a new HTML file to import into your browser. Audit reports can be downloaded as Markdown.

The conversation uses the Deep Agents TypeScript SDK and streams progress, tool lifecycles, and text. Provider reasoning is optional and displayed separately. Each round retains its own immutable result and is included in browser recovery data. Requests carry up to 40 completed rounds, preserving the first round’s requirements when older history is trimmed. Current bookmarks are always authoritative, including manual edits and restored versions.

Crawlee fetches evidence locally in batches of up to 8 pages, with up to 4 concurrent requests and 2 retries. It respects robots.txt and the configured per-round page budget. Page bodies are converted to Markdown with the pure JavaScript `@mdream/js` implementation, preserving headings, lists, code, and links. When the original article is insufficient, the agent can batch-read related public pages with a previously read source and a specific question: at most two expansion levels and three supplemental attempts per bookmark, sharing the round’s page budget. Supplemental pages are evidence only; no search-engine tool is included. Cached evidence can be read in sections and reused across rounds on the same WebSocket connection. JavaScript rendering and authenticated pages are not supported in this first version. Missing evidence is reported for review. Rounds default to a ten-minute limit, configurable from one to thirty minutes; cancellation or failure leaves current bookmarks unchanged. Validated results preserve all bookmark IDs, URLs, and attributes, allowing only title and folder changes. Follow-up rounds can submit sparse patches; omitted bookmarks remain unchanged. OpenAI-compatible providers may use any model ID, and tool-call reasoning content is preserved when present.

Changes only affect the in-page working copy. The original file is never overwritten. Restore the original import at any time. The working copy, check results, and audit text are saved to browser IndexedDB and restored when the current tab reloads at the same address. Interrupted tasks do not resume automatically. The footer shows cache status, and leaving the page warns when a save is pending or unavailable. This cache is not a backup: export your work. Recovery is not guaranteed after closing the tab, clearing browser data, or changing ports. Clear Workspace removes the current tab’s working copy and cache.

Link checks distinguish valid, broken, suspicious, and skipped results. Review network failures, access restrictions, and login requirements before deleting anything. AI audits only offer recommendations; they never automatically delete bookmarks or guarantee verification against the latest information.

WebSocket handles task commands, progress, and audit text. Tasks can be cancelled; closing or disconnecting the page cancels backend work. Reconnection does not resume tasks. HTTP handles import, export, and configuration reads and writes.

The toolbar imports and exports JSON check reports compatible with the old CLI `check --json` format. Results match current bookmarks by URL while preserving current titles, folders, and attributes. Import shows unmatched counts and does not revisit links. Exports include only existing results for bookmarks in the current working copy; partial checks can also be saved. Historical results may be stale, so review them before deleting bookmarks.

Follow-ups initially receive a folder outline and retrieve relevant bookmark metadata using `find_bookmarks`, with pagination available for global changes. The UI records model-request duration, first streamed response, tool execution, and total round time; token counts are shown when reported by the provider. Parallel durations are not additive. Page cards include source references, final-attempt request and parsing time, Markdown conversion time, and attempt counts.

## AI configuration

Use Settings to enter a Base URL, model, and API key. Values entered in the page remain in memory by default. Leaving the API key blank reuses the local configuration. Save AI Configuration Locally requires explicit confirmation and writes to the existing configuration file. Keys are stored as plaintext; blank keys preserve the existing saved key, and environment variables still take precedence. Writes use a temporary file and atomic replacement to protect the old configuration on failure. Keys are excluded from browser recovery data.

Priority: page input > environment variables > local configuration file.

```dotenv
MARKSWEEP_AI_BASE_URL=https://api.openai.com/v1
MARKSWEEP_AI_MODEL=your-model
MARKSWEEP_AI_API_KEY=your-api-key
MARKSWEEP_AI_COMPATIBILITY=auto
MARKSWEEP_LANG=zh
```

`OPENAI_BASE_URL`, `OPENAI_MODEL`, and `OPENAI_API_KEY` are also supported. Startup reads `.env` from the current directory.

Existing configuration files remain supported:

- macOS: `~/Library/Application Support/marksweep/config.json`
- Windows: `%APPDATA%/marksweep/config.json`
- Linux: `~/.config/marksweep/config.json`

Override the location using `MARKSWEEP_CONFIG_PATH`. Stored API keys are never returned to the UI.

Page fetching falls back from Firecrawl to Jina Reader to direct HTML requests. Optional variables include `FIRECRAWL_API_KEY`, `FIRECRAWL_BASE_URL`, and `JINA_API_KEY`. Auditing defaults to 20 page reads; set the limit to 0 to use only metadata.

Configure `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT`, and optionally `LANGSMITH_ENDPOINT` locally. Tracing can be enabled or disabled in Settings. Enabled tasks display a LangSmith trace link in the toolbar. Trace submission errors show a warning without discarding successful AI output.

## Repository layout

```text
apps/web/       React + Ant Design UI and Vite configuration
apps/server/    Hono API, WebSocket tasks, and local launcher
packages/core/  Parsing, deduplication, checks, AI, HTML output, shared messages
src/            Legacy CLI retained for regression tests, no longer the npm entry point
tests/          Core, API, WebSocket, and UI data-logic tests
```

This is a pnpm workspace. Internal packages are private; the build bundles Core into the server and includes the UI and server in the root npm package.

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm pack --dry-run
```

## Privacy and runtime boundaries

The server is restricted to loopback and validates Host, Origin, and task input. HTTP and WebSocket payloads are limited to 16 MB.

Importing, editing, and deduplication stay local. Checks visit bookmark URLs. Classification and auditing send bookmark metadata and necessary page content to the configured AI service. Page fetching may contact third-party services. Enabling LangSmith also sends prompts, outputs, and tool calls to LangSmith.

The full workspace requires a local Node service. GitHub Pages can host a separate introduction or demo, but cannot run the complete application by itself. No Pages deployment is configured in this change.
