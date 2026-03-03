-- Clean related tables (FK dependencies)
DELETE FROM `bets`;
--> statement-breakpoint
DELETE FROM `predictions`;
--> statement-breakpoint
DELETE FROM `competitor_versions`;
--> statement-breakpoint
DELETE FROM `competitor_wallets`;
--> statement-breakpoint
DELETE FROM `competitors`;
--> statement-breakpoint
-- Insert new competitors
INSERT INTO `competitors` (id, name, type, status, model, engine_path, config, created_at)
VALUES
  ('wt-gpt-52',             'Weight-Tuned GPT-5.2',             'weight-tuned', 'active', 'openai/gpt-5.2',                    '', '{"model":"openai/gpt-5.2"}',                    unixepoch()),
  ('wt-grok-4',             'Weight-Tuned Grok 4',              'weight-tuned', 'active', 'x-ai/grok-4',                       '', '{"model":"x-ai/grok-4"}',                       unixepoch()),
  ('wt-claude-sonnet-46',   'Weight-Tuned Claude Sonnet 4.6',   'weight-tuned', 'active', 'anthropic/claude-sonnet-4.6',       '', '{"model":"anthropic/claude-sonnet-4.6"}',       unixepoch()),
  ('wt-claude-opus-46',     'Weight-Tuned Claude Opus 4.6',     'weight-tuned', 'active', 'anthropic/claude-opus-4.6',         '', '{"model":"anthropic/claude-opus-4.6"}',         unixepoch()),
  ('wt-gemini-31-pro',      'Weight-Tuned Gemini 3.1 Pro',      'weight-tuned', 'active', 'google/gemini-3.1-pro-preview',     '', '{"model":"google/gemini-3.1-pro-preview"}',     unixepoch());
