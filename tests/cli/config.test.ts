import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  type AiConfigPrompts,
  assertWritableOutputPath,
  maskSecret,
  parseNonNegativeInteger,
  parsePositiveInteger,
  readBookmarkHtmlFile,
  resolveAiConfig,
  resolveDefaultOutputPath,
  resolveOutputPath,
  resolveWebPageFetcherConfig,
} from "../../src/cli/config";
import { getDefaultUserConfigPath, loadUserConfig, saveUserConfig } from "../../src/cli/user-config";

describe("CLI config helpers", () => {
  it("builds default output paths next to the input file", () => {
    const input = path.join("tmp", "bookmarks_2026_7_8.html");

    expect(resolveDefaultOutputPath(input, "cleaned")).toBe(path.resolve("tmp", "bookmarks_2026_7_8.cleaned.html"));
    expect(resolveDefaultOutputPath(input, "classified")).toBe(
      path.resolve("tmp", "bookmarks_2026_7_8.classified.html"),
    );
  });

  it("uses explicit output when provided", () => {
    expect(resolveOutputPath("bookmarks.html", "out/result.html", "cleaned")).toBe(path.resolve("out/result.html"));
  });

  it("parses integer options", () => {
    expect(parsePositiveInteger("20")).toBe(20);
    expect(parseNonNegativeInteger("0")).toBe(0);
    expect(parseNonNegativeInteger("2")).toBe(2);
  });

  it("rejects invalid integer options", () => {
    expect(() => parsePositiveInteger("0")).toThrow("必须是大于 0 的整数");
    expect(() => parsePositiveInteger("1.5")).toThrow("必须是大于 0 的整数");
    expect(() => parseNonNegativeInteger("-1")).toThrow("必须是大于等于 0 的整数");
  });

  it("resolves AI config with CLI options before environment variables", async () => {
    const config = await resolveAiConfig(
      {
        baseUrl: "https://cli.example.com/v1",
        model: "cli-model",
        apiKey: "cli-key",
        lang: "en",
      },
      {
        userConfig: { version: 1 },
        interactive: false,
        env: {
          MARKSWEEP_AI_BASE_URL: "https://env.example.com/v1",
          MARKSWEEP_AI_MODEL: "env-model",
          MARKSWEEP_AI_API_KEY: "env-key",
          MARKSWEEP_LANG: "zh",
        },
      },
    );

    expect(config).toEqual({
      baseUrl: "https://cli.example.com/v1",
      model: "cli-model",
      apiKey: "cli-key",
      lang: "en",
    });
  });

  it("does not read local config when CLI and environment already provide all AI values", async () => {
    const directory = path.join(tmpdir(), `marksweep-skip-local-${Date.now()}`);
    await mkdir(directory);
    const configPath = path.join(directory, "config.json");
    await writeFile(configPath, "{not-json", "utf8");

    await expect(
      resolveAiConfig(
        {
          baseUrl: "https://cli.example.com/v1",
          model: "cli-model",
          apiKey: "cli-key",
          lang: "en",
        },
        {
          interactive: false,
          env: {},
          configPath,
        },
      ),
    ).resolves.toEqual({
      baseUrl: "https://cli.example.com/v1",
      model: "cli-model",
      apiKey: "cli-key",
      lang: "en",
    });
  });

  it("does not read local config when required AI values are provided without lang", async () => {
    const directory = path.join(tmpdir(), `marksweep-skip-local-lang-${Date.now()}`);
    await mkdir(directory);
    const configPath = path.join(directory, "config.json");
    await writeFile(configPath, "{not-json", "utf8");

    await expect(
      resolveAiConfig(
        {
          baseUrl: "https://cli.example.com/v1",
          model: "cli-model",
          apiKey: "cli-key",
        },
        {
          interactive: false,
          env: {},
          configPath,
        },
      ),
    ).resolves.toEqual({
      baseUrl: "https://cli.example.com/v1",
      model: "cli-model",
      apiKey: "cli-key",
      lang: "zh",
    });
  });

  it("resolves AI config from environment variables", async () => {
    const config = await resolveAiConfig(
      {},
      {
        userConfig: { version: 1 },
        interactive: false,
        env: {
          OPENAI_BASE_URL: "https://openai.example.com/v1",
          OPENAI_MODEL: "env-model",
          OPENAI_API_KEY: "env-key",
        },
      },
    );

    expect(config).toEqual({
      baseUrl: "https://openai.example.com/v1",
      model: "env-model",
      apiKey: "env-key",
      lang: "zh",
    });
  });

  it("fails AI config resolution in non-interactive mode when required values are missing", async () => {
    await expect(resolveAiConfig({}, { interactive: false, env: {}, userConfig: { version: 1 } })).rejects.toThrow(
      "缺少 AI 参数：base-url, model, api-key",
    );
  });

  it("resolves AI config from local user config after CLI and environment variables", async () => {
    const config = await resolveAiConfig(
      {},
      {
        interactive: false,
        env: {},
        userConfig: {
          version: 1,
          ai: {
            baseUrl: "https://local.example.com/v1",
            model: "local-model",
            apiKey: "local-key",
            lang: "ja",
          },
        },
      },
    );

    expect(config).toEqual({
      baseUrl: "https://local.example.com/v1",
      model: "local-model",
      apiKey: "local-key",
      lang: "ja",
    });
  });

  it("prompts to save interactive AI config including API key", async () => {
    const directory = path.join(tmpdir(), `marksweep-save-config-${Date.now()}`);
    await mkdir(directory);
    const configPath = path.join(directory, "config.json");
    const prompts = {
      input: vi.fn(async ({ message }: { message: string }) =>
        message === "AI Base URL" ? "https://prompt.example.com/v1" : "prompt-model",
      ),
      password: vi.fn(async () => "prompt-key"),
      confirm: vi.fn(async () => true),
    } as unknown as AiConfigPrompts;

    const config = await resolveAiConfig(
      {},
      {
        interactive: true,
        env: {},
        configPath,
        userConfig: { version: 1 },
        prompts,
      },
    );
    const savedConfig = JSON.parse(await readFile(configPath, "utf8")) as unknown;

    expect(config).toEqual({
      baseUrl: "https://prompt.example.com/v1",
      model: "prompt-model",
      apiKey: "prompt-key",
      lang: "zh",
    });
    expect(prompts.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("API Key 将明文保存"),
        default: true,
      }),
    );
    expect(savedConfig).toMatchObject({
      version: 1,
      ai: {
        baseUrl: "https://prompt.example.com/v1",
        model: "prompt-model",
        apiKey: "prompt-key",
        lang: "zh",
      },
    });
  });

  it("masks secrets for display", () => {
    expect(maskSecret("short")).toBe("*****");
    expect(maskSecret("sk-1234567890abcdef")).toBe("sk-1***********cdef");
  });

  it("reads only html bookmark files", async () => {
    const directory = path.join(tmpdir(), `marksweep-config-${Date.now()}`);
    await mkdir(directory);
    const htmlPath = path.join(directory, "bookmarks.html");
    const txtPath = path.join(directory, "bookmarks.txt");
    await writeFile(htmlPath, "<DL><p></DL><p>", "utf8");
    await writeFile(txtPath, "<DL><p></DL><p>", "utf8");

    await expect(readBookmarkHtmlFile(htmlPath)).resolves.toMatchObject({
      absolutePath: htmlPath,
      html: "<DL><p></DL><p>",
    });
    await expect(readBookmarkHtmlFile(txtPath)).rejects.toThrow("仅支持浏览器导出的 .html 或 .htm 书签文件");
  });

  it("rejects output paths that overwrite the input or target missing directories", async () => {
    const directory = path.join(tmpdir(), `marksweep-output-${Date.now()}`);
    await mkdir(directory);
    const inputPath = path.join(directory, "bookmarks.html");
    const outputPath = path.join(directory, "bookmarks.cleaned.html");
    await writeFile(inputPath, "<DL><p></DL><p>", "utf8");

    await expect(assertWritableOutputPath(inputPath, inputPath)).rejects.toThrow("输出文件不能覆盖原始书签文件");
    await expect(assertWritableOutputPath(inputPath, path.join(directory, "missing", "out.html"))).rejects.toThrow(
      "输出目录不存在",
    );
    if (process.platform === "win32") {
      await expect(assertWritableOutputPath(inputPath, inputPath.toUpperCase())).rejects.toThrow(
        "输出文件不能覆盖原始书签文件",
      );
    }
    await expect(assertWritableOutputPath(inputPath, outputPath)).resolves.toBeUndefined();
  });

  it("resolves webpage fetcher provider config from environment variables", () => {
    expect(
      resolveWebPageFetcherConfig({
        FIRECRAWL_API_KEY: "fc-env",
        FIRECRAWL_BASE_URL: "https://firecrawl.example.com/v2",
        JINA_API_KEY: "jina-env",
      }),
    ).toEqual({
      firecrawlApiKey: "fc-env",
      firecrawlBaseUrl: "https://firecrawl.example.com/v2",
      jinaApiKey: "jina-env",
    });
  });
});

