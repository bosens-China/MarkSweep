import { useMemo, useState } from "react";
import {
  App,
  Badge,
  Button,
  Card,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Statistic,
  Tag,
  Tree,
  Typography,
} from "antd";
import { DeleteOutlined, FolderOutlined, LinkOutlined, SettingOutlined } from "@ant-design/icons";
import type { ExtractedBookmark } from "@marksweep/core/parser/bookmark-html";
import { BookmarkTable, statusLabels } from "./bookmark-table";
import { buildFolderTree, inFolder } from "./bookmark-view";
import { SettingsDrawer } from "./settings";
import { useWorkspace } from "./use-workspace";
import { AuditReport } from "./audit-report";
import { ImportPanel } from "./import-panel";
import { WorkspaceToolbar } from "./workspace-toolbar";
import { ConversationPanel } from "./conversation-panel";

export function Workspace() {
  const w = useWorkspace();
  const { message } = App.useApp();
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [folder, setFolder] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [moveOpen, setMoveOpen] = useState(false);
  const [destination, setDestination] = useState("");
  const [editing, setEditing] = useState<ExtractedBookmark | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const bookmarkIds = useMemo(() => new Set(w.bookmarks.map((bookmark) => bookmark.id)), [w.bookmarks]);
  const selectedIds = selected.filter((id) => bookmarkIds.has(id));
  const selectedSet = new Set(selectedIds);
  const tree = useMemo(() => buildFolderTree(w.bookmarks), [w.bookmarks]);
  const visible = useMemo(
    () =>
      w.bookmarks.filter(
        (bookmark) =>
          inFolder(bookmark, folder) &&
          (statusFilter === "all" || (w.results[bookmark.id]?.status ?? "unchecked") === statusFilter) &&
          `${bookmark.title} ${bookmark.url} ${bookmark.folderPath.join("/")}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [w.bookmarks, w.results, folder, statusFilter, query],
  );
  const broken = w.bookmarks.filter((bookmark) => w.results[bookmark.id]?.status === "broken").length;
  const suspicious = w.bookmarks.filter((bookmark) => w.results[bookmark.id]?.status === "suspicious").length;
  const canAct = w.bookmarks.length > 0 && !w.busy;

  function changeBookmarks(bookmarks: ExtractedBookmark[]) {
    w.setBookmarks(bookmarks);
    setSelected([]);
    setFolder("all");
  }
  function importFile(file: File) {
    setSelected([]);
    setFolder("all");
    setQuery("");
    setStatusFilter("all");
    w.importFile(file);
    return false as const;
  }
  function startAudit() {
    w.run("audit");
    setReportOpen(true);
  }
  function editBookmark() {
    if (!editing) return;
    if (!editing.title.trim() || !editing.url.trim()) {
      void message.warning("标题和链接不能为空。");
      return;
    }
    let isWebUrl = false;
    try {
      isWebUrl = ["http:", "https:"].includes(new URL(editing.url).protocol);
    } catch {
      /* 非网页书签仍可保留。 */
    }
    changeBookmarks(w.bookmarks.map((bookmark) => (bookmark.id === editing.id ? { ...editing, isWebUrl } : bookmark)));
    w.setResults((previous) => Object.fromEntries(Object.entries(previous).filter(([id]) => id !== editing.id)));
    setEditing(null);
  }

  return (
    <div className="workspace-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <LinkOutlined />
          </div>
          <div>
            <strong>MarkSweep</strong>
            <span>本地书签工作台</span>
          </div>
        </div>
        <Space size="middle">
          <Badge
            status={w.socket.connected ? "success" : "error"}
            text={w.socket.connected ? "本地服务已连接" : "连接已断开"}
          />
          {!w.socket.connected && (
            <Button size="small" onClick={w.socket.reconnect}>
              重新连接
            </Button>
          )}
          {(w.filename || w.persistence.error) && (
            <Popconfirm
              title="清空工作台和恢复缓存？"
              description="仅移除当前标签页的工作副本，原始文件不会修改。"
              onConfirm={w.clear}
              disabled={w.busy}
            >
              <Button disabled={w.busy}>清空工作台</Button>
            </Popconfirm>
          )}
          <Button icon={<SettingOutlined />} onClick={() => w.setSettingsOpen(true)}>
            设置
          </Button>
        </Space>
      </header>

      <main>
        <section className="page-intro">
          <div>
            <div className="eyebrow">A LITTLE LESS CLUTTER</div>
            <h1>给书签，留一点呼吸的空间。</h1>
            <p>检查失效链接，整理重复收藏，让 AI 帮你找到更清晰的目录。</p>
          </div>
          <Tag className="local-tag">文件在本机处理 · 原始文件保留</Tag>
        </section>

        {!w.filename ? (
          <ImportPanel busy={w.busy} onImport={importFile} />
        ) : (
          <>
            <div className="stats-row">
              <Card>
                <Statistic
                  title="当前书签"
                  value={w.bookmarks.length}
                  suffix={<span className="stat-suffix">/ 导入 {w.original.length}</span>}
                />
              </Card>
              <Card>
                <Statistic title="疑似失效" value={broken} styles={{ content: { color: "#b54740" } }} />
              </Card>
              <Card>
                <Statistic title="需要复核" value={suspicious} styles={{ content: { color: "#a57528" } }} />
              </Card>
              <Card>
                <Statistic title="顶层目录" value={tree.length} />
              </Card>
            </div>

            <WorkspaceToolbar
              workspace={w}
              onImport={importFile}
              onAudit={startAudit}
              onClassify={() => {
                document.getElementById("organize-instruction")?.focus();
              }}
              onDedupe={() => {
                w.dedupe();
                setSelected([]);
                setFolder("all");
              }}
            />

            <div className="workbench-columns">
              <section className="bookmark-workspace">
                <Card
                  className="folder-panel"
                  title={
                    <Space>
                      <FolderOutlined />
                      目录
                    </Space>
                  }
                >
                  <Tree
                    blockNode
                    showLine
                    selectedKeys={[folder]}
                    onSelect={(keys) => setFolder(String(keys[0] ?? "all"))}
                    treeData={[
                      { key: "all", title: `全部书签 (${w.bookmarks.length})` },
                      { key: "root", title: "根目录" },
                      ...tree,
                    ]}
                  />
                  <div className="source-file">
                    <Typography.Text type="secondary">当前文件</Typography.Text>
                    <Typography.Paragraph ellipsis={{ rows: 2, tooltip: w.filename }}>
                      {w.filename}
                    </Typography.Paragraph>
                    <Popconfirm
                      title="恢复原始导入？"
                      description="当前的编辑、分类和检测结果将被重置。"
                      onConfirm={() => {
                        w.restore();
                        setSelected([]);
                        setFolder("all");
                      }}
                    >
                      <Button size="small" disabled={w.busy}>
                        恢复原始
                      </Button>
                    </Popconfirm>
                  </div>
                </Card>
                <Card className="bookmarks-panel">
                  <div className="table-toolbar">
                    <Input.Search
                      aria-label="搜索书签"
                      placeholder="搜索标题、链接或目录"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      allowClear
                      style={{ maxWidth: 350 }}
                    />
                    <Select
                      aria-label="检测状态"
                      value={statusFilter}
                      onChange={setStatusFilter}
                      style={{ width: 140 }}
                      options={[
                        { value: "all", label: "全部状态" },
                        ...Object.entries(statusLabels).map(([value, label]) => ({ value, label })),
                      ]}
                    />
                  </div>
                  <div className="selection-bar">
                    <Typography.Text type="secondary">已选 {selectedIds.length} 项</Typography.Text>
                    <Space wrap>
                      <Button
                        size="small"
                        disabled={!canAct || !broken}
                        onClick={() =>
                          setSelected(w.bookmarks.filter((b) => w.results[b.id]?.status === "broken").map((b) => b.id))
                        }
                      >
                        选中失效项
                      </Button>
                      <Button
                        size="small"
                        disabled={!selectedIds.length || w.busy}
                        onClick={() => {
                          setDestination("");
                          setMoveOpen(true);
                        }}
                      >
                        移动目录
                      </Button>
                      <Popconfirm
                        title={`从工作副本移除 ${selectedIds.length} 个书签？`}
                        description="原始导入文件不受影响。"
                        onConfirm={() => changeBookmarks(w.bookmarks.filter((b) => !selectedSet.has(b.id)))}
                      >
                        <Button size="small" danger icon={<DeleteOutlined />} disabled={!selectedIds.length || w.busy}>
                          删除选中
                        </Button>
                      </Popconfirm>
                    </Space>
                  </div>
                  <BookmarkTable
                    bookmarks={visible}
                    results={w.results}
                    selected={selectedIds}
                    onSelect={setSelected}
                    disabled={w.busy}
                    onEdit={setEditing}
                  />
                </Card>
              </section>
              <ConversationPanel
                state={w.conversation.state}
                busy={w.busy}
                running={w.running === "organize"}
                connected={w.socket.connected}
                onSend={(instruction) => {
                  const started = w.run("organize", instruction);
                  if (started) {
                    setFolder("all");
                    setStatusFilter("all");
                    setSelected([]);
                  }
                  return started;
                }}
                onCancel={w.cancel}
                onUse={(bookmarks) => {
                  changeBookmarks(bookmarks);
                  w.setResults({});
                  setStatusFilter("all");
                }}
              />
            </div>
            {w.report && (
              <Card className="audit-summary" title="过时内容审计">
                <Space wrap>
                  <Typography.Text>已生成审计报告。报告仅提供建议，不会自动删除书签。</Typography.Text>
                  <Button onClick={() => setReportOpen(true)}>查看报告</Button>
                </Space>
              </Card>
            )}
          </>
        )}
        <footer>
          <div>本地整理，按需连接 AI。仅在检测、分类或审计时发送相关请求。关闭终端会停止服务。</div>
          <div role="status">
            {w.persistence.error ||
              {
                loading: "正在读取恢复缓存…",
                saving: "正在保存工作副本…",
                saved: "工作副本已保存，可在当前地址刷新恢复。",
                error: "自动恢复不可用，请及时导出。",
              }[w.persistence.state]}
          </div>
        </footer>
      </main>

      <SettingsDrawer
        open={w.settingsOpen}
        onClose={() => w.setSettingsOpen(false)}
        value={w.settings}
        onChange={w.setSettings}
        hasApiKey={w.hasApiKey}
        disabled={w.busy}
        onSave={w.saveAiConfig}
        configPath={w.configPath}
      />
      <Modal
        title="移动到目录"
        open={moveOpen}
        onCancel={() => setMoveOpen(false)}
        onOk={() => {
          const folderPath = destination
            .split("/")
            .map((part) => part.trim())
            .filter(Boolean);
          changeBookmarks(w.bookmarks.map((b) => (selectedSet.has(b.id) ? { ...b, folderPath } : b)));
          setMoveOpen(false);
        }}
      >
        <p>使用 / 分隔多级目录，留空表示根目录。</p>
        <Input
          aria-label="目标目录"
          placeholder="例如：技术 / 前端"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
        />
      </Modal>
      <Modal title="编辑书签" open={Boolean(editing)} onCancel={() => setEditing(null)} onOk={editBookmark}>
        <Space orientation="vertical" style={{ width: "100%" }}>
          <label>
            标题
            <Input value={editing?.title} onChange={(e) => setEditing((b) => b && { ...b, title: e.target.value })} />
          </label>
          <label>
            链接
            <Input value={editing?.url} onChange={(e) => setEditing((b) => b && { ...b, url: e.target.value })} />
          </label>
        </Space>
      </Modal>
      <AuditReport
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        report={w.report}
        running={w.running === "audit"}
      />
    </div>
  );
}
