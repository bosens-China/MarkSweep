import { useEffect, useRef, useState } from "react";
import type { AgentActivity } from "@marksweep/core/conversation/schema";

export function duration(ms: number) {
  if (ms < 1000) return `${Math.round(ms)} 毫秒`;
  const seconds = Math.floor(ms / 1000);
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

export function ExecutionMetrics({ activities }: { activities: AgentActivity[] }) {
  const [, tick] = useState(0);
  const clocks = useRef(new Map<string, { received: number; elapsed: number }>());
  const running = activities.some((value) => value.kind === "timing" && value.status === "running");
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const timings = activities.filter((value) => value.kind === "timing");
  if (!timings.length) return null;
  const elapsed = (value: (typeof timings)[number]) => {
    if (value.status !== "running") return value.elapsedMs;
    const previous = clocks.current.get(value.id);
    if (!previous || previous.elapsed !== value.elapsedMs)
      clocks.current.set(value.id, { received: Date.now(), elapsed: value.elapsedMs });
    const clock = clocks.current.get(value.id)!;
    return clock.elapsed + Date.now() - clock.received;
  };
  const total = timings.find((value) => value.phase === "total");
  const models = timings.filter((value) => value.phase === "model");
  const tools = activities.flatMap((value) =>
    value.kind === "tool" && value.elapsedMs !== undefined && value.name !== "读取网页" ? [value] : [],
  );
  return (
    <details className="tool-card">
      <summary>
        本轮耗时 {duration(total ? elapsed(total) : 0)} · 模型累计{" "}
        {duration(models.reduce((sum, value) => sum + elapsed(value), 0))}
      </summary>
      <p className="muted">模型时间包含响应等待与生成。首次响应属于该请求；工具可能并行，以下耗时不直接相加。</p>
      {models.map((value) => (
        <p key={value.id}>
          {value.name}：{duration(elapsed(value))} ·{" "}
          {value.status === "running" ? "等待或生成中" : value.status === "error" ? "已中断" : "完成"}
          {value.firstTokenMs !== undefined && ` · 首次流式响应 ${duration(value.firstTokenMs)}`}
          {value.inputTokens !== undefined && ` · 输入 ${value.inputTokens} token`}
          {value.outputTokens !== undefined && ` · 输出 ${value.outputTokens} token`}
        </p>
      ))}
      <p className="muted">
        工具累计执行：{duration(tools.reduce((sum, value) => sum + (value.elapsedMs ?? 0), 0))}；逐页请求与 Markdown
        转换时间见网页卡片。
      </p>
    </details>
  );
}
