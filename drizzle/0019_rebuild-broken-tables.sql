DROP TABLE IF EXISTS `bet_audit_log`;
--> statement-breakpoint
DROP TABLE IF EXISTS `bets`;
--> statement-breakpoint
DROP TABLE IF EXISTS `predictions`;
--> statement-breakpoint
DROP TABLE IF EXISTS `markets`;
--> statement-breakpoint
CREATE TABLE `markets` (
	`id` text PRIMARY KEY NOT NULL,
	`condition_id` text NOT NULL,
	`slug` text NOT NULL,
	`question` text NOT NULL,
	`outcomes` text NOT NULL,
	`outcome_prices` text NOT NULL,
	`token_ids` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`closed` integer DEFAULT false NOT NULL,
	`accepting_orders` integer DEFAULT true NOT NULL,
	`liquidity` real DEFAULT 0 NOT NULL,
	`volume` real DEFAULT 0 NOT NULL,
	`game_id` text,
	`sports_market_type` text,
	`line` real,
	`polymarket_url` text,
	`fixture_id` integer REFERENCES fixtures(id),
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `predictions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`market_id` text NOT NULL,
	`fixture_id` integer NOT NULL,
	`competitor_id` text NOT NULL,
	`side` text NOT NULL,
	`confidence` real NOT NULL,
	`stake` real NOT NULL,
	`reasoning` text NOT NULL,
	`extracted_features` text,
	`stake_adjustment` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`market_id`) REFERENCES `markets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fixture_id`) REFERENCES `fixtures`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`competitor_id`) REFERENCES `competitors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bets` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text,
	`market_id` text NOT NULL,
	`fixture_id` integer NOT NULL,
	`competitor_id` text NOT NULL,
	`token_id` text NOT NULL,
	`side` text NOT NULL,
	`amount` real NOT NULL,
	`price` real NOT NULL,
	`shares` real NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`placed_at` integer NOT NULL,
	`settled_at` integer,
	`profit` real,
	`error_message` text,
	`error_category` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_attempt_at` integer,
	FOREIGN KEY (`market_id`) REFERENCES `markets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fixture_id`) REFERENCES `fixtures`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`competitor_id`) REFERENCES `competitors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_bets_active_market_competitor` ON `bets` (`market_id`, `competitor_id`) WHERE `status` IN ('submitting', 'pending', 'filled');
--> statement-breakpoint
CREATE TABLE `bet_audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bet_id` text NOT NULL,
	`event` text NOT NULL,
	`status_before` text,
	`status_after` text NOT NULL,
	`order_id` text,
	`error` text,
	`error_category` text,
	`metadata` text,
	`timestamp` integer NOT NULL,
	FOREIGN KEY (`bet_id`) REFERENCES `bets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `bet_audit_log_bet_id_idx` ON `bet_audit_log` (`bet_id`);
