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
	`type` text NOT NULL DEFAULT 'codegen',
	`config` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__competitors_new` (`id`, `name`, `model`, `engine_path`, `status`, `type`, `created_at`)
	SELECT `id`, `name`, `model`, `engine_path`, 'active', 'codegen', `created_at` FROM `competitors`;
--> statement-breakpoint
DROP TABLE `competitors`;
--> statement-breakpoint
ALTER TABLE `__competitors_new` RENAME TO `competitors`;
--> statement-breakpoint

-- Built-in competitors (inserted once via migration, managed via DB thereafter)
INSERT INTO `competitors` (`id`, `name`, `type`, `status`, `model`, `engine_path`, `config`, `created_at`)
VALUES
	('baseline', 'Manual Baseline', 'baseline', 'active', 'heuristic', 'src/competitors/baseline/engine.ts', NULL, unixepoch()),
	('claude-runtime', 'Claude Sonnet (Runtime)', 'runtime', 'active', 'anthropic/claude-sonnet-4', NULL, '{"model":"anthropic/claude-sonnet-4"}', unixepoch()),
	('gpt4o-runtime', 'GPT-4o (Runtime)', 'runtime', 'active', 'openai/gpt-4o', NULL, '{"model":"openai/gpt-4o"}', unixepoch()),
	('gemini-runtime', 'Gemini Flash (Runtime)', 'runtime', 'active', 'google/gemini-2.0-flash-001', NULL, '{"model":"google/gemini-2.0-flash-001"}', unixepoch());
