export const COMPETITOR_STATUSES = ["active", "disabled", "pending", "error"] as const;
export type CompetitorStatus = (typeof COMPETITOR_STATUSES)[number];

export const COMPETITOR_TYPES = ["baseline", "runtime", "codegen", "external"] as const;
export type CompetitorType = (typeof COMPETITOR_TYPES)[number];

export type RuntimeConfig = { model: string };
export type CodegenConfig = { model: string };
export type ExternalConfig = { webhookUrl: string; apiKey: string };
export type CompetitorConfig = RuntimeConfig | CodegenConfig | ExternalConfig | null;

export type WalletConfig = {
  polyPrivateKey: string;
  polyApiKey: string;
  polyApiSecret: string;
  polyApiPassphrase: string;
};
