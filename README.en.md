# MarkSweep

<img src="assets/logo-marksweep-npm.png" alt="MarkSweep logo" width="160" />

中文文档: [README.md](README.md)

MarkSweep is a TypeScript CLI for browser bookmark cleanup. It reads an exported `bookmarks.html`, checks broken links, cleans or classifies bookmarks, and writes a new HTML file.

The original file is never modified by default.

## Install

```bash
npm install -g @boses/marksweep
```

Local development:

```bash
pnpm install
pnpm dev -- --help
```

Run the built CLI:

```bash
pnpm build
node dist/cli.js --help
```

## Quick Start

Check bookmarks:

```bash
marksweep check bookmarks.html
```

Clean bookmarks:

```bash
marksweep clean bookmarks.html -o bookmarks.cleaned.html
```

Classify with AI:

```bash
marksweep classify bookmarks.html \
  --base-url https://api.openai.com/v1 \
  --model gpt-4.1-mini \
  --api-key "$OPENAI_API_KEY" \
  -o bookmarks.classified.html
```

Windows PowerShell:

```powershell
marksweep classify bookmarks.html `
  --base-url https://api.openai.com/v1 `
  --model gpt-4.1-mini `
  --api-key $env:OPENAI_API_KEY `
  -o bookmarks.classified.html
```

PowerShell uses the backtick `` ` `` for line continuation, not Bash `\`.

Without `-o, --output`, MarkSweep writes next to the input file:

```txt
bookmarks.cleaned.html
bookmarks.classified.html
```

## Combine Commands

To remove broken links before classification, clean first and then classify the cleaned file:

```bash
marksweep clean bookmarks.html -o bookmarks.cleaned.html
marksweep classify bookmarks.cleaned.html -o bookmarks.classified.html
```

`classify` only runs AI classification. It does not re-check bookmark URLs.

## Commands

### `check`

Checks bookmark validity and prints a terminal report.

```bash
marksweep check bookmarks.html \
  --concurrency 20 \
  --timeout 10000 \
  --retries 2
```

Optional:

```txt
--json                  Print a JSON check report
```

### `clean`

Checks, deduplicates, and writes a cleaned HTML file.

```bash
marksweep clean bookmarks.html -o bookmarks.cleaned.html
```

Before deletion, MarkSweep asks what to remove:

- Clearly broken links are selected by default.
- Suspicious links are not selected by default.

Suspicious links that are kept are moved to `其他`.

### `classify`

Deduplicates bookmarks and sends them to the AI.

```bash
marksweep classify bookmarks.html \
  --base-url https://api.openai.com/v1 \
  --model gpt-4.1-mini \
  --api-key "$OPENAI_API_KEY" \
  --lang zh
```

To filter clearly broken links, run `clean` first and classify the generated HTML.

## Common Options

```txt
--concurrency <number>  Concurrent checks for check/clean. Default: 20
--timeout <ms>          URL timeout for check/clean. Default: 10000
--retries <number>      Failed request retries for check/clean. Default: 2
-o, --output <path>     Output HTML path
--check-report <path>   Let clean reuse a report from check --json
```

The output path cannot equal the input path.

## Check Rules

MarkSweep tries `HEAD` first and falls back to `GET` when needed. If `http://` fails, it also tries the matching `https://` URL.

Clearly broken:

- HTTP `404`, `410`
- HTTP `502`
- DNS failures, refused connections
- Empty responses, HTTP/2 protocol errors
- Timeouts confirmed by an extended retry

Suspicious:

- HTTP `401`, `403`, `429`
- Most `5xx`
- SSL/TLS errors
- Temporary network errors

Non-web protocols are skipped and kept, for example:

```txt
chrome://
edge://
about:
javascript:
file://
mailto:
```

## Proxy

MarkSweep uses proxies automatically:

- `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, and lowercase variants are used first.
- On macOS, if proxy environment variables are not set, static system proxy settings are read.

## AI Config

```txt
--base-url <url>        OpenAI-compatible API base URL
--model <name>          Model name
--compatibility <mode>  Compatibility mode: auto, openai, deepseek
--api-key <key>         API key
--lang <language>       Folder language. Default: zh
```

Config priority:

```txt
CLI options > environment variables > local config > interactive prompt
```

Supported environment variables:

```txt
MARKSWEEP_AI_BASE_URL
MARKSWEEP_AI_MODEL
MARKSWEEP_AI_API_KEY
MARKSWEEP_AI_COMPATIBILITY
OPENAI_BASE_URL
OPENAI_MODEL
OPENAI_API_KEY
MARKSWEEP_LANG
```

`auto` enables thinking-mode tool compatibility for `api.deepseek.com`; use `deepseek` explicitly for gateways.

Interactive AI config can be saved locally. The API key is stored as plain text in a local JSON file.

Default paths:

```txt
Windows: %APPDATA%\marksweep\config.json
macOS:   ~/Library/Application Support/marksweep/config.json
Linux:   ~/.config/marksweep/config.json
```

Override with `MARKSWEEP_CONFIG_PATH`.

## Page Fetching

During AI classification, the model fetches page content only when title and URL are not enough for classification.

Optional environment variables:

```txt
MARKSWEEP_FIRECRAWL_API_KEY
FIRECRAWL_API_KEY
MARKSWEEP_FIRECRAWL_BASE_URL
FIRECRAWL_BASE_URL
MARKSWEEP_JINA_API_KEY
JINA_API_KEY
```

## LangSmith

```txt
--langsmith
```

LangSmith is disabled by default. When enabled, it requires:

```bash
export LANGSMITH_API_KEY="<your-api-key>"
export LANGSMITH_PROJECT="default"
```

Windows PowerShell:

```powershell
$env:LANGSMITH_API_KEY = "<your-api-key>"
$env:LANGSMITH_PROJECT = "default"
```

If both variables are set, MarkSweep enables tracing automatically. You can also pass `--langsmith` explicitly.

Optional:

```bash
export LANGSMITH_TRACING=false
export LANGSMITH_ENDPOINT="https://api.smith.langchain.com"
```

Windows PowerShell:

```powershell
$env:LANGSMITH_TRACING = "false"
$env:LANGSMITH_ENDPOINT = "https://api.smith.langchain.com"
```

## Privacy

`check` and `clean` send validity-check requests to bookmark URLs.

`classify` sends bookmark titles and URLs to the configured AI provider. Page fetching may use Firecrawl, Jina Reader, or direct requests.

When LangSmith is enabled, prompts, outputs, and tool calls may also be sent to LangSmith.

## License

MIT
