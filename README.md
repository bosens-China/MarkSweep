# MarkSweep

<img src="assets/logo-marksweep.png" alt="MarkSweep logo" width="160" />

English: [README.en.md](README.en.md)

MarkSweep 是一个 TypeScript 书签整理 CLI。它读取浏览器导出的 `bookmarks.html`，检测失效链接，清理或重新分类书签，并输出新的 HTML 文件。

默认不会修改原始文件。

## 安装

```bash
npm install -g @boses/marksweep
```

本地开发：

```bash
pnpm install
pnpm dev -- --help
```

构建后运行：

```bash
pnpm build
node dist/cli.js --help
```

## 快速使用

检测书签：

```bash
marksweep check bookmarks.html
```

清理书签：

```bash
marksweep clean bookmarks.html -o bookmarks.cleaned.html
```

AI 分类：

```bash
marksweep classify bookmarks.html \
  --base-url https://api.openai.com/v1 \
  --model gpt-4.1-mini \
  --api-key "$OPENAI_API_KEY" \
  -o bookmarks.classified.html
```

Windows PowerShell：

```powershell
marksweep classify bookmarks.html `
  --base-url https://api.openai.com/v1 `
  --model gpt-4.1-mini `
  --api-key $env:OPENAI_API_KEY `
  -o bookmarks.classified.html
```

PowerShell 多行命令使用反引号 `` ` ``，不要使用 Bash 的 `\`。

不指定 `-o, --output` 时，会在输入文件旁生成：

```txt
bookmarks.cleaned.html
bookmarks.classified.html
```

## 组合使用

如果想先删除坏链再分类，先清理，再把清理后的文件交给 AI 分类：

```bash
marksweep clean bookmarks.html -o bookmarks.cleaned.html
marksweep classify bookmarks.cleaned.html -o bookmarks.classified.html
```

`classify` 只负责 AI 分类，不会重复检测书签有效性。

## 命令

### `check`

检测书签有效性，并在终端输出报告。

```bash
marksweep check bookmarks.html \
  --concurrency 20 \
  --timeout 10000 \
  --retries 2
```

可选：

```txt
--json                  输出 JSON 检测报告
```

### `clean`

检测、去重，并输出新的清理后 HTML。

```bash
marksweep clean bookmarks.html -o bookmarks.cleaned.html
```

删除前会进入交互选择：

- 明确无效：默认勾选。
- 可疑链接：默认不勾选。

未删除的可疑链接会放入 `其他` 目录。

### `classify`

去重，然后把书签交给 AI 分类。

```bash
marksweep classify bookmarks.html \
  --base-url https://api.openai.com/v1 \
  --model gpt-4.1-mini \
  --api-key "$OPENAI_API_KEY" \
  --lang zh
```

如需过滤明确无效链接，先运行 `clean`，再对生成的 HTML 执行 `classify`。

## 常用参数

```txt
--concurrency <number>  check/clean 并发检测数量，默认 20
--timeout <ms>          check/clean 单个 URL 超时时间，默认 10000
--retries <number>      check/clean 失败重试次数，默认 2
-o, --output <path>     输出 HTML 路径
--check-report <path>   clean 复用 check --json 生成的报告
```

输出路径不能与输入路径相同。

## 检测规则

MarkSweep 会先尝试 `HEAD`，必要时回退到 `GET`。如果 `http://` 失败，会再尝试对应的 `https://`。

明确无效：

- HTTP `404`、`410`
- HTTP `502`
- DNS 失败、连接拒绝
- 空响应、HTTP/2 协议错误
- 加长超时后仍失败

可疑：

- HTTP `401`、`403`、`429`
- 大部分 `5xx`
- SSL/TLS 错误
- 临时网络错误

非网页协议会跳过检测并保留，例如：

```txt
chrome://
edge://
about:
javascript:
file://
mailto:
```

## 代理

MarkSweep 会自动使用代理：

- 优先读取 `HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY` 及其小写形式。
- macOS 下没有环境变量时，会读取系统静态代理设置。

## AI 配置

```txt
--base-url <url>        OpenAI 兼容 API Base URL
--model <name>          模型名称
--compatibility <mode>  兼容模式：auto、openai、deepseek
--api-key <key>         API Key
--lang <language>       分类目录语言，默认 zh
```

配置优先级：

```txt
CLI 参数 > 环境变量 > 本地配置 > 交互输入
```

支持环境变量：

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

`auto` 会为 `api.deepseek.com` 启用思考模式工具调用兼容；代理网关可显式使用 `deepseek`。

交互输入的 AI 配置可以保存到本机。API Key 会以明文写入本地 JSON 文件。

默认路径：

```txt
Windows: %APPDATA%\marksweep\config.json
macOS:   ~/Library/Application Support/marksweep/config.json
Linux:   ~/.config/marksweep/config.json
```

可用 `MARKSWEEP_CONFIG_PATH` 覆盖。

## 页面抓取

AI 分类时，模型只在标题和 URL 不足以判断分类时抓取页面内容。

可选环境变量：

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

LangSmith 默认关闭。启用时需要环境变量：

```bash
export LANGSMITH_API_KEY="<your-api-key>"
export LANGSMITH_PROJECT="default"
```

Windows PowerShell：

```powershell
$env:LANGSMITH_API_KEY = "<your-api-key>"
$env:LANGSMITH_PROJECT = "default"
```

如果设置了上面两个变量，MarkSweep 会自动开启追踪。也可以显式传 `--langsmith` 开启。

可选：

```bash
export LANGSMITH_TRACING=false
export LANGSMITH_ENDPOINT="https://api.smith.langchain.com"
```

Windows PowerShell：

```powershell
$env:LANGSMITH_TRACING = "false"
$env:LANGSMITH_ENDPOINT = "https://api.smith.langchain.com"
```

## 隐私

`check` 和 `clean` 会向书签 URL 发送有效性检测请求。

`classify` 会把书签标题和 URL 发送给配置的 AI 服务。页面抓取可能请求 Firecrawl、Jina Reader，或直接访问目标页面。

启用 LangSmith 后，提示词、输出和工具调用也可能发送到 LangSmith。

## 许可证

MIT
