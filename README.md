# MarkSweep

本地书签工作台：导入浏览器书签，通过 UI 检测失效链接、清理重复收藏、调整目录，并借助 AI 分类或审计疑似过时的技术内容。

界面使用 React、Ant Design 和 Vite，后端使用 Hono。所有网络检测与 AI 请求由本机 Node 服务执行，浏览器通过 WebSocket 接收任务进度。

## 本地开发

需要 Node.js 22.19+ 和项目指定的 pnpm 版本。

```bash
pnpm install
pnpm dev
```

启动后自动打开浏览器。前端支持 Vite 热更新，后端代码修改后自动重启。按 Ctrl+C 停止服务。

## 构建与运行

```bash
pnpm build
pnpm start
```

默认自动选择空闲端口，只监听 `127.0.0.1`。可指定端口或禁用自动打开浏览器：

```bash
pnpm start --port 3000 --no-open
```

发布新版 npm 包后，用户可通过 `npx @boses/marksweep@latest` 启动工作台。当前开发中的 UI 尚未发布；此前发布的版本仍使用旧 CLI。

## 使用流程

1. 拖入浏览器导出的 `.html` 或 `.htm` 书签文件，最大 10 MB。
2. 在目录树和表格中搜索、筛选、编辑、批量移动或删除书签。
3. 按需执行 URL 去重、链接检测或过时内容审计。在右侧“AI 整理对话”输入要求（可留空），点击“开始整理”。
4. 每轮完成后，点击“查看整理结果”展开目录和书签，或“查看变更”对比标题、目录与理由。可以继续输入要求调整，也可恢复到本轮之前，或使用任意历史结果继续整理。
5. 检查工作副本，再导出新的 HTML 文件并导入浏览器。审计报告可单独下载为 Markdown。

整理对话使用 Deep Agents TypeScript SDK，展示处理说明、工具状态和流式正文。模型提供的推理内容单独折叠显示；不保证每个模型都提供。每轮保留独立快照，历史卡片始终查看对应轮次；当前工作副本是下一轮的真实输入，手动编辑或切换历史版本后也可继续。对话和结果一同保存到恢复缓存；请求最多携带最近 40 轮，超出时保留首轮要求。网页证据缓存仅在同一 WebSocket 会话内复用，刷新后按需重新采集。

OpenAI 兼容模式支持逐段显示正文；DeepSeek 兼容模式沿用已有适配器，按完整模型消息显示正文和可用的推理内容，并保留工具调用所需的 `reasoning_content`。

新整理流程由 Crawlee 在本机批量读取公开 HTTP(S) 网页，每批最多 8 项、最多 4 个并发、失败最多重试 2 次，遵守 robots.txt；采集总量由设置中的页面上限控制。正文由 mdream 的纯 JavaScript 实现 `@mdream/js` 转为 Markdown，保留标题、列表、代码块和链接；证据摘录不足时可继续读取缓存正文。原文仍不足以判断时，AI 可批量查阅引用、官网或其他相关公开页面，必须关联已读取的来源和具体疑问，最多扩展两层、每个书签最多尝试三个补充页面，且与原文共用本轮页面预算。补充资料不会自动加入书签；当前没有搜索引擎工具。暂不启动浏览器执行网页 JavaScript，也不自动登录；失败或证据不足的项目保留并待复核。每轮默认最多运行 10 分钟，可在设置中调整为 1–30 分钟，取消或失败不应用本轮结果。AI 只能修改标题与目录，完整整理必须覆盖全部原始 ID，局部调整只提交变更项并由程序保留其余书签；不会更改链接或自动删除书签。

续聊默认只发送当前目录概览，AI 通过 `find_bookmarks` 按关键词读取候选书签；全局调整可分页读取全部元数据。界面记录每次模型请求、首次流式响应、工具执行和整轮耗时，服务返回用量时显示 token 数。模型与并行工具的耗时不能直接相加；网页卡片同时展示资料来源、末次请求与解析、Markdown 转换和尝试次数。

采集拒绝本机、内网和保留地址。若 TUN 将域名解析为 `198.18.0.0/15` 合成地址，会通过 Cloudflare DNS-over-HTTPS 复核域名的公开地址（仅发送域名）；复核失败则不采集。

删除与分类只修改当前页面中的工作副本，不会覆盖原始文件。可使用“恢复原始”回到导入状态。工作副本、检测结果和审计文本会自动保存到浏览器 IndexedDB；当前标签页在相同地址刷新后会自动恢复，未完成任务不会自动重启。底部显示缓存保存状态；尚未保存或缓存不可用时，离开页面会提示。缓存不是备份，请及时导出。关闭标签页、清理浏览器数据或更换端口后，不保证能恢复。可通过“清空工作台”移除当前标签页的工作副本及缓存。

