-- Fix production schema: migrations 0016-0017 were silently skipped because
-- their journal timestamps were lower than the DB's max created_at.
-- This migration idempotently applies their changes and clears corrupted data.

-- 1. Drop bet_audit_log (may or may not exist depending on environment)
DROP TABLE IF EXISTS `bet_audit_log`;
--> statement-breakpoint

-- 2. Delete all bets (references markets via FK)
DELETE FROM `bets`;
--> statement-breakpoint

-- 3. Drop and recreate predictions with all columns (including stake_adjustment from 0017)
DROP TABLE IF EXISTS `predictions`;
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

-- 4. Clear corrupted data from markets
DELETE FROM `markets`;
--> statement-breakpoint

-- 5. Recreate bet_audit_log table (from skipped migration 0016)
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
