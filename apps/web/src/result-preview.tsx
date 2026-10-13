import { useMemo, useState } from "react";
import { Button, Input, Modal, Space, Table, Tabs, Tree, Typography } from "antd";
import type { DataNode } from "antd/es/tree";
import type { ExtractedBookmark } from "@marksweep/core/parser/bookmark-html";
import { bookmarkChanges, type ConversationTurn } from "./conversation-state";

function readableTree(bookmarks: ExtractedBookmark[]): DataNode[] {
  const roots: DataNode[] = [];
  const index = new Map<string, DataNode>();
  for (const bookmark of bookmarks) {
    let children = roots;
    bookmark.folderPath.forEach((title, depth) => {
      const key = JSON.stringify(bookmark.folderPath.slice(0, depth + 1));
      let folder = index.get(key);
      if (!folder) {
        folder = { key, title, children: [] };
        children.push(folder);
        index.set(key, folder);
      }
      children = folder.children!;
    });
    children.push({
      key: `bookmark:${bookmark.id}`,
      isLeaf: true,
      title: /^https?:\/\//i.test(bookmark.url) ? (
        <a href={bookmark.url} target="_blank" rel="noreferrer" title={bookmark.url}>
          {bookmark.title || bookmark.url}
        </a>
      ) : (
        <span title={bookmark.url}>{bookmark.title || bookmark.url}</span>
      ),
    });
  }
  return roots;
}

export function ResultPreview({
  turn,
  number,
  tab,
  onClose,
  onUse,
  disabled,
}: {
  turn: ConversationTurn;
  number: number;
  tab: "tree" | "changes";
  onClose: () => void;
  onUse: (bookmarks: ExtractedBookmark[]) => void;
  disabled: boolean;
}) {
  const [query, setQuery] = useState("");
  const bookmarks = turn.result?.bookmarks ?? [];
  const tree = useMemo(
    () =>
      readableTree(
        bookmarks.filter((bookmark) =>
          `${bookmark.title} ${bookmark.url} ${bookmark.folderPath.join("/")}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        ),
      ),
    [bookmarks, query],
  );
  const changes = bookmarkChanges(turn);
  return (
    <Modal
      open
      title={`第 ${number} 轮整理结果 · ${bookmarks.length} 个书签`}
      width={980}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>关闭</Button>
          <Button
            type="primary"
            disabled={disabled}
            onClick={() => {
              onUse(bookmarks);
              onClose();
            }}
          >
            使用此版本继续整理
          </Button>
        </Space>
      }
    >
      <Typography.Paragraph className="conversation-text">{turn.result?.organization.summary}</Typography.Paragraph>
      <Tabs
        defaultActiveKey={tab}
        items={[
          {
            key: "tree",
            label: "目录与书签",
            children: (
              <>
                <Input.Search
                  aria-label="搜索本轮整理结果"
                  placeholder="搜索书签或目录"
                  allowClear
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                {tree.length ? (
                  <Tree
                    key={query}
                    treeData={tree}
                    defaultExpandedKeys={tree.map((node) => node.key)}
                    height={420}
                    selectable={false}
                    showLine
                  />
                ) : (
                  <p>没有匹配的书签。</p>
                )}
              </>
            ),
          },
          {
            key: "changes",
            label: `本轮变更 (${changes.length})`,
            children: (
              <Table
                rowKey="id"
                dataSource={changes}
                size="small"
                scroll={{ x: 600 }}
                pagination={{ pageSize: 10 }}
                locale={{ emptyText: "本轮没有修改标题或目录。" }}
                columns={[
                  {
                    title: "书签",
                    key: "title",
                    render: (_, item) => (
                      <div>
                        {item.after.title}
                        {item.before.title !== item.after.title && (
                          <div className="muted">原标题：{item.before.title}</div>
                        )}
                      </div>
                    ),
                  },
                  {
                    title: "原目录",
                    key: "before",
                    render: (_, item) => item.before.folderPath.join(" / ") || "根目录",
                  },
                  { title: "新目录", key: "after", render: (_, item) => item.after.folderPath.join(" / ") || "根目录" },
                  { title: "理由", dataIndex: "reason" },
                ]}
              />
            ),
          },
        ]}
      />
    </Modal>
  );
}
