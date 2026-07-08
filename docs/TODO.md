# MarkSweep TODO

## Phase 0: Project Setup

- [x] 初始化 TypeScript CLI 项目基础配置。
- [x] 配置 `package.json` 的 `bin`、`scripts`、`files`、`engines`。
- [x] 配置 `tsconfig.json`。
- [x] 安装运行时依赖：
  - [x] `langchain`
  - [x] `@langchain/openai`
  - [x] `commander`
  - [x] `@inquirer/prompts`
  - [x] `cheerio`
  - [x] `p-limit`
  - [x] `undici`
  - [x] `zod`
  - [x] `dotenv`
  - [x] `chalk`
  - [x] `ora`
- [x] 安装开发依赖：
  - [x] `typescript`
  - [x] `tsx`
  - [x] `@types/node`
  - [x] `vitest`
  - [x] `eslint`
  - [x] `typescript-eslint`
- [x] 配置 pnpm 允许 `esbuild` 执行构建脚本。
- [x] 添加基础目录：
  - [x] `src/cli.ts`
  - [x] `src/parser/`
  - [x] `src/checker/`
  - [x] `src/classifier/`
  - [x] `src/writer/`
  - [x] `src/report/`
- [x] 完善 lint / format 策略。

## Phase 1: Bookmark HTML Parser

- [x] 解析浏览器导出的书签 HTML。
- [x] 提取书签：
  - [x] `id`
  - [x] `title`
  - [x] `url`
  - [x] 原始属性
  - [x] 原目录路径，仅用于内部参考
- [x] 识别文件夹层级。
- [x] 识别非网页协议书签。
- [x] 为每个书签生成稳定内部 ID。
- [x] 添加解析失败时的错误提示。

## Phase 2: URL Normalization And Deduplication

- [x] 实现 URL 规范化。
- [x] 协议和域名大小写归一。
- [x] 去掉末尾 `/`。
- [x] 保留 query。
- [x] 保留 hash。
- [x] 实现重复书签识别。
- [x] 实现重复书签保留策略。
- [x] 为去重结果生成报告数据。

## Phase 3: Bookmark Checker

- [x] 实现并发检测。
- [x] 支持 `--concurrency`。
- [x] 支持 `--timeout`。
- [x] 支持 `--retries`。
- [x] 优先使用 `HEAD` 请求。
- [x] `HEAD` 失败后回退到 `GET`。
- [x] 分类 HTTP 状态：
  - [x] `2xx/3xx` 为有效
  - [x] `404/410` 为明确无效
  - [x] `401/403/429` 为可疑
- [x] 分类网络错误：
  - [x] `ENOTFOUND` 为明确无效
  - [x] `ECONNREFUSED` 为明确无效
  - [x] empty response 为明确无效
  - [x] timeout 为可疑
  - [x] SSL/TLS 错误为可疑
- [x] 检测大面积网络失败并提示。
- [x] 跳过非网页协议检测。
- [x] 输出 `check` 命令的终端摘要。

## Phase 4: Clean Command

- [x] 实现 `marksweep clean <input>`。
- [x] 删除明确无效书签。
- [x] 保留可疑书签。
- [x] 将可疑书签放入“其他”。
- [x] 默认去重。
- [x] 支持 `--output`。
- [x] 未指定 `--output` 时生成默认文件名。
- [x] 保证不修改原始输入文件。

## Phase 5: AI Classifier

- [x] 实现 AI 配置解析：
  - [x] CLI 参数
  - [x] 环境变量
  - [x] 交互式输入
- [x] 支持 `--base-url`。
- [x] 支持 `--model`。
- [x] 支持 `--api-key`。
- [x] 支持 `--lang`，默认中文。
- [x] 基于 LangChain 调用 OpenAI-compatible API。
- [x] 设计 AI 分类 prompt。
- [x] 要求 AI 返回结构化 JSON。
- [x] 校验 AI 返回结果。
- [x] 确认所有书签都被分类。
- [x] 分类失败时中断，不输出半成品。
- [x] 将无法分类书签放入“其他”。

## Phase 6: HTML Writer

- [x] 生成浏览器可导入 HTML。
- [x] 支持多层目录输出。
- [x] 保留书签标题和 URL。
- [x] 尽量保留原始属性。
- [x] 输出 cleaned HTML。
- [x] 输出 classified HTML。
- [x] 用浏览器导入格式样例验证兼容性。

## Phase 7: CLI Polish

- [x] 实现 `marksweep check <input>` 的 CLI 入口与参数解析。
- [x] 实现 `marksweep clean <input>` 的 CLI 入口与参数解析。
- [x] 实现 `marksweep classify <input>` 的 CLI 入口与参数解析。
- [x] 为缺失输入文件提供清晰错误。
- [x] 为不存在的 HTML 文件提供清晰错误。
- [x] 为 AI 参数缺失提供交互式提示。
- [x] 添加彩色终端输出。
- [x] 添加进度提示。
- [x] 添加 `--help` 文案。

## Phase 8: Tests

- [x] 添加解析器单元测试。
- [x] 添加 URL 规范化测试。
- [x] 添加去重测试。
- [x] 添加检测规则测试。
- [x] 添加 HTML 输出快照测试。
- [x] 添加 AI 返回结构校验测试。
- [x] 添加 CLI smoke test。

## Phase 9: Release Preparation

- [x] 编写 `README.md`。
- [x] 补充 npm 发布字段。
- [x] 确认 `bin` 可执行。
- [x] 构建产物进入 `dist/`。
- [x] 发布前 dry run：
  - [x] `pnpm build`
  - [x] `pnpm pack --dry-run`
- [x] 准备初版 npm 发布。
