import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createProgram, isDirectRun } from "../../src/cli";

describe("createProgram", () => {
  it("registers the public CLI commands", () => {
    const program = createProgram();

    expect(program.commands.map((command) => command.name())).toEqual(["check", "clean", "classify"]);
  });

  it("includes command descriptions in help output", () => {
    const program = createProgram();
    const help = program.helpInformation();
    const classifyHelp = program.commands.find((command) => command.name() === "classify")?.helpInformation() ?? "";

    expect(help).toContain("检查书签有效性");
    expect(help).toContain("检测书签并输出新的清理后 HTML 文件");
    expect(help).toContain("调用 AI 智能分类书签");
    expect(classifyHelp).toContain("--langsmith");
    expect(program.commands.find((command) => command.name() === "check")?.helpInformation()).toContain("--json");
    expect(program.commands.find((command) => command.name() === "clean")?.helpInformation()).toContain(
      "--check-report",
    );
    expect(classifyHelp).not.toContain("--check-report");
    expect(classifyHelp).not.toContain("--concurrency");
    expect(classifyHelp).not.toContain("--langsmith-api-key");
  });

  it("recognizes an npm-style symlinked bin entry", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "marksweep-bin-"));
    const target = path.join(directory, "cli.js");
    const entry = path.join(directory, "marksweep");
    writeFileSync(target, "", "utf8");
    symlinkSync(target, entry);

    expect(isDirectRun(target, entry)).toBe(true);
  });
});
