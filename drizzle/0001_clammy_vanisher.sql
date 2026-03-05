CREATE TABLE `betting_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`competitor_id` text NOT NULL,
	`market_id` text,
	`fixture_id` integer,
	`event` text NOT NULL,
	`reason` text,
	`metadata` text,
	`timestamp` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `betting_events_competitor_idx` ON `betting_events` (`competitor_id`);--> statement-breakpoint
CREATE INDEX `betting_events_event_idx` ON `betting_events` (`event`);