CREATE TABLE `sports` (
	`slug` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`polymarket_tag_id` integer,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `leagues` (
	`id` integer PRIMARY KEY NOT NULL,
	`sport` text NOT NULL REFERENCES `sports`(`slug`),
	`name` text NOT NULL,
	`country` text NOT NULL,
	`type` text NOT NULL,
	`polymarket_series_slug` text NOT NULL,
	`domestic_league_ids` text,
	`tier` integer DEFAULT 5 NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `sports` (`slug`, `name`, `polymarket_tag_id`, `enabled`, `created_at`, `updated_at`) VALUES
	('football', 'Football', 100350, 1, unixepoch(), unixepoch());
--> statement-breakpoint
INSERT INTO `leagues` (`id`, `sport`, `name`, `country`, `type`, `polymarket_series_slug`, `domestic_league_ids`, `tier`, `enabled`, `created_at`, `updated_at`) VALUES
	(39, 'football', 'Premier League', 'England', 'league', 'premier-league', NULL, 1, 1, unixepoch(), unixepoch()),
	(2, 'football', 'Champions League', 'World', 'cup', 'ucl', '[39,140,135,78,61]', 1, 1, unixepoch(), unixepoch()),
	(140, 'football', 'La Liga', 'Spain', 'league', 'la-liga', NULL, 1, 0, unixepoch(), unixepoch()),
	(135, 'football', 'Serie A', 'Italy', 'league', 'serie-a', NULL, 1, 0, unixepoch(), unixepoch()),
	(78, 'football', 'Bundesliga', 'Germany', 'league', 'bundesliga', NULL, 1, 0, unixepoch(), unixepoch()),
	(61, 'football', 'Ligue 1', 'France', 'league', 'ligue-1', NULL, 1, 0, unixepoch(), unixepoch()),
	(40, 'football', 'Championship', 'England', 'league', 'efl-championship', NULL, 2, 1, unixepoch(), unixepoch()),
	(45, 'football', 'FA Cup', 'England', 'cup', 'fa-cup', '[39,40,41,42]', 2, 0, unixepoch(), unixepoch());
