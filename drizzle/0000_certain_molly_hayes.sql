CREATE TABLE `bets` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
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
	FOREIGN KEY (`market_id`) REFERENCES `markets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fixture_id`) REFERENCES `fixtures`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`competitor_id`) REFERENCES `competitors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `competitors` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`model` text NOT NULL,
	`engine_path` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fixtures` (
	`id` integer PRIMARY KEY NOT NULL,
	`league_id` integer NOT NULL,
	`league_name` text NOT NULL,
	`league_country` text NOT NULL,
	`league_season` integer NOT NULL,
	`home_team_id` integer NOT NULL,
	`home_team_name` text NOT NULL,
	`home_team_logo` text,
	`away_team_id` integer NOT NULL,
	`away_team_name` text NOT NULL,
	`away_team_logo` text,
	`date` text NOT NULL,
	`venue` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
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
	`created_at` integer NOT NULL,
	FOREIGN KEY (`market_id`) REFERENCES `markets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fixture_id`) REFERENCES `fixtures`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`competitor_id`) REFERENCES `competitors`(`id`) ON UPDATE no action ON DELETE no action
);
