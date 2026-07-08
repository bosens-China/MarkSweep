# MarkSweep PRD

## 1. 产品概述

MarkSweep 是一个基于 Node.js 与 TypeScript 编写的书签整理 CLI 工具，面向从浏览器导出的书签 HTML 文件。它提供两个核心能力：

1. 检测并清理明确无效的书签。
2. 调用 AI 根据书签标题与 URL 进行智能分类，并输出新的浏览器书签 HTML 文件。

工具默认不修改用户原始文件。所有清理和分类结果都输出到新 HTML 文件，用户可自行导入浏览器。

## 2. 目标用户

- 长期积累大量浏览器书签，希望清理失效链接的用户。
- 需要把杂乱书签重新归类的开发者、研究人员、内容收藏者。
- 希望通过 CLI、脚本或后续自动化流程批量处理书签文件的用户。

## 3. 支持范围

### 3.1 输入

仅支持浏览器导出的书签 HTML 文件，例如 Chrome、Edge、Firefox 导出的 `bookmarks.html`。

初版不支持：

- Chrome 本地 `Bookmarks` JSON 文件。
- 浏览器账号同步数据直接读取。
- 在线书签服务 API。

### 3.2 输出

- `check` 命令仅在 CLI 输出检测结果。
- `clean` 命令输出清理后的新 HTML 文件。
- `classify` 命令输出 AI 分类后的新 HTML 文件。

输入 HTML 参数必须提供。输出文件参数可选；如果未指定，CLI 自动生成默认输出文件名。

## 4. CLI 命令

### 4.1 `marksweep check <input>`

书签有效性检测。

行为：

- 解析输入 HTML 中的书签。
- 检测网页链接是否有效。
- 在终端输出统计、明确无效书签、可疑书签。
- 不生成新的书签 HTML 文件。
- 不修改原始输入文件。

示例：

```bash
marksweep check bookmarks.html
```

### 4.2 `marksweep clean <input>`

检测书签并输出新的清理后 HTML 文件。

行为：

- 解析输入 HTML。
- 检测书签有效性。
- 删除明确无效书签。
- 保留可疑书签，并放入“其他”分类。
- 对重复书签进行去重。
- 输出新的 HTML 文件。
- 不修改原始输入文件。

示例：

```bash
marksweep clean bookmarks.html --output bookmarks.cleaned.html
```

如果未指定 `--output`，默认输出为：

```txt
bookmarks.cleaned.html
```

### 4.3 `marksweep classify <input>`

AI 智能分类书签。

行为：

- 解析输入 HTML。
- 对重复书签进行去重。
- 默认使用书签 `title` 与 `url` 作为 AI 分类依据。
- 不保留原始目录结构。
- 由 AI 自行生成多层目录结构。
- 将每个书签放入 AI 生成的目录中。
- 可疑或无法分类的书签放入“其他”。
- 输出新的 HTML 文件。
- AI 调用失败时提示错误并中断，不生成半成品 HTML。

示例：

```bash
marksweep classify bookmarks.html --output bookmarks.classified.html
```

如果未指定 `--output`，默认输出为：

```txt
bookmarks.classified.html
```

## 5. 通用参数

### 5.1 输入输出

```bash
--output <path>
```

指定输出 HTML 文件路径。仅对 `clean` 和 `classify` 生效。

### 5.2 检测参数

```bash
--concurrency <number>
--timeout <ms>
--retries <number>
```

含义：

- `--concurrency`：并发检测数量。
- `--timeout`：单个 URL 检测超时时间，单位毫秒。
- `--retries`：失败后的重试次数。

### 5.3 AI 参数

```bash
--base-url <url>
--model <name>
--api-key <key>
--lang <language>
```

含义：

- `--base-url`：AI 服务的 OpenAI-compatible API Base URL。
- `--model`：AI 模型名称。
- `--api-key`：AI API Key。
- `--lang`：分类目录语言，默认中文。

AI 参数优先级：

```txt
CLI 参数 > 环境变量 > 交互式输入
```

环境变量建议：

```txt
MARKSWEEP_AI_BASE_URL
MARKSWEEP_AI_MODEL
MARKSWEEP_AI_API_KEY
OPENAI_BASE_URL
OPENAI_API_KEY
```

