# MarkSweep

English documentation: [README.en.md](README.en.md)

MarkSweep 是一个基于 TypeScript 编写的书签清理与整理 CLI 工具。它面向浏览器导出的 `bookmarks.html` 文件，可以检测失效书签、保留可疑书签，并借助 AI 生成新的多层分类目录。

MarkSweep 默认不修改原始书签文件。`clean` 和 `classify` 命令都会输出新的 HTML 文件，用户可以再将结果导入 Chrome、Edge、Firefox 等支持 Netscape 书签格式的浏览器。

## 功能特性

- 解析浏览器导出的 `.html` 和 `.htm` 书签文件。
- 按并发数、超时时间和重试次数检测书签有效性。
- 只删除明确无效的链接，例如 HTTP `404`、HTTP `410`、DNS 失败、连接被拒绝和重复空响应。
- 保留超时、HTTP `401`、HTTP `403`、HTTP `429`、SSL 证书错误和疑似防爬等可疑链接。
- 按规范化 URL 去重，并优先保留标题信息量更高的书签。
- 生成浏览器可重新导入的书签 HTML 文件。
- 使用 OpenAI 兼容 API 对有效书签进行 AI 分类。
- 通过 LangChain 工具按需抓取页面内容，支持 Firecrawl、Jina Reader 和普通 HTML 抽取。

## 安全模型

MarkSweep 的默认策略偏保守。

- 不修改原始书签文件。
- `check` 只在终端输出检测报告。
- `clean` 输出新的清理后 HTML 文件。
- `classify` 输出新的 AI 分类后 HTML 文件。
- 可疑链接保留，不默认删除。
- AI 调用失败时中断命令，不输出半成品分类文件。

## 环境要求

- Node.js `>=20`
- 本地开发建议使用 pnpm

## 安装

从 npm 安装（包发布后）：

```bash
npm install -g @boses/marksweep
```

本地开发：

```bash
git clone <repo-url>
cd MarkSweep
pnpm install
pnpm build
```

运行本地 CLI：

```bash
pnpm dev -- --help
```

运行构建产物：

```bash
node dist/cli.js --help
```

## 快速上手

先从浏览器导出书签 HTML 文件，然后运行检测命令：

```bash
marksweep check bookmarks.html
```

清理明确无效的书签，并输出新文件：

```bash
marksweep clean bookmarks.html --output bookmarks.cleaned.html
```

调用 AI 分类有效书签，并输出新文件：

```bash
marksweep classify bookmarks.html \
  --base-url https://api.openai.com/v1 \
  --model gpt-4.1-mini \
  --api-key "$OPENAI_API_KEY" \
  --output bookmarks.classified.html
```

如果不指定 `--output`，MarkSweep 会在输入文件同级目录生成默认文件：

```txt
bookmarks.cleaned.html
bookmarks.classified.html
```

## 命令

### `marksweep check <input>`

检测书签有效性，并在终端输出结果。

```bash
marksweep check bookmarks.html \
  --concurrency 20 \
  --timeout 10000 \
  --retries 2
```

该命令不会写入新的书签 HTML 文件。

### `marksweep clean <input>`

检测书签、去重、删除明确无效链接、保留可疑链接，并输出新的 HTML 文件。

```bash
marksweep clean bookmarks.html --output bookmarks.cleaned.html
```

可疑书签会被移动到 `其他` 目录。

### `marksweep classify <input>`

去重并检测书签，然后将有效书签交给 OpenAI 兼容模型生成新的多层目录。

```bash
marksweep classify bookmarks.html \
  --base-url https://api.openai.com/v1 \
  --model gpt-4.1-mini \
  --api-key "$OPENAI_API_KEY" \
  --lang zh
```

该命令不保留原始目录结构。MarkSweep 会先检测链接，只把有效书签发送给 AI；可疑书签和非网页协议书签会保留在 `其他` 目录；明确无效书签不会进入输出文件。

## 参数

### 检测参数

```txt
--concurrency <number>  并发检测数量，默认 20
--timeout <ms>          单个 URL 检测超时时间，默认 10000 ms
--retries <number>      失败后的重试次数，默认 2
```

### 输出参数

```txt
-o, --output <path>     clean/classify 的输出 HTML 路径
```

输出路径不能与输入路径相同。

### AI 参数

```txt
--base-url <url>        OpenAI 兼容 API 的 Base URL
--model <name>          AI 模型名称
--api-key <key>         AI API Key
--lang <language>       分类目录语言，默认 zh
```

AI 配置优先级：

```txt
CLI 参数 > 环境变量 > 本地配置 > 交互式输入
```

支持的环境变量：

```txt
MARKSWEEP_AI_BASE_URL
MARKSWEEP_AI_MODEL
MARKSWEEP_AI_API_KEY
OPENAI_BASE_URL
OPENAI_MODEL
OPENAI_API_KEY
MARKSWEEP_LANG
```

如果在交互式输入中填写 AI 配置，MarkSweep 会询问是否保存到本机。确认后，`baseUrl`、`model`、`apiKey` 和 `lang` 会保存到本地 JSON 配置文件。API Key 会以明文保存在本机。

默认配置路径：

```txt
Windows: %APPDATA%\marksweep\config.json
macOS:   ~/Library/Application Support/marksweep/config.json
Linux:   ~/.config/marksweep/config.json
```

可以通过下面的环境变量覆盖配置路径：

```txt
MARKSWEEP_CONFIG_PATH
```

### LangSmith 参数

LangSmith 追踪默认关闭。启用后，MarkSweep 会追踪 `classify` 的 AI 调用，以及 LangChain 的模型和工具步骤。

