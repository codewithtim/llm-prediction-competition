DROP INDEX "competitor_wallets_competitor_id_unique";--> statement-breakpoint
ALTER TABLE `bets` ALTER COLUMN "order_id" TO "order_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX `competitor_wallets_competitor_id_unique` ON `competitor_wallets` (`competitor_id`);