如果命令需要 AI，但关键参数没有通过 CLI 或环境变量提供，CLI 进入交互式输入流程。

## 6. 书签检测规则

检测应保持保守，避免误删用户仍然需要的书签。

### 6.1 明确无效，允许删除

以下情况在重试后仍失败时，判定为明确无效：

- HTTP `404`
- HTTP `410`
- DNS 不存在，例如 `ENOTFOUND`
- 连接被拒绝，例如 `ECONNREFUSED`
- 服务器空响应，例如 Chrome 中的 `ERR_EMPTY_RESPONSE`

截图中的“该网页无法正常运作 / 未发送任何数据 / ERR_EMPTY_RESPONSE”属于服务器空响应。该情况通常表示域名能解析并尝试连接，但服务端没有返回有效 HTTP 内容。CLI 应归类为：

```txt
status: broken
reason: empty_response
confidence: high
```

### 6.2 可疑，不默认删除

以下情况不默认删除：

- 超时 `timeout`
- HTTP `401`
- HTTP `403`
- HTTP `429`
- SSL / TLS 证书错误
- 疑似防爬、登录墙、访问频率限制
- 本机或当前网络可能异常导致的大面积失败

可疑书签在 `clean` 或 `classify` 输出中保留，并放入“其他”分类。

### 6.3 检测策略

- 优先尝试 `HEAD` 请求。
- `HEAD` 失败或不被支持时，回退到 `GET` 请求。
- 支持失败重试。
- 如果同一批检测中出现大面积网络失败，应提示用户本次检测可能不可靠。
- 非网页协议不进行有效性检测，例如：
  - `chrome://`
  - `edge://`
  - `about:`
  - `javascript:`
  - `file://`
  - `mailto:`

这些书签不删除，分类时保留。

## 7. 去重规则

`clean` 与 `classify` 默认去重。

去重依据：

- 使用规范化后的 URL。
- 协议和域名大小写不敏感。
- 去掉末尾 `/`。
- 保留 query。
- 保留 hash。

重复书签保留规则：

- 优先保留标题信息量更大的书签。
- 非空标题优先。
- 非泛化标题优先，例如避免优先保留 `首页`、`Untitled`、`Document`、`GitHub` 等过弱标题。
- 标题质量接近时，保留标题更长的项。

## 8. AI 分类规则

### 8.1 默认输入

AI 分类默认使用：

- 书签标题 `title`
- 书签 URL `url`

不使用原始目录结构作为输出依据，也不保留原目录。

### 8.2 Title 不明确的处理

当标题不明确时，后续由 agent/tool 自动抓取页面内容补充判断，不需要用户通过 CLI 参数显式指定。

初版 CLI 可先保留该能力的接口设计，不必实现完整网页内容抓取。

### 8.3 输出分类

- 默认语言为中文。
- 可通过 `--lang` 指定分类语言。
- 分类深度不做硬限制，交给 AI 判断。
- Prompt 中要求 AI 避免过度细分，保持目录数量适中。
- 无法判断、可疑、非网页协议或分类置信度不足的书签放入“其他”。

### 8.4 失败处理

AI 调用失败、响应无法解析、分类结果缺失书签时：

- 在 CLI 中提示明确错误。
- 中断命令。
- 不生成半成品 HTML。

## 9. HTML 生成要求

输出 HTML 应保持浏览器可导入格式，尽量兼容 Chrome、Edge、Firefox。

要求：

- 保留书签标题。
- 保留 URL。
- 尽量保留原始书签属性，例如 `ADD_DATE`、`LAST_MODIFIED`、`ICON`。
- 输出 AI 或清理后的新目录结构。
- 不修改原始输入文件。

## 10. 非目标

初版不做：

- 浏览器插件。
- GUI 图形界面。
- 自动读取浏览器本地数据库。
- 账号同步。
- 直接删除浏览器内书签。
- 云端存储用户书签。

## 11. 成功标准

- 用户可以通过 `check` 快速看到书签有效性概览。
- 用户可以通过 `clean` 获得删除明确坏链后的新 HTML。
- 用户可以通过 `classify` 获得 AI 多层分类后的新 HTML。
- 工具默认不破坏原始文件。
- 对可疑链接保持保守，不误删。
- 生成的 HTML 可以被主流浏览器重新导入。
