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