import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Empty, Input, Space, Tag, Typography } from "antd";
import type { ExtractedBookmark } from "@marksweep/core/parser/bookmark-html";
import type { AgentActivity } from "@marksweep/core/conversation/schema";
import { bookmarkChanges, type ConversationState, type ConversationTurn } from "./conversation-state";
import { ResultPreview } from "./result-preview";
import { ExecutionMetrics, duration } from "./execution-metrics";

const toolNames: Record<string, string> = {
  inspect_bookmarks: "批量核实书签",
  read_pages: "查阅补充资料",
  find_bookmarks: "查找相关书签",
  read_cached_page: "继续阅读正文",
  report_progress: "更新处理说明",
  submit_organization: "校验整理结果",
  write_todos: "更新计划",
  ls: "查看临时资料",
  read_file: "阅读临时资料",
  write_file: "保存临时资料",
  edit_file: "更新临时资料",
  grep: "检索临时资料",
  glob: "查找临时资料",
};
function Activity({ value }: { value: AgentActivity }) {
  if (value.kind === "timing") return null;
  if (value.kind === "tool")
    return (
      <details className="tool-card">
        <summary>
          <Badge status={value.status === "running" ? "processing" : value.status === "error" ? "error" : "success"} />{" "}
          {toolNames[value.name] ?? value.name}
          <span className="muted">
            {" "}
            · {value.status === "running" ? "进行中" : value.status === "error" ? "未完成" : "完成"}
          </span>
        </summary>
        <div className="conversation-text muted">{value.text}</div>
        {value.elapsedMs !== undefined && <p className="muted">耗时 {duration(value.elapsedMs)}（含排队）</p>}
        {value.url && /^https?:\/\//i.test(value.url) && (
          <p>
            <a href={value.url} target="_blank" rel="noreferrer">
              查看资料来源
            </a>
          </p>
        )}
        {value.sourceUrl && /^https?:\/\//i.test(value.sourceUrl) && (
          <p>
            <a href={value.sourceUrl} target="_blank" rel="noreferrer">
              由此页面继续查阅
            </a>
          </p>
        )}
      </details>
    );
  if (value.kind === "message" && value.channel === "reasoning")
    return (
      <details>
        <summary>模型提供的推理内容</summary>
        <div className="conversation-text muted">{value.text}</div>
      </details>
    );
  return <div className={`conversation-text ${value.kind === "status" ? "agent-status" : ""}`}>{value.text}</div>;
}

export function ConversationPanel({
  state,
  busy,
  running,
  connected,
  onSend,
  onCancel,
  onUse,
}: {
  state: ConversationState;
  busy: boolean;
  running: boolean;
  connected: boolean;
  onSend: (instruction: string) => boolean;
  onCancel: () => void;
  onUse: (bookmarks: ExtractedBookmark[]) => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [preview, setPreview] = useState<{ turn: ConversationTurn; number: number; tab: "tree" | "changes" }>();
  const bottom = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  useEffect(() => {
    if (follow) bottom.current?.scrollIntoView({ block: "nearest" });
  }, [state, follow]);
  const submit = () => {
    if (onSend(instruction.trim())) {
      setInstruction("");
      setFollow(true);
    }
  };
  return (
    <Card
      className="conversation-panel"
      title={
        <Space>
          AI 整理对话<Tag>可持续调整</Tag>
        </Space>
      }
    >
      <div
        className="conversation-feed"
        role="log"
        aria-label="整理对话与执行过程"
        onScroll={(event) => {
          const node = event.currentTarget;
          setFollow(node.scrollHeight - node.scrollTop - node.clientHeight < 80);
        }}
      >
        {!state.turns.length && (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <>
                <p>描述你希望怎样整理，也可以直接开始。</p>
                <p className="muted">例如：按用途分类，目录最多两级，保留原始标题。</p>
              </>
            }
          />
        )}
        {state.turns.map((turn, index) => (
          <section className="conversation-turn" key={turn.requestId}>
            <div className="user-message">
              <strong>你 · 第 {index + 1} 轮</strong>
              <div className="conversation-text">{turn.instruction || "按用途整理，目录最多两级，保留原始标题。"}</div>
            </div>
            <div className="agent-message">
              <ExecutionMetrics activities={turn.activities} />
              {turn.activities.map((activity) => (
                <Activity key={activity.id} value={activity} />
              ))}
              {turn.status === "running" && <Badge status="processing" text="正在处理，可随时停止" />}
              {turn.error && <Typography.Text type="danger">{turn.error}</Typography.Text>}
              {turn.result && (
                <div className="result-card">
                  <strong>第 {index + 1} 轮整理完成</strong>
                  <div className="conversation-text">{turn.result.organization.summary}</div>
                  <p className="muted">
                    {turn.result.bookmarks.length} 个书签 · {bookmarkChanges(turn).length} 项变更
                  </p>
                  <Space wrap>
                    <Button size="small" onClick={() => setPreview({ turn, number: index + 1, tab: "tree" })}>
                      查看整理结果
                    </Button>
                    <Button size="small" onClick={() => setPreview({ turn, number: index + 1, tab: "changes" })}>
                      查看变更
                    </Button>
                    <Button size="small" disabled={busy} onClick={() => onUse(turn.before)}>
                      恢复到本轮之前
                    </Button>
                  </Space>
                </div>
              )}
            </div>
          </section>
        ))}
        <div ref={bottom} />
      </div>
      <div className="conversation-composer">
        <Input.TextArea
          id="organize-instruction"
          aria-label="整理要求"
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          maxLength={6000}
          autoSize={{ minRows: 3, maxRows: 7 }}
          disabled={busy}
          placeholder={
            state.turns.length ? "继续调整，例如：合并过细的目录，React 和 Vue 分开放。" : "可选：告诉 AI 你的整理偏好…"
          }
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !busy && connected) submit();
          }}
        />
        <div className="composer-actions">
          <span className="muted">修改工作副本 · 原始文件保留</span>
          {running ? (
            <Button danger onClick={onCancel}>
              停止
            </Button>
          ) : (
            <Button type="primary" disabled={busy || !connected} onClick={submit}>
              {state.turns.length ? "继续整理" : "开始整理"}
            </Button>
          )}
        </div>
      </div>
      {preview && (
        <ResultPreview
          key={`${preview.turn.requestId}:${preview.tab}`}
          {...preview}
          disabled={busy}
          onUse={onUse}
          onClose={() => setPreview(undefined)}
        />
      )}
    </Card>
  );
}
