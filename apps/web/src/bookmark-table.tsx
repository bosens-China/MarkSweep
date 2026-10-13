import { Button, Space, Table, Tag, Tooltip, Typography } from "antd";
import type { ExtractedBookmark } from "@marksweep/core/parser/bookmark-html";
import type { BookmarkCheckResult, BookmarkCheckReason } from "@marksweep/core/checker/types";

export const statusLabels = {
  valid: "有效",
  broken: "失效",
  suspicious: "待复核",
  skipped: "已跳过",
  unchecked: "未检测",
};
const statusColors = { valid: "green", broken: "red", suspicious: "orange", skipped: "default", unchecked: "default" };
const reasonLabels: Record<BookmarkCheckReason, string> = {
  ok: "访问正常",
  redirect: "已重定向",
  not_found: "页面不存在",
  gone: "页面已移除",
  dns_not_found: "域名无法解析",
  connection_refused: "连接被拒绝",
  empty_response: "响应为空",
  timeout: "请求超时",
  auth_required: "需要登录",
  forbidden: "访问受限",
  rate_limited: "请求过于频繁",
  ssl_error: "证书异常",
  server_error: "服务端异常",
  http_error: "HTTP 请求异常",
  network_error: "网络异常",
  non_web_url: "非网页链接",
  https_upgrade: "HTTPS 地址可用",
  protocol_error: "协议异常",
};

export function BookmarkTable({
  bookmarks,
  results,
  selected,
  onSelect,
  disabled,
  onEdit,
}: {
  bookmarks: ExtractedBookmark[];
  results: Record<string, BookmarkCheckResult>;
  selected: string[];
  onSelect: (keys: string[]) => void;
  disabled: boolean;
  onEdit: (bookmark: ExtractedBookmark) => void;
}) {
  return (
    <Table<ExtractedBookmark>
      rowKey="id"
      dataSource={bookmarks}
      size="middle"
      scroll={{ x: 700 }}
      rowSelection={{
        selectedRowKeys: selected,
        onChange: (keys) => onSelect(keys.map(String)),
        getCheckboxProps: () => ({ disabled }),
      }}
      pagination={{ defaultPageSize: 20, showSizeChanger: true, showTotal: (total) => `共 ${total} 个书签` }}
      columns={[
        {
          title: "书签",
          key: "bookmark",
          render: (_, bookmark) => (
            <div className="bookmark-cell">
              <Typography.Text strong ellipsis={{ tooltip: bookmark.title }}>
                {bookmark.title || "未命名书签"}
              </Typography.Text>
              {bookmark.isWebUrl ? (
                <a href={bookmark.url} target="_blank" rel="noreferrer">
                  {bookmark.url}
                </a>
              ) : (
                <span>{bookmark.url}</span>
              )}
            </div>
          ),
        },
        {
          title: "目录",
          key: "folder",
          width: 200,
          render: (_, bookmark) => (
            <Typography.Text type="secondary">{bookmark.folderPath.join(" / ") || "根目录"}</Typography.Text>
          ),
        },
        {
          title: "检测结果",
          key: "status",
          width: 160,
          render: (_, bookmark) => {
            const result = results[bookmark.id];
            const status = result?.status ?? "unchecked";
            return (
              <Tooltip title={result?.error}>
                <Space orientation="vertical" size={2}>
                  <Tag color={statusColors[status]}>{statusLabels[status]}</Tag>
                  {result && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {reasonLabels[result.reason]}
                      {result.httpStatus ? ` · ${result.httpStatus}` : ""}
                    </Typography.Text>
                  )}
                </Space>
              </Tooltip>
            );
          },
        },
        {
          title: "",
          key: "actions",
          width: 60,
          render: (_, bookmark) => (
            <Button type="text" size="small" disabled={disabled} onClick={() => onEdit(bookmark)}>
              编辑
            </Button>
          ),
        },
      ]}
    />
  );
}
