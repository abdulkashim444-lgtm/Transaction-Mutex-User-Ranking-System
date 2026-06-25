import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

const app = express();
const PORT = 3000;

// Enable JSON body parsing
app.use(express.json());

// Type Definitions
interface User {
  id: string;
  name: string;
  balance: number;
  createdAt: number;
}

interface Transaction {
  id: string;
  userId: string;
  type: "CREDIT" | "DEBIT";
  amount: number;
  status: "SUCCESS" | "FAILED";
  reason?: string;
  timestamp: number;
  idempotencyKey: string;
}

interface ServerLog {
  id: string;
  timestamp: number;
  message: string;
  type: "info" | "warn" | "error" | "success";
}

// In-Memory Database State
let users: Map<string, User> = new Map();
let transactions: Transaction[] = [];
let idempotencyStore: Map<string, { status: number; body: any }> = new Map();
let serverLogs: ServerLog[] = [];

// Helper function to append server logs
function addLog(message: string, type: "info" | "warn" | "error" | "success" = "info") {
  const log: ServerLog = {
    id: Math.random().toString(36).substring(2, 9),
    timestamp: Date.now(),
    message,
    type,
  };
  serverLogs.push(log);
  // Cap logs at 100 to prevent memory growth
  if (serverLogs.length > 100) {
    serverLogs.shift();
  }
  console.log(`[${type.toUpperCase()}] ${message}`);
}

// Seed Initial Data
function seedDatabase() {
  users.clear();
  transactions = [];
  idempotencyStore.clear();
  serverLogs = [];

  addLog("Initializing database with demo user records...", "info");

  const initialUsers: User[] = [
    { id: "user_1", name: "Alice Vance", balance: 500.00, createdAt: Date.now() - 86400000 * 5 },
    { id: "user_2", name: "Bob Carter", balance: 1500.00, createdAt: Date.now() - 86400000 * 4 },
    { id: "user_3", name: "Charlie Day", balance: 50.00, createdAt: Date.now() - 86400000 * 3 },
    { id: "user_4", name: "Diana Prince", balance: 3000.00, createdAt: Date.now() - 86400000 * 2 },
  ];

  initialUsers.forEach(u => users.set(u.id, u));

  // Seed some historic transactions to populate rankings immediately
  const seedTransactions: Transaction[] = [
    {
      id: "tx_seed_1",
      userId: "user_1",
      type: "CREDIT",
      amount: 150.00,
      status: "SUCCESS",
      timestamp: Date.now() - 3600000 * 4,
      idempotencyKey: "seed_key_1"
    },
    {
      id: "tx_seed_2",
      userId: "user_1",
      type: "DEBIT",
      amount: 50.00,
      status: "SUCCESS",
      timestamp: Date.now() - 3600000 * 3,
      idempotencyKey: "seed_key_2"
    },
    {
      id: "tx_seed_3",
      userId: "user_2",
      type: "CREDIT",
      amount: 500.00,
      status: "SUCCESS",
      timestamp: Date.now() - 3600000 * 2,
      idempotencyKey: "seed_key_3"
    },
    {
      id: "tx_seed_4",
      userId: "user_3",
      type: "CREDIT",
      amount: 10.00,
      status: "SUCCESS",
      timestamp: Date.now() - 3600000 * 1,
      idempotencyKey: "seed_key_4"
    }
  ];

  transactions.push(...seedTransactions);
  addLog("Database seeded successfully.", "success");
}

// Run seed initially
seedDatabase();

// Concurrency Locks: Per-user mutex mechanism
// In Node.js, we don't have multi-threaded memory access issues because of the single-threaded event loop.
// However, async/await introduces interleaving. If we check balance, await an external API/DB operation,
// and then deduct, multiple simultaneous requests can slip in between the check and the deduct.
// This is a classic race condition (e.g., double-spend vulnerability).
const userLocks: Map<string, boolean> = new Map();

async function acquireLock(userId: string, timeoutMs: number = 3000): Promise<boolean> {
  const start = Date.now();
  while (userLocks.get(userId)) {
    if (Date.now() - start > timeoutMs) {
      return false; // Failed to acquire lock in time
    }
    await new Promise(resolve => setTimeout(resolve, 10)); // Yield to event loop
  }
  userLocks.set(userId, true);
  return true;
}

