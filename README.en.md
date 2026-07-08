# MarkSweep

Chinese documentation: [README.md](README.md)

MarkSweep is a TypeScript CLI for cleaning broken browser bookmarks and reorganizing bookmarks with AI.

It works with browser-exported `bookmarks.html` files, keeps the original file untouched, and writes cleaned or AI-classified results to new HTML files that can be imported back into Chrome, Edge, Firefox, and other browsers that support the Netscape bookmark export format.

## Features

- Parse browser-exported `.html` / `.htm` bookmark files.
- Check bookmark validity with configurable concurrency, timeout, and retries.
- Remove only clearly broken links, such as `404`, `410`, DNS failures, refused connections, and repeated empty responses.
- Keep suspicious links, such as timeouts, `401`, `403`, `429`, SSL errors, and possible anti-bot responses.
- Deduplicate bookmarks using normalized URLs while keeping the more informative title.
- Generate browser-importable bookmark HTML.
- Classify bookmarks with an OpenAI-compatible model.
- Let the AI decide when vague bookmark titles need extra page content.
- Fetch page content through a LangChain agent tool with Firecrawl, Jina Reader, and plain HTML fallback.

## Safety Model

MarkSweep is conservative by design.

- It never modifies the original bookmark file.
- `check` only prints a report.
- `clean` writes a new cleaned HTML file.
- `classify` writes a new AI-organized HTML file.
- Suspicious links are kept instead of deleted.
- AI failures stop the command before writing a partial classified file.

## Requirements

- Node.js `>=20`
- pnpm for development

## Installation

From npm, after the package is published:

```bash
npm install -g @boses/marksweep
```

For local development:

```bash
git clone <repo-url>
cd MarkSweep
pnpm install
pnpm build
```

Run the local CLI:

```bash
pnpm dev -- --help
```

Run the built CLI:

```bash
node dist/cli.js --help
```

## Quick Start

Export your bookmarks from your browser as an HTML file, then run:

```bash
marksweep check bookmarks.html
```

Clean clearly broken bookmarks and write a new file:

```bash
marksweep clean bookmarks.html --output bookmarks.cleaned.html
```

Classify bookmarks with AI and write a new file:

```bash
marksweep classify bookmarks.html \
  --base-url https://api.openai.com/v1 \
  --model gpt-4.1-mini \
  --api-key "$OPENAI_API_KEY" \
  --output bookmarks.classified.html
```

If `--output` is omitted, MarkSweep writes next to the input file:

```txt
bookmarks.cleaned.html
bookmarks.classified.html
```

## Commands

### `marksweep check <input>`

Checks bookmark validity and prints the result in the terminal.

```bash
marksweep check bookmarks.html \
  --concurrency 20 \
  --timeout 10000 \
  --retries 2
```

This command does not write an output file.

### `marksweep clean <input>`

Checks bookmarks, deduplicates them, removes clearly broken links, keeps suspicious links, and writes a new HTML file.

```bash
marksweep clean bookmarks.html --output bookmarks.cleaned.html
```

Suspicious bookmarks are moved to `其他`.

### `marksweep classify <input>`

Deduplicates bookmarks, asks an OpenAI-compatible model to create a new multi-level folder tree, and writes a new HTML file.

```bash
marksweep classify bookmarks.html \
  --base-url https://api.openai.com/v1 \
  --model gpt-4.1-mini \
  --api-key "$OPENAI_API_KEY" \
  --lang zh
```

The original folder structure is not preserved. MarkSweep checks links first, sends valid bookmarks to the AI, and keeps suspicious or non-web bookmarks under `其他`.

## Options

### Detection Options

```txt
--concurrency <number>  Number of concurrent URL checks. Default: 20
--timeout <ms>          Timeout per request in milliseconds. Default: 10000
--retries <number>      Retry count after failures. Default: 2
```

### Output Options

```txt
-o, --output <path>     Output HTML path for clean/classify.
```

The output path cannot be the same as the input path.

### AI Options

```txt
--base-url <url>        OpenAI-compatible API base URL.
--model <name>          Model name.
--api-key <key>         API key.
--lang <language>       Folder language. Default: zh
```

AI configuration priority:

```txt
CLI arguments > environment variables > local config > interactive prompt
```

Supported environment variables:

```txt
MARKSWEEP_AI_BASE_URL
MARKSWEEP_AI_MODEL
MARKSWEEP_AI_API_KEY
OPENAI_BASE_URL
OPENAI_MODEL
OPENAI_API_KEY
MARKSWEEP_LANG
```

When AI values are entered interactively, MarkSweep asks whether to save them locally for future runs. If you confirm, `baseUrl`, `model`, `apiKey`, and `lang` are saved in a local JSON config file. The API key is stored on your machine in plain text.

Default config path:

```txt
Windows: %APPDATA%\marksweep\config.json
macOS:   ~/Library/Application Support/marksweep/config.json
Linux:   ~/.config/marksweep/config.json
```

You can override the path with:

```txt
MARKSWEEP_CONFIG_PATH
```

### LangSmith Options

LangSmith tracing is optional and disabled by default. When enabled, MarkSweep traces the `classify` AI calls and the model/tool steps used by LangChain.

```txt
--langsmith                    Enable LangSmith tracing.
--langsmith-api-key <key>      LangSmith API key.
--langsmith-project <name>     LangSmith project. Default: marksweep
--langsmith-endpoint <url>     LangSmith API endpoint.
--langsmith-workspace-id <id>  LangSmith workspace ID.
--langsmith-hide-inputs        Hide trace inputs before sending.
--langsmith-hide-outputs       Hide trace outputs before sending.
```

