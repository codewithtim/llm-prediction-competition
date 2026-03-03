CREATE TABLE `player_stats_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` integer NOT NULL,
	`league_id` integer NOT NULL,
	`season` integer NOT NULL,
	`data` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `team_stats_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` integer NOT NULL,
	`league_id` integer NOT NULL,
	`season` integer NOT NULL,
	`data` text NOT NULL,
	`fetched_at` integer NOT NULL
);
