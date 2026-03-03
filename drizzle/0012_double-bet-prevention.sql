CREATE UNIQUE INDEX idx_bets_active_market_competitor
ON bets(market_id, competitor_id)
WHERE status IN ('submitting', 'pending', 'filled');