检测任务会区分有效、失效、待复核和跳过。网络不稳定、访问限制或需要登录时，请先人工复核。AI 审计只提供建议，不会自动删除书签，也不保证已核验最新版本信息。

长任务通过 WebSocket 启动，实时显示检测进度和审计文本。可取消任务；关闭页面或断开连接会取消后台工作。重连不会恢复之前的任务。HTTP 用于文件导入、导出及配置读写。

工具栏支持导入、导出 JSON 检测报告，兼容旧 CLI 的 `check --json` 格式。导入时按 URL 匹配当前书签，保留当前标题、目录和属性，并显示未覆盖数量；不会重新访问链接。导出只包含当前工作副本中已有结果的书签，部分检测结果也可保存。历史结果不代表当前网站状态，清理前请复核。

## AI 配置

打开右上角“设置”，填写 Base URL、模型和 API Key。页面填写的配置默认仅在当前页面生效；API Key 留空时复用本机已有配置。点击“保存 AI 配置到本机”并确认后，会写入现有本机配置文件；密钥以明文保存，留空不会覆盖已保存的密钥，环境变量仍优先。保存使用临时文件与原子替换，避免写入失败时截断旧配置。密钥不进入浏览器恢复缓存。

配置优先级：页面输入 > 环境变量 > 本机配置文件。支持以下环境变量：

```dotenv
MARKSWEEP_AI_BASE_URL=https://api.openai.com/v1
MARKSWEEP_AI_MODEL=your-model
MARKSWEEP_AI_API_KEY=your-api-key
MARKSWEEP_AI_COMPATIBILITY=auto
MARKSWEEP_LANG=zh
```

也支持 `OPENAI_BASE_URL`、`OPENAI_MODEL` 和 `OPENAI_API_KEY`。启动时读取当前目录的 `.env`。

本机配置文件位置：

- macOS：`~/Library/Application Support/marksweep/config.json`
- Windows：`%APPDATA%/marksweep/config.json`
- Linux：`~/.config/marksweep/config.json`

可通过 `MARKSWEEP_CONFIG_PATH` 指定其他位置。已有配置文件继续兼容；后端不会把其中的 API Key 返回给页面。

独立的过时审计及旧 CLI 分类继续复用 Firecrawl → Jina Reader → 直接读取 HTML 的回退逻辑，支持 `FIRECRAWL_API_KEY`、`FIRECRAWL_BASE_URL` 和 `JINA_API_KEY`。新整理对话使用 Crawlee，不需要采集服务密钥。页面上限默认 20，设为 0 时仅使用书签元数据。

可在本机配置 `LANGSMITH_API_KEY`、`LANGSMITH_PROJECT` 和可选的 `LANGSMITH_ENDPOINT`，并在 UI 中控制是否启用追踪。启用后，任务工具栏会显示“查看 LangSmith 追踪”入口；追踪提交失败会显示提示，不会丢弃已完成的 AI 结果。

## 项目结构

```text
apps/web/       React + Ant Design 界面与 Vite 配置
apps/server/    Hono API、WebSocket 任务与本地启动入口
packages/core/  解析、去重、检测、AI、HTML 导出和共享消息类型
src/            保留用于回归验证的旧 CLI 实现，不再作为 npm 启动入口
tests/          核心模块、API、WebSocket 和界面数据逻辑测试
```

采用轻量 pnpm workspace。内部包不单独发布；构建会把 Core 合入服务端产物，把界面与服务一起放进根 npm 包。

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm pack --dry-run
```

## 隐私与运行边界

服务只对本机开放，并校验 Host、Origin 和任务参数。API 与 WebSocket 数据上限为 16 MB。

导入、编辑和去重在本机进行。检测会访问书签 URL；AI 分类和审计会把标题、URL、原目录以及必要页面内容发送给配置的 AI 服务。网页抓取可能使用第三方服务；启用 LangSmith 后，提示词、输出和工具调用也会发送给 LangSmith。

完整工作台需要本地 Node 服务，不能仅靠 GitHub Pages 运行。GitHub Pages 可另作介绍或演示站，本次未配置静态发布。

OpenAI 兼容模式可填写任意服务的 Base URL 和模型 ID，不做厂商白名单限制。适配器会保留工具调用消息的 `reasoning_content`，支持要求回传思考内容的服务。MiMo 接入示例：Base URL 为 `https://api.xiaomimimo.com/v1`，模型填写服务提供的 ID（如 `mimo-v2.6-flash`），兼容模式选择 OpenAI；密钥仅保存在本机配置，不写入仓库。
