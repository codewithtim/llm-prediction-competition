import type { betsRepo as betsRepoFactory } from "../../infrastructure/database/repositories/bets";
import type { BettingClientFactory } from "../../infrastructure/polymarket/betting-client-factory";
import { logger } from "../../shared/logger";
import type { WalletConfig } from "../types/competitor";

export type OrderConfirmationResult = {
  confirmed: number;
  cancelled: number;
  failed: number;
  stillPending: number;
  errors: string[];
};

export function createOrderConfirmationService(deps: {
  betsRepo: ReturnType<typeof betsRepoFactory>;
  bettingClientFactory: BettingClientFactory;
  walletConfigs: Map<string, WalletConfig>;
  maxOrderAgeMs: number;
}) {
  const { betsRepo, bettingClientFactory, walletConfigs, maxOrderAgeMs } = deps;

  return {
    async confirmOrders(): Promise<OrderConfirmationResult> {
      const result: OrderConfirmationResult = {
        confirmed: 0,
        cancelled: 0,
        failed: 0,
        stillPending: 0,
        errors: [],
      };

      // Recover stuck submitting bets (process crashed mid-placement)
      const submittingBets = await betsRepo.findByStatus("submitting");
      for (const bet of submittingBets) {
        const age = Date.now() - bet.placedAt.getTime();
        if (age > maxOrderAgeMs) {
          try {
            await betsRepo.updateBetAfterSubmission(bet.id, {
              status: "failed",
              errorMessage: "Stuck in submitting state — possible crash during placement",
              errorCategory: "unknown",
              attempts: bet.attempts + 1,
              lastAttemptAt: new Date(),
            });
            result.failed++;
            logger.info("Order confirmation: recovered stuck submitting bet", {
              betId: bet.id,
              ageMs: age,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            result.errors.push(`Error recovering submitting bet ${bet.id}: ${msg}`);
          }
        }
      }

      const pendingBets = await betsRepo.findByStatus("pending");
      if (pendingBets.length === 0 && result.failed === 0) return result;

      // Group bets by competitor
      const byCompetitor = new Map<string, typeof pendingBets>();
      for (const bet of pendingBets) {
        const group = byCompetitor.get(bet.competitorId) ?? [];
        group.push(bet);
        byCompetitor.set(bet.competitorId, group);
      }

      for (const [competitorId, bets] of byCompetitor) {
        const walletConfig = walletConfigs.get(competitorId);
        if (!walletConfig) {
          result.errors.push(`No wallet config for competitor ${competitorId}`);
          continue;
        }

        let openOrderIds: Set<string>;
        try {
          const client = bettingClientFactory.getClient(competitorId, walletConfig);
          const openOrders = await client.getOpenOrders();
          // OpenOrders can be an array or { data: [...] } depending on CLOB client version
          const orderList = Array.isArray(openOrders)
            ? openOrders
            : (((openOrders as Record<string, unknown>).data as Array<{ id: string }>) ?? []);
          openOrderIds = new Set(orderList.map((o: { id: string }) => o.id));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Error fetching open orders for ${competitorId}: ${msg}`);
          continue;
        }

        for (const bet of bets) {
          try {
            // Ghost order: never actually placed (orderId is null/empty or invalid)
            // CLOB client returns { error, status } on failure, which our code
            // previously stringified to "[object Object]" or "undefined"
            const isGhostOrder =
              bet.orderId == null ||
              bet.orderId === "" ||
              bet.orderId === "[object Object]" ||
              bet.orderId === "undefined" ||
              bet.orderId === "null";
            if (isGhostOrder) {
              await betsRepo.updateBetAfterSubmission(bet.id, {
                status: "failed",
                errorMessage: `Order was never placed (invalid orderId: ${JSON.stringify(bet.orderId)})`,
                errorCategory: "unknown",
                attempts: bet.attempts + 1,
                lastAttemptAt: new Date(),
              });
              result.failed++;
              continue;
            }

            // After ghost-order check above, orderId is guaranteed non-null
            const orderId = bet.orderId as string;
            const isStillOpen = openOrderIds.has(orderId);

            if (!isStillOpen) {
              // Order no longer open -> filled
              await betsRepo.updateStatus(bet.id, "filled");
              result.confirmed++;
            } else {
              // Check if order is stale
              const age = Date.now() - bet.placedAt.getTime();
              if (age > maxOrderAgeMs) {
                // Cancel stale order
                const client = bettingClientFactory.getClient(competitorId, walletConfig);
                await client.cancelOrder(orderId);
                await betsRepo.updateStatus(bet.id, "cancelled");
                result.cancelled++;
                logger.info("Order confirmation: cancelled stale order", {
                  betId: bet.id,
                  orderId,
                  ageMs: age,
                });
              } else {
                result.stillPending++;
              }
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            result.errors.push(`Error processing bet ${bet.id}: ${msg}`);
          }
        }
      }

      return result;
    },
  };
}

export type OrderConfirmationService = ReturnType<typeof createOrderConfirmationService>;
