import { Alert, Button, Empty, Modal } from "antd";
import { download } from "./api";

export function AuditReport({
  open,
  onClose,
  report,
  running,
}: {
  open: boolean;
  onClose: () => void;
  report: string;
  running: boolean;
}) {
  return (
    <Modal
      title="过时内容审计"
      open={open}
      onCancel={onClose}
      width={850}
      footer={
        <Button
          disabled={!report}
          onClick={() => download(new Blob([report], { type: "text/markdown;charset=utf-8" }), "outdated-bookmarks.md")}
        >
          下载 Markdown
        </Button>
      }
    >
      <Alert
        type="info"
        showIcon
        title="AI 建议需要人工复核"
        description="报告基于书签元数据和必要页面内容，不能保证已核验最新版本或维护状态。"
      />
      {report ? (
        <pre className="audit-report">{report}</pre>
      ) : running ? (
        <p>正在筛选并读取必要页面，报告会逐步显示⋯⋯</p>
      ) : (
        <Empty description="还没有审计报告，请先启动过时审计。" />
      )}
    </Modal>
  );
}
