import { Alert, Button, Drawer, Form, Input, InputNumber, Popconfirm, Select, Switch, Typography } from "antd";
import type { AiOptions, TaskRequest } from "@marksweep/core/protocol";

export interface Settings {
  ai: AiOptions;
  options: TaskRequest["options"];
}

export const defaultSettings: Settings = {
  ai: { baseUrl: "https://api.openai.com/v1", model: "", apiKey: "", lang: "zh", compatibility: "openai" },
  options: { concurrency: 20, timeout: 10000, retries: 2, maxPages: 20 },
};

export function SettingsDrawer({
  open,
  onClose,
  value,
  onChange,
  hasApiKey,
  disabled,
  onSave,
  configPath,
}: {
  open: boolean;
  onClose: () => void;
  value: Settings;
  onChange: (value: Settings) => void;
  hasApiKey: boolean;
  disabled: boolean;
  onSave: () => void;
  configPath: string;
}) {
  const setAi = (patch: Partial<AiOptions>) => onChange({ ...value, ai: { ...value.ai, ...patch } });
  const setOptions = (patch: Partial<Settings["options"]>) =>
    onChange({ ...value, options: { ...value.options, ...patch } });
  return (
    <Drawer
      title="工作台设置"
      open={open}
      onClose={onClose}
      size={420}
      footer={
        <Popconfirm
          title="保存 AI 配置到本机？"
          description={
            <span>
              API Key 会以明文保存到 {configPath || "本机配置文件"}。留空会保留已有密钥，环境变量仍优先于本机配置。
            </span>
          }
          onConfirm={onSave}
          disabled={disabled}
        >
          <Button type="primary" disabled={disabled}>
            保存 AI 配置到本机
          </Button>
        </Popconfirm>
      }
    >
      <Alert
        type="info"
        showIcon
        title="配置只在当前页面生效"
        description="可复用本机配置和环境变量。只有点击底部保存并确认后，AI 配置才会写入磁盘。密钥不进入浏览器恢复缓存。"
      />
      <Form layout="vertical" disabled={disabled} style={{ marginTop: 24 }}>
        <Typography.Title level={5}>OpenAI 兼容服务</Typography.Title>
        <Form.Item label="Base URL" htmlFor="settings-base-url">
          <Input id="settings-base-url" value={value.ai.baseUrl} onChange={(e) => setAi({ baseUrl: e.target.value })} />
        </Form.Item>
        <Form.Item label="模型" htmlFor="settings-model" extra="填写服务提供的模型 ID，不限制厂商或模型名称。">
          <Input
            id="settings-model"
            placeholder="请输入服务提供的模型名称"
            value={value.ai.model}
            onChange={(e) => setAi({ model: e.target.value })}
          />
        </Form.Item>
        <Form.Item
          label="API Key"
          htmlFor="settings-api-key"
          extra={hasApiKey ? "留空将使用本机已配置的密钥。" : "请填写密钥，或在本机配置环境变量。"}
        >
          <Input.Password
            id="settings-api-key"
            autoComplete="off"
            value={value.ai.apiKey}
            onChange={(e) => setAi({ apiKey: e.target.value })}
          />
        </Form.Item>
        <Form.Item label="兼容模式" htmlFor="settings-compatibility">
          <Select
            id="settings-compatibility"
            value={value.ai.compatibility}
            onChange={(compatibility) => setAi({ compatibility })}
            options={[
              { value: "auto", label: "自动识别" },
              { value: "openai", label: "OpenAI 兼容" },
              { value: "deepseek", label: "DeepSeek" },
            ]}
          />
        </Form.Item>
        <Form.Item label="分类语言" htmlFor="settings-language">
          <Input id="settings-language" value={value.ai.lang} onChange={(e) => setAi({ lang: e.target.value })} />
        </Form.Item>
        <Typography.Title level={5}>检测与 AI 任务</Typography.Title>
        <Form.Item
          label="AI 整理最长运行时间（分钟）"
          htmlFor="settings-ai-timeout"
          extra="默认 10 分钟，可随时停止任务。"
        >
          <InputNumber
            id="settings-ai-timeout"
            min={1}
            max={30}
            value={(value.options.aiTimeout ?? 600000) / 60000}
            onChange={(minutes) => setOptions({ aiTimeout: (minutes ?? 10) * 60000 })}
          />
        </Form.Item>
        <Form.Item label="检测并发数" htmlFor="settings-concurrency">
          <InputNumber
            min={1}
            max={100}
            id="settings-concurrency"
            value={value.options.concurrency}
            onChange={(n) => setOptions({ concurrency: n ?? 20 })}
          />
        </Form.Item>
        <Form.Item label="单次检测超时（毫秒）" htmlFor="settings-timeout">
          <InputNumber
            min={100}
            max={120000}
            id="settings-timeout"
            value={value.options.timeout}
            onChange={(n) => setOptions({ timeout: n ?? 10000 })}
          />
        </Form.Item>
        <Form.Item label="失败重试次数" htmlFor="settings-retries">
          <InputNumber
            min={0}
            max={5}
            id="settings-retries"
            value={value.options.retries}
            onChange={(n) => setOptions({ retries: n ?? 2 })}
          />
        </Form.Item>
        <Form.Item
          label="每轮 AI 任务最多读取页面数"
          htmlFor="settings-max-pages"
          extra="原书签和补充资料共用预算；设为 0 时仅根据书签元数据判断。"
        >
          <InputNumber
            min={0}
            max={100}
            id="settings-max-pages"
            value={value.options.maxPages}
            onChange={(n) => setOptions({ maxPages: n ?? 20 })}
          />
        </Form.Item>
        <Form.Item
          label="LangSmith 追踪"
          htmlFor="settings-langsmith"
          extra="需要在本机配置追踪密钥和项目；启用后提示词、输出和工具调用会发送给 LangSmith。"
        >
          <Switch checked={Boolean(value.options.langsmith)} onChange={(langsmith) => setOptions({ langsmith })} />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
