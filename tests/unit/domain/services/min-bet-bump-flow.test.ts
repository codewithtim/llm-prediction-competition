import { describe, expect, it, mock } from "bun:test";
import { createBettingService } from "../../../../src/domain/services/betting";
import { createBetRetryService } from "../../../../src/domain/services/bet-retry";
import type { AuditLogRepo } from "../../../../src/database/repositories/audit-log";
import type { BettingEventsRepo } from "../../../../src/database/repositories/betting-events";
import type { betsRepo as betsRepoFactory } from "../../../../src/database/repositories/bets";
import type { predictionsRepo as predictionsRepoFactory } from "../../../../src/database/repositories/predictions";
import type { BettingClient } from "../../../../src/apis/polymarket/betting-client";
import type { BettingClientFactory } from "../../../../src/apis/polymarket/betting-client-factory";
import type { BettingConfig } from "../../../../src/domain/services/betting";

type BetsRepo = ReturnType<typeof betsRepoFactory>;
type PredictionsRepo = ReturnType<typeof predictionsRepoFactory>;

type BetRow = {
	id: string;
	orderId: string | null;
	marketId: string;
	fixtureId: number;
	competitorId: string;
	tokenId: string;
	side: "YES" | "NO";
	amount: number;
	price: number;
	shares: number;
	status: string;
	placedAt: Date;
	settledAt: Date | null;
	profit: number | null;
	errorMessage: string | null;
	errorCategory: string | null;
	attempts: number;
	lastAttemptAt: Date | null;
};

function mockAuditLog(): AuditLogRepo {
	return {
		record: mock(() => Promise.resolve({} as any)),
		safeRecord: mock(() => Promise.resolve()),
		findByBetId: mock(() => Promise.resolve([])),
	};
}

function mockBettingEventsRepo(): BettingEventsRepo {
	return {
		record: mock(() => Promise.resolve({} as any)),
		safeRecord: mock(() => Promise.resolve()),
		findByCompetitor: mock(() => Promise.resolve([])),
	};
}

function mockPredictionsRepo(): PredictionsRepo {
	return {
		create: mock(() => Promise.resolve()),
		findAll: mock(() => Promise.resolve([])),
		findRecent: mock(() => Promise.resolve([])),
		findByCompetitor: mock(() => Promise.resolve([])),
		findByMarket: mock(() => Promise.resolve([])),
		findByFixtureAndCompetitor: mock(() => Promise.resolve([])),
		addStakeAdjustment: mock(() => Promise.resolve()),
	} as unknown as PredictionsRepo;
}

function mockBettingClient(overrides?: Partial<BettingClient>): BettingClient {
	return {
		placeOrder: mock(() => Promise.resolve({ orderId: "order-abc" })),
		cancelOrder: mock(() => Promise.resolve()),
		cancelAll: mock(() => Promise.resolve()),
		getOpenOrders: mock(() => Promise.resolve({ data: [] })),
		getTickSize: mock(() => Promise.resolve("0.01" as const)),
		getNegRisk: mock(() => Promise.resolve(false)),
		...overrides,
	} as unknown as BettingClient;
}

function mockBettingClientFactory(client: BettingClient): BettingClientFactory {
	return {
		getClient: mock(() => client),
	} as unknown as BettingClientFactory;
}

function makeConfig(overrides?: Partial<BettingConfig>): BettingConfig {
	return {
		maxStakePerBet: 10,
		maxBetPctOfBankroll: 0.1,
		maxTotalExposure: 100,
		initialBankroll: 100,
		minBetAmount: 0.01,
		dryRun: false,
		proxyEnabled: false,
		...overrides,
	};
}

function makeWalletConfigs() {
	return new Map([
		[
			"comp-a",
			{
				polyPrivateKey: "0xkey-a",
				polyApiKey: "api-a",
				polyApiSecret: "secret-a",
				polyApiPassphrase: "pass-a",
			},
		],
	]);
}

