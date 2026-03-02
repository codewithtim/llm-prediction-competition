ALTER TABLE `bets` ADD `error_message` text;--> statement-breakpoint
ALTER TABLE `bets` ADD `error_category` text;--> statement-breakpoint
ALTER TABLE `bets` ADD `attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `bets` ADD `last_attempt_at` integer;