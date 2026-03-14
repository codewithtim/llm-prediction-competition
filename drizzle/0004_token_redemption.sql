ALTER TABLE `bets` ADD COLUMN `redeemed_at` integer;
--> statement-breakpoint
ALTER TABLE `bets` ADD COLUMN `redemption_tx_hash` text;