function releaseLock(userId: string) {
  userLocks.delete(userId);
}

// ---------------------------------------------------------------------------
// REST APIs
// ---------------------------------------------------------------------------

// 1. GET /api/setup/users - Admin helper to list users
app.get("/api/setup/users", (req, res) => {
  res.json(Array.from(users.values()));
});

// 2. POST /api/setup/user - Create a user
app.post("/api/setup/user", (req, res) => {
  const { name, balance } = req.body;
  if (!name || typeof name !== "string" || name.trim() === "") {
    return res.status(400).json({ error: "Invalid user name." });
  }
  const initialBalance = parseFloat(balance);
  if (isNaN(initialBalance) || initialBalance < 0) {
    return res.status(400).json({ error: "Initial balance must be a non-negative number." });
  }

  const userId = `user_${Math.random().toString(36).substring(2, 9)}`;
  const newUser: User = {
    id: userId,
    name: name.trim(),
    balance: initialBalance,
    createdAt: Date.now()
  };
  users.set(userId, newUser);
  addLog(`Created new user: ${newUser.name} with balance $${newUser.balance.toFixed(2)}`, "success");
  res.status(201).json(newUser);
});

// 3. POST /api/setup/reset - Reset state to clean data
app.post("/api/setup/reset", (req, res) => {
  seedDatabase();
  res.json({ message: "System state has been reset successfully." });
});

// 4. GET /api/logs - Fetch recent backend operations logs
app.get("/api/logs", (req, res) => {
  res.json(serverLogs);
});

