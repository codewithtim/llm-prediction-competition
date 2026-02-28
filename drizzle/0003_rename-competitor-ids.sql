-- Rename competitor IDs from generic "<platform>-runtime" to "<platform>-<model>"
-- so multiple models from the same provider can compete against each other.

-- Rename in competitors table
UPDATE `competitors` SET `id` = 'anthropic-claude-sonnet-4' WHERE `id` = 'claude-runtime';
--> statement-breakpoint
UPDATE `competitors` SET `id` = 'openai-gpt-4o' WHERE `id` = 'gpt4o-runtime';
--> statement-breakpoint
UPDATE `competitors` SET `id` = 'google-gemini-2.0-flash-001' WHERE `id` = 'gemini-runtime';
--> statement-breakpoint

-- Update FK references in bets
UPDATE `bets` SET `competitor_id` = 'anthropic-claude-sonnet-4' WHERE `competitor_id` = 'claude-runtime';
--> statement-breakpoint
UPDATE `bets` SET `competitor_id` = 'openai-gpt-4o' WHERE `competitor_id` = 'gpt4o-runtime';
--> statement-breakpoint
UPDATE `bets` SET `competitor_id` = 'google-gemini-2.0-flash-001' WHERE `competitor_id` = 'gemini-runtime';
--> statement-breakpoint

-- Update FK references in predictions
UPDATE `predictions` SET `competitor_id` = 'anthropic-claude-sonnet-4' WHERE `competitor_id` = 'claude-runtime';
--> statement-breakpoint
UPDATE `predictions` SET `competitor_id` = 'openai-gpt-4o' WHERE `competitor_id` = 'gpt4o-runtime';
--> statement-breakpoint
UPDATE `predictions` SET `competitor_id` = 'google-gemini-2.0-flash-001' WHERE `competitor_id` = 'gemini-runtime';
--> statement-breakpoint

-- Update FK references in competitor_versions
UPDATE `competitor_versions` SET `competitor_id` = 'anthropic-claude-sonnet-4' WHERE `competitor_id` = 'claude-runtime';
--> statement-breakpoint
UPDATE `competitor_versions` SET `competitor_id` = 'openai-gpt-4o' WHERE `competitor_id` = 'gpt4o-runtime';
--> statement-breakpoint
UPDATE `competitor_versions` SET `competitor_id` = 'google-gemini-2.0-flash-001' WHERE `competitor_id` = 'gemini-runtime';
--> statement-breakpoint

-- Update FK references in competitor_wallets
UPDATE `competitor_wallets` SET `competitor_id` = 'anthropic-claude-sonnet-4' WHERE `competitor_id` = 'claude-runtime';
--> statement-breakpoint
UPDATE `competitor_wallets` SET `competitor_id` = 'openai-gpt-4o' WHERE `competitor_id` = 'gpt4o-runtime';
--> statement-breakpoint
UPDATE `competitor_wallets` SET `competitor_id` = 'google-gemini-2.0-flash-001' WHERE `competitor_id` = 'gemini-runtime';
