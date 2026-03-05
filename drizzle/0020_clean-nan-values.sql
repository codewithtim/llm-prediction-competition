-- NaN detection in SQLite: value != value is true only for NaN
UPDATE markets SET liquidity = 0 WHERE typeof(liquidity) = 'real' AND liquidity != liquidity;--> statement-breakpoint
UPDATE markets SET volume = 0 WHERE typeof(volume) = 'real' AND volume != volume;--> statement-breakpoint
UPDATE bets SET shares = 0 WHERE typeof(shares) = 'real' AND shares != shares;--> statement-breakpoint
UPDATE bets SET profit = 0 WHERE typeof(profit) = 'real' AND profit != profit;--> statement-breakpoint
UPDATE bets SET price = 0 WHERE typeof(price) = 'real' AND price != price;--> statement-breakpoint
UPDATE predictions SET confidence = 0 WHERE typeof(confidence) = 'real' AND confidence != confidence;--> statement-breakpoint
UPDATE predictions SET stake = 0 WHERE typeof(stake) = 'real' AND stake != stake;