// 5. POST /api/transaction - Process a transaction with validation, idempotency, and concurrency controls
app.post("/api/transaction", async (req, res) => {
  const { userId, type, amount, idempotencyKey, simulateDelay, disableLocking } = req.body;

  addLog(`Received transaction request: User: ${userId}, Type: ${type}, Amount: ${amount}, Key: ${idempotencyKey || "none"}`, "info");

  // 1. Request Body Validation
  if (!userId || typeof userId !== "string") {
    addLog("Transaction failed: Missing or invalid user ID.", "warn");
    return res.status(400).json({ error: "Missing or invalid userId." });
  }

  if (type !== "CREDIT" && type !== "DEBIT") {
    addLog(`Transaction failed: Invalid type [${type}]. Must be CREDIT or DEBIT.`, "warn");
    return res.status(400).json({ error: "Type must be either CREDIT or DEBIT." });
  }

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    addLog(`Transaction failed: Invalid amount [${amount}]. Must be greater than 0.`, "warn");
    return res.status(400).json({ error: "Amount must be a positive number greater than 0." });
  }

  if (!idempotencyKey || typeof idempotencyKey !== "string" || idempotencyKey.trim() === "") {
    addLog("Transaction failed: Missing idempotency key.", "warn");
    return res.status(400).json({ error: "An idempotency key is required to prevent double-spending." });
  }

  // 2. Idempotency Key Validation (Prevent Duplicate Processing)
  if (idempotencyStore.has(idempotencyKey)) {
    const cachedResponse = idempotencyStore.get(idempotencyKey)!;
    addLog(`Idempotency HIT for key [${idempotencyKey}]. Returning cached result.`, "success");
    res.setHeader("X-Cache-Lookup", "HIT");
    return res.status(cachedResponse.status).json({ ...cachedResponse.body, cached: true });
  }

  // 3. Check if User Exists
  const user = users.get(userId);
  if (!user) {
    const errorResponse = { error: `User with ID "${userId}" does not exist.` };
    idempotencyStore.set(idempotencyKey, { status: 404, body: errorResponse });
    addLog(`Transaction failed: User "${userId}" not found.`, "warn");
    return res.status(404).json(errorResponse);
  }

  // 4. Concurrency Guard / Locking Protection
  const useLocking = !disableLocking;
  if (useLocking) {
    addLog(`Acquiring concurrency lock for user [${userId}]...`, "info");
    const lockAcquired = await acquireLock(userId, 4000); // 4s timeout
    if (!lockAcquired) {
      addLog(`Failed to acquire lock for user [${userId}] (timeout). Conflicting requests detected.`, "error");
      return res.status(409).json({ error: "Server busy: A conflicting transaction is already processing for this user. Please retry." });
    }
    addLog(`Lock acquired successfully for user [${userId}].`, "info");
  } else {
    addLog(`WARNING: Concurrency locking is DISABLED for this request.`, "warn");
  }

  try {
    // Re-fetch user to make sure we have the absolute latest state after lock acquisition
    const activeUser = users.get(userId)!;

    // Simulate Async/DB Processing Latency if requested (critical for demonstrating race conditions)
    if (simulateDelay) {
      const delayMs = parseInt(simulateDelay) || 200;
      addLog(`Simulating async DB operation delay of ${delayMs}ms...`, "info");
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    // 5. Balance Validation (Debits require sufficient funds)
    if (type === "DEBIT" && activeUser.balance < parsedAmount) {
      const failedTx: Transaction = {
        id: `tx_${Math.random().toString(36).substring(2, 9)}`,
        userId,
        type,
        amount: parsedAmount,
        status: "FAILED",
        reason: "Insufficient funds in account balance.",
        timestamp: Date.now(),
        idempotencyKey
      };
      transactions.push(failedTx);
      const errorResponse = {
        error: "Insufficient funds in account balance.",
        transaction: failedTx,
        currentBalance: activeUser.balance
      };
      idempotencyStore.set(idempotencyKey, { status: 422, body: errorResponse });
      addLog(`Transaction failed: Insufficient funds for user [${activeUser.name}]. Balance: $${activeUser.balance.toFixed(2)}, Request: $${parsedAmount.toFixed(2)}`, "warn");
      return res.status(422).json(errorResponse);
    }

    // 6. Consistent Data Updates (Atomically apply balance change)
    const originalBalance = activeUser.balance;
    const newBalance = type === "CREDIT" ? originalBalance + parsedAmount : originalBalance - parsedAmount;
    activeUser.balance = Math.round(newBalance * 100) / 100; // Round to 2 decimals

    const successfulTx: Transaction = {
      id: `tx_${Math.random().toString(36).substring(2, 9)}`,
      userId,
      type,
      amount: parsedAmount,
      status: "SUCCESS",
      timestamp: Date.now(),
      idempotencyKey
    };

    transactions.push(successfulTx);
    users.set(userId, activeUser); // Persist updated user state

    const successResponse = {
      message: "Transaction processed successfully.",
      transaction: successfulTx,
      previousBalance: originalBalance,
      newBalance: activeUser.balance,
      cached: false
    };

    // Save output in idempotency cache
    idempotencyStore.set(idempotencyKey, { status: 200, body: successResponse });

    addLog(`Transaction completed: User [${activeUser.name}] balance updated from $${originalBalance.toFixed(2)} to $${activeUser.balance.toFixed(2)} (${type} of $${parsedAmount.toFixed(2)})`, "success");
    return res.status(200).json(successResponse);

  } catch (err: any) {
    addLog(`Fatal error during transaction processing: ${err.message}`, "error");
    return res.status(500).json({ error: "Internal transaction error." });
  } finally {
    if (useLocking) {
      releaseLock(userId);
      addLog(`Released concurrency lock for user [${userId}].`, "info");
    }
  }
});

// 6. GET /api/summary/:userId - Fetch user metrics and transaction history
app.get("/api/summary/:userId", (req, res) => {
  const { userId } = req.params;
  const user = users.get(userId);

  if (!user) {
    return res.status(404).json({ error: `User with ID "${userId}" does not exist.` });
  }

  const userTransactions = transactions.filter(t => t.userId === userId);
  const successfulTx = userTransactions.filter(t => t.status === "SUCCESS");
  const failedTx = userTransactions.filter(t => t.status === "FAILED");

  const totalCreditVolume = successfulTx
    .filter(t => t.type === "CREDIT")
    .reduce((sum, t) => sum + t.amount, 0);

  const totalDebitVolume = successfulTx
    .filter(t => t.type === "DEBIT")
    .reduce((sum, t) => sum + t.amount, 0);

  res.json({
    user: {
      id: user.id,
      name: user.name,
      balance: user.balance,
      createdAt: user.createdAt
    },
    metrics: {
      totalTransactions: userTransactions.length,
      successfulCount: successfulTx.length,
      failedCount: failedTx.length,
      totalCreditVolume: Math.round(totalCreditVolume * 100) / 100,
      totalDebitVolume: Math.round(totalDebitVolume * 100) / 100,
    },
    history: userTransactions.sort((a, b) => b.timestamp - a.timestamp) // Newest first
  });
});

