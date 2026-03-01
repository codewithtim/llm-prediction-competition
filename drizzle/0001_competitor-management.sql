-- Create competitor_versions table
CREATE TABLE `competitor_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`competitor_id` text NOT NULL,
	`version` integer NOT NULL,
	`code` text NOT NULL,
	`engine_path` text NOT NULL,
	`model` text NOT NULL,
	`performance_snapshot` text,
	`generated_at` integer NOT NULL,
	FOREIGN KEY (`competitor_id`) REFERENCES `competitors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint

-- Recreate competitors table with new schema (status, type, config; drop active; engine_path nullable)
CREATE TABLE `__competitors_new` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`model` text NOT NULL,
	`engine_path` text,
	`status` text NOT NULL DEFAULT 'active',
	`type` text NOT NULL DEFAULT 'weight-tuned',
	`config` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__competitors_new` (`id`, `name`, `model`, `engine_path`, `status`, `type`, `created_at`)
	SELECT `id`, `name`, `model`, `engine_path`, 'active', 'weight-tuned', `created_at` FROM `competitors`;
--> statement-breakpoint
DROP TABLE `competitors`;
--> statement-breakpoint
ALTER TABLE `__competitors_new` RENAME TO `competitors`;
--> statement-breakpoint

-- Built-in competitors (inserted once via migration, managed via DB thereafter)
INSERT INTO `competitors` (`id`, `name`, `type`, `status`, `model`, `engine_path`, `config`, `created_at`)
VALUES
	('wt-claude-sonnet', 'Weight-Tuned Claude Sonnet', 'weight-tuned', 'active', 'anthropic/claude-sonnet-4', '', '{"model":"anthropic/claude-sonnet-4"}', unixepoch()),
	('wt-gpt-4o', 'Weight-Tuned GPT-4o', 'weight-tuned', 'active', 'openai/gpt-4o', '', '{"model":"openai/gpt-4o"}', unixepoch()),
	('wt-gemini-flash', 'Weight-Tuned Gemini Flash', 'weight-tuned', 'active', 'google/gemini-2.0-flash-001', '', '{"model":"google/gemini-2.0-flash-001"}', unixepoch());
