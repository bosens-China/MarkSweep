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

不指定 `-o, --output` 时，会在输入文件旁生成：

```txt
bookmarks.cleaned.html
bookmarks.classified.html
```

## 复用检测报告

先检测一次，再复用结果执行清理或分类：

```bash
marksweep check bookmarks.html --json > report.json
marksweep clean bookmarks.html --check-report report.json -o bookmarks.cleaned.html
marksweep classify bookmarks.html --check-report report.json -o bookmarks.classified.html
```

这样可以避免重复请求所有书签 URL。

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

检测、去重，然后只把有效书签交给 AI 分类。

```bash
marksweep classify bookmarks.html \
  --base-url https://api.openai.com/v1 \
  --model gpt-4.1-mini \
  --api-key "$OPENAI_API_KEY" \
  --lang zh
```

可疑链接和非网页协议会保留在 `其他` 目录。明确无效链接不会进入输出文件。

## 常用参数

```txt
--concurrency <number>  并发检测数量，默认 20
--timeout <ms>          单个 URL 超时时间，默认 10000
--retries <number>      失败重试次数，默认 2
-o, --output <path>     输出 HTML 路径
--check-report <path>   复用 check --json 生成的报告
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
OPENAI_BASE_URL
OPENAI_MODEL
OPENAI_API_KEY
MARKSWEEP_LANG
```

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
--langsmith-api-key <key>
--langsmith-project <name>
--langsmith-endpoint <url>
--langsmith-workspace-id <id>
--langsmith-hide-inputs
--langsmith-hide-outputs
```

LangSmith 默认关闭。

## 隐私

`check`、`clean` 和 `classify` 会向书签 URL 发送请求。

`classify` 会把有效书签的标题和 URL 发送给配置的 AI 服务。页面抓取可能请求 Firecrawl、Jina Reader，或直接访问目标页面。

启用 LangSmith 后，提示词、输出和工具调用也可能发送到 LangSmith。可以用 `--langsmith-hide-inputs` 和 `--langsmith-hide-outputs` 隐藏输入输出。

## 许可证

MIT