// 7. GET /api/ranking - User ranking with multi-factor formula & anti-manipulation policies
app.get("/api/ranking", (req, res) => {
  // We calculate a score for each user based on multiple parameters:
  // 1. Core volume contribution (Sum of successful transactions)
  // 2. High quality activity factor (Average successful transaction value)
  // 3. User engagement factor (Count of successful transactions)
  //
  // Anti-Abuse / Velocity Limits to protect ranking:
  // If a user commits more than 5 transactions in the last 60 seconds (rapid manipulation),
  // they trigger a "High Velocity Alert" flag, and we apply an active penalty (50% score reduction)
  // to enforce fair ranking standards.

  const oneMinuteAgo = Date.now() - 60000;

  const rankings = Array.from(users.values()).map(user => {
    const userTx = transactions.filter(t => t.userId === user.id && t.status === "SUCCESS");
    
    // Factor 1: Volume
    const totalVolume = userTx.reduce((sum, t) => sum + t.amount, 0);
    
    // Factor 2: Activity Count
    const transactionCount = userTx.length;
    
    // Factor 3: Quality (Average Transaction Value)
    const averageTxValue = transactionCount > 0 ? totalVolume / transactionCount : 0;

    // Detect Abuse/Velocity: count successful transactions in the last 60 seconds
    const rapidTxInLastMinute = userTx.filter(t => t.timestamp > oneMinuteAgo).length;
    const isSpamming = rapidTxInLastMinute > 4; // Penalty applies if > 4 transactions/min

    // Multi-factor base score calculation:
    // Volume contributes 50%, Average size contributes 30%, Frequency contributes 20%
    const baseScore = (totalVolume * 0.5) + (averageTxValue * 0.3) + (transactionCount * 2.0);

    // Apply Spam Mitigation Discount
    const penaltyApplied = isSpamming;
    const penaltyFactor = penaltyApplied ? 0.4 : 1.0; // 60% penalty
    const finalScore = baseScore * penaltyFactor;

    return {
      userId: user.id,
      name: user.name,
      balance: user.balance,
      metrics: {
        totalVolume: Math.round(totalVolume * 100) / 100,
        transactionCount,
        averageTxValue: Math.round(averageTxValue * 100) / 100,
        recentVelocity: rapidTxInLastMinute
      },
      rules: {
        isSpamming,
        penaltyApplied,
        scoreCalculation: `(Volume * 0.5) + (AverageValue * 0.3) + (Count * 2) = ${baseScore.toFixed(2)} ${penaltyApplied ? 'x 0.4 (Spam Penalty)' : ''}`
      },
      baseScore: Math.round(baseScore * 100) / 100,
      score: Math.round(finalScore * 100) / 100
    };
  });

  // Sort by score in descending order
  rankings.sort((a, b) => b.score - a.score);

  // Append rank numbers
  const rankedData = rankings.map((item, index) => ({
    rank: index + 1,
    ...item
  }));

  res.json({
    rankings: rankedData,
    formula: {
      baseFormula: "Score = (Volume * 0.5) + (AverageAmount * 0.3) + (ActivityCount * 2.0)",
      antiAbuseRule: "Velocity > 4 transactions per minute triggers Spam Warning, applying a 60% score penalty multiplier."
    }
  });
});

// ---------------------------------------------------------------------------
// Vite / Production Build setup
// ---------------------------------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    addLog("Starting development server with Vite middleware...", "info");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    addLog("Starting production server...", "info");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    addLog(`Transaction & Ranking Service listening at http://localhost:${PORT}`, "success");
  });
}

startServer().catch((err) => {
  console.error("Failed to start server", err);
});
