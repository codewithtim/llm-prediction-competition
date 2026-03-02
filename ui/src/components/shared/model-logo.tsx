import {
  SiAnthropic,
  SiChatbot,
  SiGooglegemini,
  SiMeta,
  SiMistralai,
  SiOllama,
} from "@icons-pack/react-simple-icons";
import { Bot } from "lucide-react";
import type { ComponentType } from "react";

type IconComponent = ComponentType<{ size?: number; className?: string }>;

type ModelConfig = {
  icon: IconComponent;
  color: string;
};

const MODEL_REGISTRY: [string, ModelConfig][] = [
  ["claude", { icon: SiAnthropic, color: "text-amber-500" }],
  ["anthropic", { icon: SiAnthropic, color: "text-amber-500" }],
  ["gpt", { icon: SiChatbot, color: "text-emerald-400" }],
  ["chatgpt", { icon: SiChatbot, color: "text-emerald-400" }],
  ["openai", { icon: SiChatbot, color: "text-emerald-400" }],
  ["o1", { icon: SiChatbot, color: "text-emerald-400" }],
  ["o3", { icon: SiChatbot, color: "text-emerald-400" }],
  ["gemini", { icon: SiGooglegemini, color: "text-blue-400" }],
  ["llama", { icon: SiMeta, color: "text-blue-300" }],
  ["ollama", { icon: SiOllama, color: "text-zinc-300" }],
  ["meta", { icon: SiMeta, color: "text-blue-300" }],
  ["mistral", { icon: SiMistralai, color: "text-orange-400" }],
  ["deepseek", { icon: Bot, color: "text-blue-500" }],
  ["qwen", { icon: Bot, color: "text-rose-400" }],
];

function getModelConfig(model: string): ModelConfig {
  const lower = model.toLowerCase();
  for (const [key, config] of MODEL_REGISTRY) {
    if (lower.includes(key)) return config;
  }
  return { icon: Bot, color: "text-zinc-400" };
}

export function ModelLogo({ model, size = "sm" }: { model: string; size?: "sm" | "md" }) {
  const config = getModelConfig(model);
  const px = size === "sm" ? 18 : 22;
  const Icon = config.icon;
  return (
    <span className={`inline-flex shrink-0 ${config.color}`} title={model}>
      <Icon size={px} />
    </span>
  );
}
