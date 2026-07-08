import { describe, expect, it } from "vitest";
import { createProgram } from "../../src/cli";

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
  });
});