const testMarket = {
	id: "market-1",
	conditionId: "cond-1",
	slug: "test",
	question: "Test?",
	outcomes: ["Yes", "No"] as [string, string],
	outcomePrices: ["0.65", "0.35"] as [string, string],
	tokenIds: ["token-yes", "token-no"] as [string, string],
	active: true,
	closed: false,
	acceptingOrders: true,
	liquidity: 10000,
	volume: 50000,
	gameId: null,
	polymarketUrl: null,
	sportsMarketType: null,
	line: null,
};

const testPrediction = {
	marketId: "market-1",
	side: "YES" as const,
	confidence: 0.8,
	stake: 0.5,
	reasoning: { summary: "test", sections: [{ label: "test", content: "test" }] },
};

describe("min-bet-bump flow", () => {
	it("happy path: place → order_too_small → retry bumps → success", async () => {
		const storedBets: BetRow[] = [];
		const auditLog = mockAuditLog();
		const predsRepo = mockPredictionsRepo();

		const betsRepo = {
			create: mock(() => Promise.resolve()),
			createIfNoActiveBet: mock((bet: BetRow) => {
				storedBets.push({ ...bet, placedAt: new Date(), settledAt: null, profit: null });
				return Promise.resolve("created" as const);
			}),
			hasActiveBetForMarket: mock(() => Promise.resolve(false)),
			findById: mock((id: string) =>
				Promise.resolve(storedBets.find((b) => b.id === id)),
			),
			findByCompetitor: mock(() => Promise.resolve(storedBets)),
			findByStatus: mock(() => Promise.resolve([])),
			updateStatus: mock((id: string, status: string) => {
				const bet = storedBets.find((b) => b.id === id);
				if (bet) bet.status = status;
				return Promise.resolve();
			}),
			updateBetAfterSubmission: mock(
				(id: string, update: { status: string; orderId?: string; errorMessage?: string; errorCategory?: string; attempts?: number }) => {
					const bet = storedBets.find((b) => b.id === id);
					if (bet) {
						bet.status = update.status;
						if (update.orderId) bet.orderId = update.orderId;
						if (update.errorMessage) bet.errorMessage = update.errorMessage;
						if (update.errorCategory) bet.errorCategory = update.errorCategory;
						if (update.attempts !== undefined) bet.attempts = update.attempts;
					}
					return Promise.resolve();
				},
			),
			updateAmount: mock((id: string, newAmount: number) => {
				const bet = storedBets.find((b) => b.id === id);
				if (bet) {
					bet.amount = newAmount;
					bet.shares = newAmount / bet.price;
				}
				return Promise.resolve();
			}),
			findRetryableBets: mock(() =>
				Promise.resolve(storedBets.filter((b) => b.status === "failed").map((b) => ({ ...b }))),
			),
			findAll: mock(() => Promise.resolve(storedBets)),
			findRecent: mock(() => Promise.resolve([])),
			getPerformanceStats: mock(() =>
				Promise.resolve({
					competitorId: "",
					totalBets: 0,
					wins: 0,
					losses: 0,
					pending: 0,
					failed: 0,
					lockedAmount: 0,
					totalStaked: 0,
					totalReturned: 0,
					profitLoss: 0,
					accuracy: 0,
					roi: 0,
				}),
			),
		} as unknown as BetsRepo;

		// Step 1: Place bet - client rejects with order_too_small
		const client = mockBettingClient({
			placeOrder: mock(() =>
				Promise.reject(
					new Error("invalid amount for a marketable BUY order ($0.31), min size: $1"),
				),
			),
		});
		const factory = mockBettingClientFactory(client);

		const bettingService = createBettingService({
			bettingClientFactory: factory,
			betsRepo: betsRepo,
			auditLog,
			bettingEventsRepo: mockBettingEventsRepo(),
			config: makeConfig(),
		});

		const placeResult = await bettingService.placeBet({
			prediction: testPrediction,
			resolvedStake: 0.31,
			market: testMarket,
			fixtureId: 1001,
			competitorId: "comp-a",
			walletConfig: {
				polyPrivateKey: "0xkey",
				polyApiKey: "api",
				polyApiSecret: "secret",
				polyApiPassphrase: "pass",
			},
		});

		expect(placeResult.status).toBe("failed");
		expect(placeResult.errorCategory).toBe("order_too_small");
		expect(storedBets).toHaveLength(1);
		expect(storedBets[0]!.status).toBe("failed");
		expect(storedBets[0]!.amount).toBe(0.31);

		// Step 2: Reconfigure client to succeed
		(client.placeOrder as ReturnType<typeof mock>).mockImplementation(() =>
			Promise.resolve({ orderId: "order-success" }),
		);

		const retryService = createBetRetryService({
			betsRepo: betsRepo,
			bettingClientFactory: factory,
			auditLog,
			predictionsRepo: predsRepo,
			walletConfigs: makeWalletConfigs(),
			maxRetryAttempts: 3,
			maxStakePerBet: 10,
			bankrollProvider: { getBankroll: mock(() => Promise.resolve(100)) },
			maxBumpPctOfBankroll: 0.2,
			proxyEnabled: false,
		});

		const retryResult = await retryService.retryFailedBets();

		expect(retryResult.succeeded).toBe(1);

		// Verify placeOrder was called with bumped amount
		const lastPlaceCall = (client.placeOrder as ReturnType<typeof mock>).mock.calls.at(
			-1,
		)![0] as { amount: number };
		expect(lastPlaceCall.amount).toBe(1);

		// Verify bet amount was updated in DB
		expect(storedBets[0]!.amount).toBe(1);

		// Verify prediction annotated
		expect(predsRepo.addStakeAdjustment).toHaveBeenCalledTimes(1);
		const [, , adj] = (predsRepo.addStakeAdjustment as ReturnType<typeof mock>).mock.calls[0] as [
			string,
			string,
			{ originalStake: number; adjustedStake: number; reason: string },
		];
		expect(adj.originalStake).toBe(0.31);
		expect(adj.adjustedStake).toBe(1);
		expect(adj.reason).toBe("min_bet_bump");

		// Verify audit trail includes stake adjustment
		const auditCalls = (auditLog.safeRecord as ReturnType<typeof mock>).mock.calls as unknown[][];
		const retryStartedEntry = auditCalls.find(
			(c) => (c[0] as Record<string, unknown>).event === "retry_started",
		);
		expect(retryStartedEntry).toBeDefined();
		const retryMeta = (retryStartedEntry![0] as Record<string, unknown>).metadata as Record<
			string,
			unknown
		>;
		expect(retryMeta.stakeAdjustment).toBeDefined();
	});

	it("guard: min bet exceeds max stake → stays failed", async () => {
		const storedBets: BetRow[] = [];
		const auditLog = mockAuditLog();
		const predsRepo = mockPredictionsRepo();

		const betsRepo = {
			create: mock(() => Promise.resolve()),
			createIfNoActiveBet: mock((bet: BetRow) => {
				storedBets.push({ ...bet, placedAt: new Date(), settledAt: null, profit: null });
				return Promise.resolve("created" as const);
			}),
			hasActiveBetForMarket: mock(() => Promise.resolve(false)),
			findById: mock((id: string) =>
				Promise.resolve(storedBets.find((b) => b.id === id)),
			),
			findByCompetitor: mock(() => Promise.resolve(storedBets)),
			findByStatus: mock(() => Promise.resolve([])),
			updateStatus: mock((id: string, status: string) => {
				const bet = storedBets.find((b) => b.id === id);
				if (bet) bet.status = status;
				return Promise.resolve();
			}),
			updateBetAfterSubmission: mock(
				(id: string, update: { status: string; errorMessage?: string; errorCategory?: string; attempts?: number }) => {
					const bet = storedBets.find((b) => b.id === id);
					if (bet) {
						bet.status = update.status;
						if (update.errorMessage) bet.errorMessage = update.errorMessage;
						if (update.errorCategory) bet.errorCategory = update.errorCategory;
						if (update.attempts !== undefined) bet.attempts = update.attempts;
					}
					return Promise.resolve();
				},
			),
			updateAmount: mock(() => Promise.resolve()),
			findRetryableBets: mock(() =>
				Promise.resolve(storedBets.filter((b) => b.status === "failed").map((b) => ({ ...b }))),
			),
			findAll: mock(() => Promise.resolve(storedBets)),
			findRecent: mock(() => Promise.resolve([])),
			getPerformanceStats: mock(() =>
				Promise.resolve({
					competitorId: "",
					totalBets: 0,
					wins: 0,
					losses: 0,
					pending: 0,
					failed: 0,
					lockedAmount: 0,
					totalStaked: 0,
					totalReturned: 0,
					profitLoss: 0,
					accuracy: 0,
					roi: 0,
				}),
			),
		} as unknown as BetsRepo;

		// Place bet - client rejects with min size $50
		const client = mockBettingClient({
			placeOrder: mock(() =>
				Promise.reject(
					new Error("invalid amount for a marketable BUY order ($0.31), min size: $50"),
				),
			),
		});
		const factory = mockBettingClientFactory(client);

		const bettingService = createBettingService({
			bettingClientFactory: factory,
			betsRepo: betsRepo,
			auditLog,
			bettingEventsRepo: mockBettingEventsRepo(),
			config: makeConfig(),
		});

		await bettingService.placeBet({
			prediction: testPrediction,
			resolvedStake: 0.31,
			market: testMarket,
			fixtureId: 1001,
			competitorId: "comp-a",
			walletConfig: {
				polyPrivateKey: "0xkey",
				polyApiKey: "api",
				polyApiSecret: "secret",
				polyApiPassphrase: "pass",
			},
		});

		// Retry with maxStakePerBet: 10
		const retryService = createBetRetryService({
			betsRepo: betsRepo,
			bettingClientFactory: factory,
			auditLog,
			predictionsRepo: predsRepo,
			walletConfigs: makeWalletConfigs(),
			maxRetryAttempts: 3,
			maxStakePerBet: 10,
			bankrollProvider: { getBankroll: mock(() => Promise.resolve(100)) },
			maxBumpPctOfBankroll: 0.2,
			proxyEnabled: false,
		});

		const retryResult = await retryService.retryFailedBets();

		expect(retryResult.retried).toBe(0);
		expect(retryResult.errors).toHaveLength(1);
		expect(retryResult.errors[0]).toContain("min size $50 exceeds cap");
		expect(predsRepo.addStakeAdjustment).not.toHaveBeenCalled();
		expect(storedBets[0]!.status).toBe("failed");
	});

	it("guard: min size unparseable → retries with original amount", async () => {
		const storedBets: BetRow[] = [];
		const auditLog = mockAuditLog();
		const predsRepo = mockPredictionsRepo();

		const betsRepo = {
			create: mock(() => Promise.resolve()),
			createIfNoActiveBet: mock((bet: BetRow) => {
				storedBets.push({ ...bet, placedAt: new Date(), settledAt: null, profit: null });
				return Promise.resolve("created" as const);
			}),
			hasActiveBetForMarket: mock(() => Promise.resolve(false)),
			findById: mock((id: string) =>
				Promise.resolve(storedBets.find((b) => b.id === id)),
			),
			findByCompetitor: mock(() => Promise.resolve(storedBets)),
			findByStatus: mock(() => Promise.resolve([])),
			updateStatus: mock((id: string, status: string) => {
				const bet = storedBets.find((b) => b.id === id);
				if (bet) bet.status = status;
				return Promise.resolve();
			}),
			updateBetAfterSubmission: mock(
				(id: string, update: { status: string; errorMessage?: string; errorCategory?: string; attempts?: number }) => {
					const bet = storedBets.find((b) => b.id === id);
					if (bet) {
						bet.status = update.status;
						if (update.errorMessage) bet.errorMessage = update.errorMessage;
						if (update.errorCategory) bet.errorCategory = update.errorCategory;
						if (update.attempts !== undefined) bet.attempts = update.attempts;
					}
					return Promise.resolve();
				},
			),
			updateAmount: mock(() => Promise.resolve()),
			findRetryableBets: mock(() =>
				Promise.resolve(storedBets.filter((b) => b.status === "failed").map((b) => ({ ...b }))),
			),
			findAll: mock(() => Promise.resolve(storedBets)),
			findRecent: mock(() => Promise.resolve([])),
			getPerformanceStats: mock(() =>
				Promise.resolve({
					competitorId: "",
					totalBets: 0,
					wins: 0,
					losses: 0,
					pending: 0,
					failed: 0,
					lockedAmount: 0,
					totalStaked: 0,
					totalReturned: 0,
					profitLoss: 0,
					accuracy: 0,
					roi: 0,
				}),
			),
		} as unknown as BetsRepo;

		// Place bet - client rejects with unparseable error
		let callCount = 0;
		const client = mockBettingClient({
			placeOrder: mock(() => {
				callCount++;
				if (callCount === 1) {
					return Promise.reject(new Error("order size is too small"));
				}
				return Promise.resolve({ orderId: "order-retry-ok" });
			}),
		});
		const factory = mockBettingClientFactory(client);

		const bettingService = createBettingService({
			bettingClientFactory: factory,
			betsRepo: betsRepo,
			auditLog,
			bettingEventsRepo: mockBettingEventsRepo(),
			config: makeConfig(),
		});

		await bettingService.placeBet({
			prediction: testPrediction,
			resolvedStake: 0.31,
			market: testMarket,
			fixtureId: 1001,
			competitorId: "comp-a",
			walletConfig: {
				polyPrivateKey: "0xkey",
				polyApiKey: "api",
				polyApiSecret: "secret",
				polyApiPassphrase: "pass",
			},
		});

		const retryService = createBetRetryService({
			betsRepo: betsRepo,
			bettingClientFactory: factory,
			auditLog,
			predictionsRepo: predsRepo,
			walletConfigs: makeWalletConfigs(),
			maxRetryAttempts: 3,
			maxStakePerBet: 10,
			bankrollProvider: { getBankroll: mock(() => Promise.resolve(100)) },
			maxBumpPctOfBankroll: 0.2,
			proxyEnabled: false,
		});

		const retryResult = await retryService.retryFailedBets();

		expect(retryResult.succeeded).toBe(1);
		// placeOrder called with original amount (no bump)
		const lastCall = (client.placeOrder as ReturnType<typeof mock>).mock.calls.at(-1)![0] as {
			amount: number;
		};
		expect(lastCall.amount).toBe(0.31);
		expect(predsRepo.addStakeAdjustment).not.toHaveBeenCalled();
	});

	it("second failure with new min size → bumps again on next retry", async () => {
		const storedBets: BetRow[] = [];
		const auditLog = mockAuditLog();
		const predsRepo = mockPredictionsRepo();

		const betsRepo = {
			create: mock(() => Promise.resolve()),
			createIfNoActiveBet: mock((bet: BetRow) => {
				storedBets.push({ ...bet, placedAt: new Date(), settledAt: null, profit: null });
				return Promise.resolve("created" as const);
			}),
			hasActiveBetForMarket: mock(() => Promise.resolve(false)),
			findById: mock((id: string) =>
				Promise.resolve(storedBets.find((b) => b.id === id)),
			),
			findByCompetitor: mock(() => Promise.resolve(storedBets)),
			findByStatus: mock(() => Promise.resolve([])),
			updateStatus: mock((id: string, status: string) => {
				const bet = storedBets.find((b) => b.id === id);
				if (bet) bet.status = status;
				return Promise.resolve();
			}),
			updateBetAfterSubmission: mock(
				(id: string, update: { status: string; orderId?: string; errorMessage?: string; errorCategory?: string; attempts?: number }) => {
					const bet = storedBets.find((b) => b.id === id);
					if (bet) {
						bet.status = update.status;
						if (update.orderId) bet.orderId = update.orderId;
						if (update.errorMessage) bet.errorMessage = update.errorMessage;
						if (update.errorCategory) bet.errorCategory = update.errorCategory;
						if (update.attempts !== undefined) bet.attempts = update.attempts;
					}
					return Promise.resolve();
				},
			),
			updateAmount: mock((id: string, newAmount: number) => {
				const bet = storedBets.find((b) => b.id === id);
				if (bet) {
					bet.amount = newAmount;
					bet.shares = newAmount / bet.price;
				}
				return Promise.resolve();
			}),
			findRetryableBets: mock(() =>
				Promise.resolve(storedBets.filter((b) => b.status === "failed").map((b) => ({ ...b }))),
			),
			findAll: mock(() => Promise.resolve(storedBets)),
			findRecent: mock(() => Promise.resolve([])),
			getPerformanceStats: mock(() =>
				Promise.resolve({
					competitorId: "",
					totalBets: 0,
					wins: 0,
					losses: 0,
					pending: 0,
					failed: 0,
					lockedAmount: 0,
					totalStaked: 0,
					totalReturned: 0,
					profitLoss: 0,
					accuracy: 0,
					roi: 0,
				}),
			),
		} as unknown as BetsRepo;

		// Step 1: Initial failure with min size $1
		let callCount = 0;
		const client = mockBettingClient({
			placeOrder: mock(() => {
				callCount++;
				if (callCount === 1) {
					return Promise.reject(
						new Error("invalid amount for a marketable BUY order ($0.31), min size: $1"),
					);
				}
				if (callCount === 2) {
					return Promise.reject(
						new Error("invalid amount for a marketable BUY order ($1.00), min size: $2"),
					);
				}
				return Promise.resolve({ orderId: "order-final" });
			}),
		});
		const factory = mockBettingClientFactory(client);

		const bettingService = createBettingService({
			bettingClientFactory: factory,
			betsRepo: betsRepo,
			auditLog,
			bettingEventsRepo: mockBettingEventsRepo(),
			config: makeConfig(),
		});

		await bettingService.placeBet({
			prediction: testPrediction,
			resolvedStake: 0.31,
			market: testMarket,
			fixtureId: 1001,
			competitorId: "comp-a",
			walletConfig: {
				polyPrivateKey: "0xkey",
				polyApiKey: "api",
				polyApiSecret: "secret",
				polyApiPassphrase: "pass",
			},
		});

		expect(storedBets[0]!.amount).toBe(0.31);

		const retryService = createBetRetryService({
			betsRepo: betsRepo,
			bettingClientFactory: factory,
			auditLog,
			predictionsRepo: predsRepo,
			walletConfigs: makeWalletConfigs(),
			maxRetryAttempts: 5,
			maxStakePerBet: 10,
			bankrollProvider: { getBankroll: mock(() => Promise.resolve(100)) },
			maxBumpPctOfBankroll: 0.2,
			proxyEnabled: false,
		});

		// First retry: bumps to $1, but fails again with min size $2
		const retry1 = await retryService.retryFailedBets();
		expect(retry1.failedAgain).toBe(1);
		expect(storedBets[0]!.amount).toBe(1);

		// Second retry: bumps to $2 and succeeds
		const retry2 = await retryService.retryFailedBets();
		expect(retry2.succeeded).toBe(1);
		expect(storedBets[0]!.amount).toBe(2);

		const lastCall = (client.placeOrder as ReturnType<typeof mock>).mock.calls.at(-1)![0] as {
			amount: number;
		};
		expect(lastCall.amount).toBe(2);
	});
});