```txt
--langsmith                    启用 LangSmith 追踪
--langsmith-api-key <key>      LangSmith API Key
--langsmith-project <name>     LangSmith 项目名，默认 marksweep
--langsmith-endpoint <url>     LangSmith API Endpoint
--langsmith-workspace-id <id>  LangSmith Workspace ID
--langsmith-hide-inputs        发送追踪前隐藏输入
--langsmith-hide-outputs       发送追踪前隐藏输出
```

等价环境变量：

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

示例：

```bash
marksweep classify bookmarks.html \
  --base-url https://api.openai.com/v1 \
  --model gpt-4.1-mini \
  --api-key "$OPENAI_API_KEY" \
  --langsmith \
  --langsmith-api-key "$LANGSMITH_API_KEY" \
  --langsmith-project marksweep-dev
```

## 链接检测规则

MarkSweep 只删除重试后仍明确无效的链接：

- HTTP `404`
- HTTP `410`
- DNS 失败，例如 `ENOTFOUND`
- 连接被拒绝，例如 `ECONNREFUSED`
- 重复空响应，例如 Chrome 中的 `ERR_EMPTY_RESPONSE`

MarkSweep 会保留可疑链接：

- 超时
- HTTP `401`
- HTTP `403`
- HTTP `429`
- SSL/TLS 证书错误
- 服务器错误
- 疑似登录墙、防爬页面或临时网络问题

非网页协议会跳过检测并保留：

```txt
chrome://
edge://
about:
javascript:
file://
mailto:
```

## AI 页面抓取工具

分类器会暴露一个名为 `fetch_web_page` 的 LangChain 工具。

模型会自行决定是否调用该工具。提示词要求模型只在书签标题过于模糊、无法仅凭标题和 URL 分类时，才抓取额外页面内容。

工具会按以下顺序尝试页面内容来源：

1. 配置了 Firecrawl API Key 时，优先使用 Firecrawl。
2. 使用 Jina Reader。
3. 直接抓取普通 HTML 并抽取正文。

可选环境变量：

```txt
MARKSWEEP_FIRECRAWL_API_KEY
FIRECRAWL_API_KEY
MARKSWEEP_FIRECRAWL_BASE_URL
FIRECRAWL_BASE_URL
MARKSWEEP_JINA_API_KEY
JINA_API_KEY
```

Firecrawl 适合 JavaScript 较重的页面。Jina Reader 可以返回更适合 LLM 阅读的文本，并能处理不少渲染页面。普通 HTML 回退适合 SSR 或静态页面。

## 去重规则

`clean` 和 `classify` 默认按规范化 URL 去重。

规范化规则：

- 协议和域名不区分大小写。
- 去掉末尾 `/`。
- 保留 query。
- 保留 hash。

发现重复书签时，MarkSweep 会保留标题信息量更高、元数据更丰富的书签。

## 开发

安装依赖：

```bash
pnpm install
```

运行测试：

```bash
pnpm test
```

运行 TypeScript 检查：

```bash
pnpm build
```

运行 ESLint：

```bash
pnpm lint
```

发布前建议运行：

```bash
pnpm test
pnpm build
pnpm lint
pnpm pack --dry-run
```

## 项目结构

```txt
src/
  bookmarks/   URL 规范化与去重
  checker/     书签有效性检测
  classifier/  AI 分类与页面抓取工具
  cli/         CLI 配置与终端输出
  parser/      浏览器书签 HTML 解析器
  report/      检测结果分组工具
  writer/      浏览器可导入的书签 HTML 生成器
tests/         Vitest 测试
docs/          PRD 与实现 TODO
```

## 测试状态

测试套件覆盖以下关键路径：

- 基于真实浏览器书签导出的解析行为。
- URL 规范化与去重。
- 链接状态分类。
- HTML 输出。
- AI 分类结果校验。
- 页面抓取回退行为。
- CLI 命令注册，以及 `clean` / `classify` 集成路径。

运行：

```bash
pnpm test
```

## 隐私说明

`check`、`clean` 和 `classify` 会向书签 URL 发送网络请求，用于判断链接状态。

`classify` 会将有效书签的标题和 URL 发送给配置的 AI 服务。当 AI 调用 `fetch_web_page` 时，MarkSweep 可能会把选中的 URL 发送给 Firecrawl、Jina Reader，或直接抓取页面内容。

如果选择保存交互式 AI 配置，MarkSweep 会把 API Key 明文保存在本机 JSON 配置文件中。请保护该文件，不要将其放入代码仓库。

如果启用 LangSmith 追踪，分类提示词、输出和工具活动也可能发送到 LangSmith。需要追踪元数据但不保存书签内容时，可以使用 `--langsmith-hide-inputs` 和 `--langsmith-hide-outputs`。

如果书签包含敏感 URL，请先确认你可以接受这些元数据发送给对应的服务提供方，再运行 AI 分类。

## 后续计划

- 可选 JSON 报告。
- 面向大型书签文件的分批 AI 分类。
- 测试覆盖率报告。
- 更多浏览器导入兼容性 fixture。
- 可选的提供商集成测试。

## 贡献

欢迎提交 issue 和 pull request。

请使用 Conventional Commit 消息，便于 Release Please 推断版本：

```txt
fix: handle empty bookmark titles
feat: add a new classifier option
feat!: change the classified HTML format
```

CI 在 Node.js 24 上运行。版本发布由 Release Please 管理。合并生成的 release PR 后，会更新 `package.json` 和 `CHANGELOG.md`，创建 GitHub Release，并通过 Trusted Publishing 发布 `@boses/marksweep` 到 npm。

发布说明见 [docs/PUBLISHING.md](docs/PUBLISHING.md)。

如果变更会影响行为，请补充测试并运行：

```bash
pnpm test
pnpm build
pnpm lint
```

## 许可证

MIT