Equivalent environment variables:

```txt
LANGSMITH_TRACING=true
LANGSMITH_API_KEY
LANGSMITH_PROJECT
LANGSMITH_ENDPOINT
LANGSMITH_WORKSPACE_ID
MARKSWEEP_LANGSMITH_TRACING
MARKSWEEP_LANGSMITH_API_KEY
MARKSWEEP_LANGSMITH_PROJECT
MARKSWEEP_LANGSMITH_ENDPOINT
MARKSWEEP_LANGSMITH_WORKSPACE_ID
MARKSWEEP_LANGSMITH_HIDE_INPUTS
MARKSWEEP_LANGSMITH_HIDE_OUTPUTS
```

Example:

```bash
marksweep classify bookmarks.html \
  --base-url https://api.openai.com/v1 \
  --model gpt-4.1-mini \
  --api-key "$OPENAI_API_KEY" \
  --langsmith \
  --langsmith-api-key "$LANGSMITH_API_KEY" \
  --langsmith-project marksweep-dev
```

## Link Classification Rules

MarkSweep removes only links that are clearly broken after retries:

- HTTP `404`
- HTTP `410`
- DNS failures such as `ENOTFOUND`
- Refused connections such as `ECONNREFUSED`
- Repeated empty responses, similar to Chrome's `ERR_EMPTY_RESPONSE`

MarkSweep keeps suspicious links:

- Timeouts
- HTTP `401`
- HTTP `403`
- HTTP `429`
- SSL/TLS certificate errors
- Server errors
- Possible login walls, anti-bot pages, or temporary network problems

Non-web protocols are skipped and kept:

```txt
chrome://
edge://
about:
javascript:
file://
mailto:
```

## AI Web Fetching Tool

The classifier exposes a LangChain tool named `fetch_web_page`.

The model decides whether to call it. The prompt asks the model to use the tool only when a bookmark title is too vague to classify from title and URL alone.

The tool tries providers in this order:

1. Firecrawl, when a Firecrawl API key is configured.
2. Jina Reader.
3. Plain HTML fetch and text extraction.

Optional environment variables:

```txt
MARKSWEEP_FIRECRAWL_API_KEY
FIRECRAWL_API_KEY
MARKSWEEP_FIRECRAWL_BASE_URL
FIRECRAWL_BASE_URL
MARKSWEEP_JINA_API_KEY
JINA_API_KEY
```

Firecrawl is useful for JavaScript-heavy pages. Jina Reader also provides LLM-friendly text and can handle many rendered pages. Plain HTML fallback is best for simple SSR/static pages.

## Deduplication

`clean` and `classify` deduplicate bookmarks by normalized URL.

Normalization rules:

- Protocol and host are case-insensitive.
- Trailing `/` is removed.
- Query strings are preserved.
- Hash fragments are preserved.

When duplicates are found, MarkSweep keeps the bookmark with the more informative title and richer metadata.

## Development

Install dependencies:

```bash
pnpm install
```

Run tests:

```bash
pnpm test
```

Run TypeScript:

```bash
pnpm build
```

Run ESLint:

```bash
pnpm lint
```

Run all important checks before publishing:

```bash
pnpm test
pnpm build
pnpm lint
pnpm pack --dry-run
```

## Project Structure

```txt
src/
  bookmarks/   URL normalization and deduplication
  checker/     bookmark validity checking
  classifier/  AI classification and web fetching tool
  cli/         CLI config and terminal output helpers
  parser/      browser bookmark HTML parser
  report/      result grouping helpers
  writer/      browser-importable bookmark HTML writer
tests/         Vitest test suite
docs/          PRD and implementation TODO
```

## Testing Status

The test suite covers the important behavior paths:

- Parser behavior against a real browser bookmark export.
- URL normalization and deduplication.
- Link status classification.
- HTML writer output.
- AI classification validation.
- Web page fetching fallback behavior.
- CLI command registration and clean/classify integration paths.

Run:

```bash
pnpm test
```

## Privacy Notes

`check`, `clean`, and `classify` send network requests to bookmark URLs to determine link status.

`classify` sends valid bookmark titles and URLs to the configured AI provider. When the AI calls `fetch_web_page`, MarkSweep may also send selected URLs to Firecrawl, Jina Reader, or fetch the page directly, depending on your configuration and fallback behavior.

If you choose to save interactive AI settings, MarkSweep stores the API key in a local plain-text JSON config file. Keep that file private and avoid placing it inside a repository.

If LangSmith tracing is enabled, classification prompts, outputs, and tool activity may also be sent to LangSmith. Use `--langsmith-hide-inputs` and `--langsmith-hide-outputs` when you want trace metadata without storing bookmark details.

Do not run AI classification on bookmarks that contain sensitive URLs unless you are comfortable sending that metadata to your configured providers.

## Roadmap

- Optional JSON reports.
- Batch/chunked AI classification for very large bookmark files.
- Coverage reporting.
- More browser import compatibility fixtures.
- Optional provider-specific integration tests.

## Contributing

Issues and pull requests are welcome.

Use Conventional Commit messages so Release Please can infer versions:

```txt
fix: handle empty bookmark titles
feat: add a new classifier option
feat!: change the classified HTML format
```

CI runs on Node.js 24. Releases are managed by Release Please. Merging the generated release PR updates `package.json`, updates `CHANGELOG.md`, creates a GitHub Release, and then publishes `@boses/marksweep` to npm through Trusted Publishing.

Publishing notes live in [docs/PUBLISHING.md](docs/PUBLISHING.md).

For changes that affect behavior, please include tests and run:

```bash
pnpm test
pnpm build
pnpm lint
```

## License

MIT