describe("CLI user config file", () => {
  it("builds a platform-aware local config path and supports explicit override", () => {
    expect(
      getDefaultUserConfigPath(
        {
          MARKSWEEP_CONFIG_PATH: "custom/marksweep.json",
        },
        "linux",
      ),
    ).toBe(path.resolve("custom/marksweep.json"));

    expect(
      getDefaultUserConfigPath(
        {
          APPDATA: "C:\\Users\\demo\\AppData\\Roaming",
        },
        "win32",
      ),
    ).toBe(path.join("C:\\Users\\demo\\AppData\\Roaming", "marksweep", "config.json"));
  });

  it("loads an empty config when the file does not exist", async () => {
    const configPath = path.join(tmpdir(), `marksweep-missing-${Date.now()}`, "config.json");

    await expect(loadUserConfig(configPath)).resolves.toEqual({ version: 1 });
  });

  it("saves and loads local config", async () => {
    const directory = path.join(tmpdir(), `marksweep-user-config-${Date.now()}`);
    const configPath = path.join(directory, "config.json");

    await saveUserConfig(
      {
        version: 1,
        ai: {
          baseUrl: "https://saved.example.com/v1",
          model: "saved-model",
          apiKey: "saved-key",
          lang: "en",
        },
      },
      configPath,
    );

    await expect(loadUserConfig(configPath)).resolves.toEqual({
      version: 1,
      ai: {
        baseUrl: "https://saved.example.com/v1",
        model: "saved-model",
        apiKey: "saved-key",
        lang: "en",
      },
    });
  });
});
