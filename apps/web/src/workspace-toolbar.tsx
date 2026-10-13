import { Badge, Button, Card, Popconfirm, Progress, Space, Upload } from "antd";
import {
  ArrowDownOutlined,
  AuditOutlined,
  CheckCircleOutlined,
  ThunderboltOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import type { useWorkspace } from "./use-workspace";

export function WorkspaceToolbar({
  workspace: w,
  onImport,
  onClassify,
  onAudit,
  onDedupe,
}: {
  workspace: ReturnType<typeof useWorkspace>;
  onImport: (file: File) => false;
  onClassify: () => void;
  onAudit: () => void;
  onDedupe: () => void;
}) {
  const canAct = w.bookmarks.length > 0 && !w.busy;
  return (
    <Card className="toolbar-card">
      <div className="toolbar">
        <Space wrap>
          <Button
            type="primary"
            icon={<CheckCircleOutlined />}
            disabled={!canAct || !w.socket.connected}
            onClick={() => w.run("check")}
          >
            检测链接
          </Button>
          <Button icon={<ThunderboltOutlined />} disabled={!canAct || !w.socket.connected} onClick={onClassify}>
            AI 整理对话
          </Button>
          <Button icon={<AuditOutlined />} disabled={!canAct || !w.socket.connected} onClick={onAudit}>
            过时审计
          </Button>
          <Popconfirm
            title="移除重复书签？"
            description="将按 URL 去重，保留信息更完整的书签。"
            onConfirm={onDedupe}
            disabled={!canAct}
          >
            <Button disabled={!canAct}>URL 去重</Button>
          </Popconfirm>
        </Space>
        <Space wrap>
          <Upload accept=".html,.htm" showUploadList={false} beforeUpload={onImport} disabled={w.busy}>
            <Button icon={<UploadOutlined />} disabled={w.busy}>
              重新导入
            </Button>
          </Upload>
          <Button icon={<ArrowDownOutlined />} disabled={w.busy} onClick={w.save}>
            导出 HTML
          </Button>
        </Space>
      </div>
      <div className="report-tools">
        <Space wrap>
          <Upload
            accept=".json"
            showUploadList={false}
            beforeUpload={(file) => {
              w.importReport(file);
              return false;
            }}
            disabled={!canAct}
          >
            <Button size="small" disabled={!canAct}>
              导入检测报告
            </Button>
          </Upload>
          <Button size="small" disabled={w.busy || !w.currentResults.length} onClick={w.exportReport}>
            导出检测报告{w.currentResults.length ? ` (${w.currentResults.length} 项)` : ""}
          </Button>
          {w.traceUrl && (
            <Button size="small" type="link" href={w.traceUrl} target="_blank" rel="noreferrer">
              查看 LangSmith 追踪
            </Button>
          )}
        </Space>
      </div>
      <div className="task-status">
        <span>
          <Badge status={w.running ? "processing" : "default"} />
          {w.status}
        </span>
        {w.running && (
          <Button size="small" danger onClick={w.cancel}>
            取消任务
          </Button>
        )}
      </div>
      {w.running && (
        <Progress percent={w.percent ?? 0} showInfo={w.percent !== undefined} status="active" size="small" />
      )}
    </Card>
  );
}
