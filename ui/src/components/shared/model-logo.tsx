const MODEL_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  claude: { label: "C", bg: "bg-amber-600", text: "text-amber-100" },
  gpt: { label: "G", bg: "bg-emerald-600", text: "text-emerald-100" },
  gemini: { label: "G", bg: "bg-blue-600", text: "text-blue-100" },
  llama: { label: "L", bg: "bg-purple-600", text: "text-purple-100" },
  mistral: { label: "M", bg: "bg-cyan-600", text: "text-cyan-100" },
  deepseek: { label: "D", bg: "bg-indigo-600", text: "text-indigo-100" },
  qwen: { label: "Q", bg: "bg-rose-600", text: "text-rose-100" },
};

function getModelConfig(model: string) {
  const lower = model.toLowerCase();
  for (const [key, config] of Object.entries(MODEL_CONFIG)) {
    if (lower.includes(key)) return config;
  }
  return { label: model.charAt(0).toUpperCase(), bg: "bg-zinc-600", text: "text-zinc-100" };
}

export function ModelLogo({ model, size = "sm" }: { model: string; size?: "sm" | "md" }) {
  const config = getModelConfig(model);
  const sizeClass = size === "sm" ? "h-6 w-6 text-xs" : "h-8 w-8 text-sm";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${sizeClass} ${config.bg} ${config.text}`}
      title={model}
    >
      {config.label}
    </span>
  );
}
