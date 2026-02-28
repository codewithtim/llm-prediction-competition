CREATE TABLE `competitor_wallets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`competitor_id` text NOT NULL,
	`wallet_address` text NOT NULL,
	`encrypted_private_key` text NOT NULL,
	`encrypted_api_key` text NOT NULL,
	`encrypted_api_secret` text NOT NULL,
	`encrypted_api_passphrase` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`competitor_id`) REFERENCES `competitors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `competitor_wallets_competitor_id_unique` ON `competitor_wallets` (`competitor_id`);