export const COMPETITOR_STATUSES = ["active", "disabled", "pending", "error"] as const;
export type CompetitorStatus = (typeof COMPETITOR_STATUSES)[number];

export const COMPETITOR_TYPES = ["weight-tuned", "external"] as const;
export type CompetitorType = (typeof COMPETITOR_TYPES)[number];

export type WeightTunedConfig = { model: string };
export type ExternalConfig = { webhookUrl: string; apiKey: string };
export type CompetitorConfig = WeightTunedConfig | ExternalConfig | null;

export type WalletConfig = {
  polyPrivateKey: string;
  polyApiKey: string;
  polyApiSecret: string;
  polyApiPassphrase: string;
};
