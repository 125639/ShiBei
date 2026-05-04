export type ModelProviderPreset = {
  key: string;
  label: string;
  baseUrl: string;
  model: string;
  note: string;
};

// All presets below are OpenAI-compatible /chat/completions endpoints.
export const MODEL_PROVIDER_PRESETS: ModelProviderPreset[] = [
  {
    key: "canopywave",
    label: "CanopyWave",
    baseUrl: "https://inference.canopywave.io/v1",
    model: "moonshotai/kimi-k2.6",
    note: "适合接入 Kimi / Moonshot 兼容模型。"
  },
  {
    key: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    note: "通用写作、翻译和对话。"
  },
  {
    key: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    note: "中文整理与长文本性价比较高。"
  },
  {
    key: "moonshot",
    label: "Moonshot",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "moonshot-v1-32k",
    note: "长上下文中文阅读和写作。"
  },
  {
    key: "qwen",
    label: "通义千问 DashScope",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    note: "国内部署友好，兼容 OpenAI 协议。"
  },
  {
    key: "siliconflow",
    label: "SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "deepseek-ai/DeepSeek-V3",
    note: "可选开源与商业模型聚合服务。"
  },
  {
    key: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
    note: "多模型路由，适合备用模型池。"
  },
  {
    key: "custom",
    label: "自定义兼容服务",
    baseUrl: "https://example.com/v1",
    model: "your-model-name",
    note: "任何兼容 OpenAI chat/completions 的服务。"
  }
];

export function providerLabel(provider: string | null | undefined) {
  return MODEL_PROVIDER_PRESETS.find((item) => item.key === provider)?.label || provider || "自定义";
}
