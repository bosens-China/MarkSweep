import { Button, Card, Upload } from "antd";
import { InboxOutlined } from "@ant-design/icons";

export function ImportPanel({ busy, onImport }: { busy: boolean; onImport: (file: File) => false }) {
  return (
    <Card className="import-card">
      <Upload.Dragger accept=".html,.htm" showUploadList={false} beforeUpload={onImport} disabled={busy}>
        <div className="import-icon">
          <InboxOutlined />
        </div>
        <h2>把你的书签带进来</h2>
        <p>拖入浏览器导出的 HTML 文件，或点击选择文件</p>
        <Button type="primary" loading={busy}>
          选择书签文件
        </Button>
        <p className="import-hint">支持 Chrome、Edge、Firefox 等浏览器的书签导出文件 · 最大 10 MB</p>
      </Upload.Dragger>
      <div className="getting-started">
        <span>01 导入书签</span>
        <span>02 检测与整理</span>
        <span>03 预览并导出</span>
      </div>
    </Card>
  );
}
