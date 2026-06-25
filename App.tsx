import React, { useState, useEffect } from "react";
import { 
  RefreshCw, 
  UserPlus, 
  RotateCcw, 
  Coins, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle, 
  Terminal, 
  TrendingUp, 
  Activity, 
  Lock, 
  Unlock, 
  User, 
  DollarSign, 
  ShieldAlert,
  ArrowUpRight,
  ArrowDownLeft,
  ChevronRight
} from "lucide-react";

interface UserProfile {
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

interface UserSummary {
  user: UserProfile;
  metrics: {
    totalTransactions: number;
    successfulCount: number;
    failedCount: number;
    totalCreditVolume: number;
    totalDebitVolume: number;
  };
  history: Transaction[];
}

interface RankingItem {
  rank: number;
  userId: string;
  name: string;
  balance: number;
  metrics: {
    totalVolume: number;
    transactionCount: number;
    averageTxValue: number;
    recentVelocity: number;
  };
  rules: {
    isSpamming: boolean;
    penaltyApplied: boolean;
    scoreCalculation: string;
  };
  baseScore: number;
  score: number;
}

interface ServerLog {
  id: string;
  timestamp: number;
  message: string;
  type: "info" | "warn" | "error" | "success";
}

export default function App() {
  // State
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [summary, setSummary] = useState<UserSummary | null>(null);
  const [rankings, setRankings] = useState<RankingItem[]>([]);
  const [logs, setLogs] = useState<ServerLog[]>([]);
  
  // Transaction Form State
  const [txType, setTxType] = useState<"CREDIT" | "DEBIT">("DEBIT");
  const [txAmount, setTxAmount] = useState<string>("100.00");
  const [idempotencyKey, setIdempotencyKey] = useState<string>("");
  const [simulateDelay, setSimulateDelay] = useState<boolean>(true);
  const [delayMs, setDelayMs] = useState<number>(500);
  const [disableLocking, setDisableLocking] = useState<boolean>(false);

  // New User Form State
  const [newUserName, setNewUserName] = useState<string>("");
  const [newUserBalance, setNewUserBalance] = useState<string>("1000.00");
  const [showAddUserModal, setShowAddUserModal] = useState<boolean>(false);

  // Status message
  const [submitStatus, setSubmitStatus] = useState<{ type: "success" | "error" | "info" | null; message: string }>({ type: null, message: "" });
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Load all initial data
  useEffect(() => {
    fetchUsers();
    fetchRankings();
    fetchLogs();
    generateNewIdempotencyKey();

    // Setup polling for dynamic ranking updates, logs and active user stats
    const interval = setInterval(() => {
      fetchRankings();
      fetchLogs();
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  // Sync selected user summary when userId changes
  useEffect(() => {
    if (selectedUserId) {
      fetchUserSummary(selectedUserId);
    } else {
      setSummary(null);
    }
  }, [selectedUserId]);

  const generateNewIdempotencyKey = () => {
    const key = `key_${Math.random().toString(36).substring(2, 10)}_${Date.now().toString().slice(-4)}`;
    setIdempotencyKey(key);
  };

  const fetchUsers = async () => {
    try {
      const res = await fetch("/api/setup/users");
      const data = await res.json();
      setUsers(data);
      if (data.length > 0 && !selectedUserId) {
        setSelectedUserId(data[0].id);
      }
    } catch (err) {
      console.error("Failed to fetch users", err);
    }
  };

  const fetchUserSummary = async (userId: string) => {
    try {
      const res = await fetch(`/api/summary/${userId}`);
      if (res.ok) {
        const data = await res.json();
        setSummary(data);
      }
    } catch (err) {
      console.error("Failed to fetch summary", err);
    }
  };

  const fetchRankings = async () => {
    try {
      const res = await fetch("/api/ranking");
      if (res.ok) {
        const data = await res.json();
        setRankings(data.rankings);
      }
    } catch (err) {
      console.error("Failed to fetch rankings", err);
    }
  };

  const fetchLogs = async () => {
    try {
      const res = await fetch("/api/logs");
      if (res.ok) {
        const data = await res.json();
        // Newest logs first for UI visualization
        setLogs(data.reverse());
      }
    } catch (err) {
      console.error("Failed to fetch logs", err);
    }
  };

  // Submit standard transaction
  const handleExecuteTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId) return;
    setIsSubmitting(true);
    setSubmitStatus({ type: "info", message: "Sending transaction..." });

    try {
      const response = await fetch("/api/transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: selectedUserId,
          type: txType,
          amount: parseFloat(txAmount),
          idempotencyKey,
          simulateDelay: simulateDelay ? delayMs : 0,
          disableLocking
        })
      });

      const data = await response.json();

      if (response.ok) {
        const cacheHit = data.cached;
        setSubmitStatus({
          type: "success",
          message: cacheHit 
            ? `Idempotency HIT! Avoided duplicate processing. Returned cached output.` 
            : `Transaction executed successfully! New Balance: $${data.newBalance.toFixed(2)}`
        });
        
        // Refresh systems
        fetchUserSummary(selectedUserId);
        fetchRankings();
        fetchLogs();
        fetchUsers(); // updates selection drop down balances

        // If it was a success and not cached, automatically roll a new idempotency key
        if (!cacheHit) {
          generateNewIdempotencyKey();
        }
      } else {
        setSubmitStatus({
          type: "error",
          message: data.error || "An error occurred."
        });
        fetchUserSummary(selectedUserId);
        fetchLogs();
      }
    } catch (err: any) {
      setSubmitStatus({ type: "error", message: err.message || "Failed to contact backend." });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Concurrent Transaction Hammer
  // This fires multiple requests simultaneously with the SAME or DIFFERENT keys to show both:
  // - Idempotency prevention (same key)
  // - Double-spending protection under async race conditions (different keys, concurrent execution)
  const handleSimulateConcurrency = async (sameKey: boolean) => {
    if (!selectedUserId || !summary) return;
    setIsSubmitting(true);
    setSubmitStatus({ type: "info", message: `Blasting 4 simultaneous DEBITS of $50.00...` });

    // Ensure we are debiting a reasonable amount
    const amountToDebit = 50.00;
    const currentBal = summary.user.balance;

    // We trigger 4 operations in parallel
    const requests = Array.from({ length: 4 }).map((_, index) => {
      // If sameKey is true, we pass the exact same key to trigger the idempotency gate.
      // If sameKey is false, we pass unique keys to trigger concurrent updates (checking double spending).
      const key = sameKey ? idempotencyKey : `concurrent_${index}_${Math.random().toString(36).substring(2, 7)}`;
      
      return fetch("/api/transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: selectedUserId,
          type: "DEBIT",
          amount: amountToDebit,
          idempotencyKey: key,
          simulateDelay: 400, // Important delay to ensure they interleave in event loop
          disableLocking
        })
      });
    });

    try {
      const results = await Promise.all(requests);
      const responsesData = await Promise.all(results.map(r => r.json()));

      // Count successes vs failures
      let successes = 0;
      let blockedByLock = 0;
      let insufficientFunds = 0;
      let idempotencyHits = 0;

      responsesData.forEach((data, i) => {
        const status = results[i].status;
        if (status === 200) {
          if (data.cached) idempotencyHits++;
          else successes++;
        } else if (status === 409) {
          blockedByLock++;
        } else if (status === 422) {
          insufficientFunds++;
        }
      });

      // Update state
      fetchUserSummary(selectedUserId);
      fetchRankings();
      fetchLogs();
      fetchUsers();

      if (sameKey) {
        setSubmitStatus({
          type: "success",
          message: `Concurrency Test Finished! (Idempotent Mode) -> 1 Success, ${idempotencyHits} Cached Hits prevented duplicated debits!`
        });
      } else {
        let outcomeMsg = `Concurrency Test Finished! -> ${successes} successful debits, ${blockedByLock} blocked/timed-out by mutex, ${insufficientFunds} failed by insufficient funds.`;
        
        // Let's analyze if balance went negative (meaning concurrency vulnerability was exposed!)
        setTimeout(async () => {
          const checkRes = await fetch(`/api/summary/${selectedUserId}`);
          const checkData = await checkRes.json();
          if (checkData.user.balance < 0) {
            setSubmitStatus({
              type: "error",
              message: `⚠️ RACE CONDITION EXPOSED! User balance is now $${checkData.user.balance}! Because Mutex locks were disabled, parallel balance checks allowed double-spending past limit!`
            });
          } else {
            setSubmitStatus({
              type: "success",
              message: outcomeMsg + ` Consistent state maintained successfully.`
            });
          }
        }, 300);
      }

      // Generate clean key for next normal transaction
      generateNewIdempotencyKey();

    } catch (err: any) {
      setSubmitStatus({ type: "error", message: "Concurrent test execution failed: " + err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Add User
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName.trim()) return;

    try {
      const res = await fetch("/api/setup/user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newUserName,
          balance: parseFloat(newUserBalance)
        })
      });

      if (res.ok) {
        const newUser = await res.json();
        setUsers(prev => [...prev, newUser]);
        setSelectedUserId(newUser.id);
        setNewUserName("");
        setShowAddUserModal(false);
        setSubmitStatus({ type: "success", message: `User "${newUser.name}" added successfully.` });
        fetchRankings();
        fetchLogs();
      } else {
        const err = await res.json();
        alert(err.error || "Failed to create user.");
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Reset Server DB
  const handleResetSystem = async () => {
    if (!window.confirm("Are you sure you want to reset the system state to seeded defaults? All custom transactions will be cleared.")) {
      return;
    }
    try {
      const res = await fetch("/api/setup/reset", { method: "POST" });
      if (res.ok) {
        setSubmitStatus({ type: "success", message: "System database successfully re-seeded to default profiles." });
        await fetchUsers();
        if (users.length > 0) {
          setSelectedUserId(users[0].id);
        }
        await fetchRankings();
        await fetchLogs();
        generateNewIdempotencyKey();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const selectedUserObj = users.find(u => u.id === selectedUserId);

  return (
    <div id="elegant_dark_container" className="min-h-screen bg-[#0a0a0b] text-[#e2e8f0] flex flex-col font-sans selection:bg-emerald-500/30 selection:text-emerald-200">
      
      {/* HEADER SECTION */}
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-6 py-4 border-b border-[#1e1e24] bg-[#0c0c0e] sticky top-0 z-10 gap-4">
        <div className="flex items-center gap-3">
          <div className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 shadow-[0_0_10px_#10b981]"></span>
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-wide text-slate-100 flex items-center gap-2">
              System Node: <span className="font-mono text-emerald-400 text-sm">TXN_GATEWAY_v1.2</span>
            </h1>
            <p className="text-[11px] text-slate-500">Atomic Mutex, Idempotency and Anti-Abuse Leaderboard Demo</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 sm:gap-6 text-[11px] font-mono uppercase text-slate-400">
          <div className="flex flex-col items-start sm:items-end">
            <span className="text-[9px] text-slate-600 font-semibold tracking-wider">Service Status</span>
            <span className="text-emerald-400 font-bold flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 bg-emerald-400 rounded-full"></span> OPERATIONAL
            </span>
          </div>
          <div className="flex flex-col items-start sm:items-end border-l border-[#1e1e24] pl-4 sm:pl-6">
            <span className="text-[9px] text-slate-600 font-semibold tracking-wider">Dynamic Locking</span>
            <span className={disableLocking ? "text-rose-400 font-bold" : "text-emerald-400 font-bold"}>
              {disableLocking ? "OFF (UNSAFE)" : "ON (PROTECTED)"}
            </span>
          </div>
          <div className="flex flex-col items-start sm:items-end border-l border-[#1e1e24] pl-4 sm:pl-6">
            <span className="text-[9px] text-slate-600 font-semibold tracking-wider">In-Memory Sync</span>
            <span className="text-blue-400 font-bold">READY</span>
          </div>
          
          <button 
            id="btn_reset_db"
            onClick={handleResetSystem}
            title="Reset DB State" 
            className="ml-2 flex items-center gap-1 px-2.5 py-1.5 bg-slate-800/60 border border-slate-700/50 text-slate-300 rounded hover:bg-slate-700/80 transition-colors text-xs hover:text-white"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset State
          </button>
        </div>
      </header>

      {/* SYSTEM STATUS ALERTS */}
      {submitStatus.message && (
        <div id="status_toast" className={`mx-6 mt-4 p-3.5 rounded-lg border flex items-start gap-3 text-xs animate-fadeIn ${
          submitStatus.type === "success" 
            ? "bg-emerald-950/40 border-emerald-500/20 text-emerald-300" 
            : submitStatus.type === "error" 
            ? "bg-rose-950/40 border-rose-500/20 text-rose-300"
            : "bg-slate-900 border-slate-800 text-slate-300"
        }`}>
          {submitStatus.type === "success" && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />}
          {submitStatus.type === "error" && <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />}
          {submitStatus.type === "info" && <Activity className="w-4 h-4 text-blue-400 shrink-0 mt-0.5 animate-spin" />}
          
          <div className="flex-1">
            <p className="font-medium">{submitStatus.type === "success" ? "Operation Successful" : submitStatus.type === "error" ? "System Notification / Error" : "Processing Transaction"}</p>
            <p className="mt-0.5 text-slate-400 leading-relaxed font-mono text-[11px]">{submitStatus.message}</p>
          </div>
          
          <button onClick={() => setSubmitStatus({ type: null, message: "" })} className="text-slate-500 hover:text-slate-300 text-sm font-semibold">×</button>
        </div>
      )}

      {/* MAIN CONTAINER */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-px bg-[#18181c]">
        
        {/* PANEL 1: TRANSACTION ENTRY (3 cols) */}
        <section id="panel_transaction_entry" className="lg:col-span-4 bg-[#0c0c0e] p-6 flex flex-col gap-6 border-b lg:border-b-0 lg:border-r border-[#18181c]">
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <Coins className="w-3.5 h-3.5 text-emerald-400" />
                POST /transaction
              </h2>
              
              <button 
                id="btn_open_adduser_modal"
                onClick={() => setShowAddUserModal(true)}
                className="text-[11px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 px-2 py-1 rounded transition-colors flex items-center gap-1"
              >
                <UserPlus className="w-3 h-3" />
                New Profile
              </button>
            </div>

            {/* TRANSACTION CONTROLS FORM */}
            <form onSubmit={handleExecuteTransaction} className="space-y-4">
              
              {/* User Selection */}
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase text-slate-400 font-semibold tracking-wider block">Target User Account</label>
                <div className="relative">
                  <select 
                    id="select_user_id"
                    value={selectedUserId}
                    onChange={(e) => setSelectedUserId(e.target.value)}
                    className="w-full bg-[#141417] border border-[#222228] rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/50 text-slate-200 appearance-none font-mono cursor-pointer"
                  >
                    {users.map(u => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.id}) — Balance: ${u.balance.toFixed(2)}
                      </option>
                    ))}
                  </select>
                  <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none text-slate-500">
                    ▼
                  </div>
                </div>
              </div>

              {/* Transaction Type */}
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase text-slate-400 font-semibold tracking-wider block">Transaction Flow</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    id="btn_tx_type_debit"
                    type="button"
                    onClick={() => setTxType("DEBIT")}
                    className={`py-2 px-3 rounded text-xs font-semibold uppercase tracking-wider border transition-all ${
                      txType === "DEBIT" 
                        ? "bg-rose-500/10 border-rose-500/40 text-rose-400 shadow-[0_0_12px_rgba(239,68,68,0.15)]" 
                        : "bg-[#141417] border-[#222228] text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    <ArrowDownLeft className="w-3.5 h-3.5 inline mr-1" />
                    DEBIT (Withdrawal)
                  </button>
                  <button
                    id="btn_tx_type_credit"
                    type="button"
                    onClick={() => setTxType("CREDIT")}
                    className={`py-2 px-3 rounded text-xs font-semibold uppercase tracking-wider border transition-all ${
                      txType === "CREDIT" 
                        ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.15)]" 
                        : "bg-[#141417] border-[#222228] text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    <ArrowUpRight className="w-3.5 h-3.5 inline mr-1" />
                    CREDIT (Deposit)
                  </button>
                </div>
              </div>

              {/* Amount (USD) */}
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase text-slate-400 font-semibold tracking-wider block">Transaction Amount (USD)</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500 font-mono text-sm">$</div>
                  <input 
                    id="input_tx_amount"
                    type="number" 
                    step="0.01"
                    min="0.01"
                    placeholder="100.00" 
                    value={txAmount}
                    onChange={(e) => setTxAmount(e.target.value)}
                    className="w-full bg-[#141417] border border-[#222228] rounded pl-8 pr-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500/50 font-mono"
                    required
                  />
                </div>
              </div>

              {/* Idempotency Key */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] uppercase text-slate-400 font-semibold tracking-wider">Idempotency Token</label>
                  <button 
                    id="btn_roll_idempotency"
                    type="button"
                    onClick={generateNewIdempotencyKey}
                    title="Generate New Idempotency Key"
                    className="text-[10px] text-slate-400 hover:text-emerald-400 flex items-center gap-1 font-mono hover:underline"
                  >
                    <RefreshCw className="w-2.5 h-2.5" /> Roll Key
                  </button>
                </div>
                <div className="relative">
                  <input 
                    id="input_idempotency_key"
                    type="text" 
                    placeholder="Enter custom or use generated"
                    value={idempotencyKey}
                    onChange={(e) => setIdempotencyKey(e.target.value)}
                    className="w-full bg-[#141417] border border-[#222228] rounded px-3 py-2 text-xs font-mono text-slate-300 focus:outline-none focus:border-emerald-500/50"
                    required
                  />
                </div>
                <p className="text-[9px] text-slate-500 italic leading-snug">
                  Forces request safety. Retrying with this SAME key will return cached results instead of deducting again.
                </p>
              </div>

              {/* Concurrency Simulator Control Panel */}
              <div className="bg-[#111114] border border-[#1e1e24] rounded p-3 space-y-3.5 mt-3">
                <h3 className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center gap-1">
                  <Terminal className="w-3.5 h-3.5 text-blue-400" />
                  Latency & Concurrency Controls
                </h3>

                {/* Delay Simulation Checkbox */}
                <div className="flex items-center justify-between">
                  <span className="text-[10.5px] text-slate-300">Simulate Network Delay</span>
                  <input 
                    id="checkbox_simulate_delay"
                    type="checkbox" 
                    checked={simulateDelay}
                    onChange={(e) => setSimulateDelay(e.target.checked)}
                    className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                  />
                </div>

                {simulateDelay && (
                  <div className="flex items-center gap-2 pl-4">
                    <span className="text-[10px] text-slate-500 font-mono">Delay:</span>
                    <input 
                      id="input_delay_range"
                      type="range" 
                      min="100" 
                      max="2000" 
                      step="100"
                      value={delayMs}
                      onChange={(e) => setDelayMs(parseInt(e.target.value))}
                      className="flex-1 accent-emerald-400 h-1 bg-slate-800 rounded-lg cursor-pointer"
                    />
                    <span className="text-[10px] font-mono text-slate-400">{delayMs}ms</span>
                  </div>
                )}

                {/* Mutex lock switch */}
                <div className="flex items-center justify-between border-t border-[#1e1e24] pt-2">
                  <span className="text-[10.5px] text-slate-300 flex items-center gap-1.5">
                    {disableLocking ? (
                      <Unlock className="w-3.5 h-3.5 text-rose-400" />
                    ) : (
                      <Lock className="w-3.5 h-3.5 text-emerald-400" />
                    )}
                    Concurrency Protection
                  </span>
                  <button
                    id="btn_toggle_concurrency_lock"
                    type="button"
                    onClick={() => setDisableLocking(!disableLocking)}
                    className={`text-[9.5px] font-bold px-2.5 py-1 rounded border transition-colors ${
                      disableLocking 
                        ? "bg-rose-500/10 border-rose-500/30 text-rose-400 hover:bg-rose-500/20" 
                        : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20"
                    }`}
                  >
                    {disableLocking ? "MUTEX INACTIVE" : "MUTEX ACTIVE"}
                  </button>
                </div>
                <p className="text-[9px] text-slate-500 italic leading-snug">
                  {disableLocking 
                    ? "🚨 DANGER: Mutex locks are disabled. Two asynchronous debit requests can interleave and spend the same balance twice!"
                    : "🔒 SECURE: Mutex locks queue requests per user. No double-spending can occur during delayed executions."}
                </p>
              </div>

              {/* ACTION BUTTONS */}
              <div className="space-y-2 pt-2">
                <button 
                  id="btn_execute_transaction"
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-slate-50 font-semibold py-2.5 rounded text-xs transition-all tracking-wider uppercase active:scale-[0.98] shadow-lg shadow-emerald-900/10"
                >
                  {isSubmitting ? "Processing Flow..." : "Execute Atomic Transaction"}
                </button>

                {/* Simultaneous Blaster Buttons to demonstrate API limits */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    id="btn_simulate_concurrency_safe"
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleSimulateConcurrency(true)}
                    className="py-1.5 px-2 bg-slate-900 border border-slate-800 text-slate-400 hover:text-white rounded text-[10px] text-center hover:border-slate-700 transition-colors leading-tight"
                    title="Sends 4 debit requests simultaneously with identical idempotency tokens"
                  >
                    Test Idempotency (Same Keys)
                  </button>
                  <button
                    id="btn_simulate_concurrency_unsafe"
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleSimulateConcurrency(false)}
                    className={`py-1.5 px-2 rounded text-[10px] text-center transition-colors leading-tight border ${
                      disableLocking 
                        ? "bg-rose-500/10 border-rose-500/20 text-rose-300 hover:bg-rose-500/20 animate-pulse" 
                        : "bg-blue-500/10 border-blue-500/20 text-blue-300 hover:bg-blue-500/20"
                    }`}
                    title="Sends 4 debit requests simultaneously with unique tokens to race check balance"
                  >
                    {disableLocking ? "Trigger Double Spend!" : "Test Mutex Race Protection"}
                  </button>
                </div>
              </div>
            </form>
          </div>

          {/* POLICY DESCRIPTION CARD */}
          <div className="mt-auto bg-[#111114] border border-[#1e1e24] rounded-lg p-3.5 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
              <ShieldAlert className="w-4 h-4 text-emerald-400" />
              Developer Sandboxed Metrics
            </div>
            <p className="text-[10px] text-slate-500 leading-relaxed font-mono">
              The locking engine maps user locks in memory. If latency is simulated, you can test race conditions easily. Clear your database cache anytime via the <span className="text-slate-300 font-semibold">Reset State</span> button.
            </p>
          </div>
        </section>

        {/* PANEL 2: CENTER USER STATS SUMMARY (4 cols) */}
        <section id="panel_user_summary" className="lg:col-span-4 bg-[#0a0a0b] p-6 flex flex-col border-b lg:border-b-0 lg:border-r border-[#18181c] overflow-y-auto max-h-[calc(100vh-100px)] lg:max-h-none">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <User className="w-3.5 h-3.5 text-emerald-400" />
              GET /summary/:userId
            </h2>
            {selectedUserObj && (
              <span className="font-mono text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">
                Active ID: {selectedUserObj.id}
              </span>
            )}
          </div>

          {summary ? (
            <div className="space-y-5 flex-1 flex flex-col justify-between">
              
              {/* PRIMARY STAT CARD */}
              <div className="bg-[#111113] border border-[#1e1e24] rounded-xl p-5 shadow-xl relative overflow-hidden group">
                <div className="absolute right-0 top-0 w-24 h-24 bg-gradient-to-bl from-emerald-500/5 to-transparent rounded-bl-full pointer-events-none"></div>
                
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-emerald-600 to-teal-700 rounded-lg flex items-center justify-center font-bold text-sm text-slate-50 shadow-md">
                      {summary.user.name.split(" ").map(w => w[0]).join("")}
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm text-slate-100 leading-tight">{summary.user.name}</h3>
                      <p className="text-[10px] text-slate-500 font-mono mt-0.5">Created: {new Date(summary.user.createdAt).toLocaleDateString()}</p>
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="text-[9px] text-slate-500 uppercase tracking-widest font-semibold">Account Age</p>
                    <p className="text-xs font-mono font-semibold text-slate-300">
                      {Math.ceil((Date.now() - summary.user.createdAt) / 86400000)} days
                    </p>
                  </div>
                </div>

                {/* BALANCE SUMMARY */}
                <div className="space-y-5">
                  <div className="flex justify-between items-end border-b border-[#1c1c21] pb-3">
                    <div>
                      <p className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">Available Account Balance</p>
                      <p className={`text-2xl font-mono font-bold tracking-tight mt-0.5 ${summary.user.balance < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                        ${summary.user.balance.toFixed(2)}
                      </p>
                    </div>
                    <span className="text-[10px] text-slate-400 bg-[#17171b] px-2 py-1 rounded font-mono border border-slate-800">
                      {summary.metrics.totalTransactions} total txs
                    </span>
                  </div>

                  {/* MINI VOLUME GRIDS */}
                  <div className="grid grid-cols-2 gap-3.5">
                    <div className="bg-[#151518] border border-slate-900 p-2.5 rounded hover:border-slate-800 transition-colors">
                      <p className="text-[9px] text-slate-500 uppercase font-semibold">Total Credit Volume</p>
                      <p className="text-xs font-mono text-emerald-400 mt-1 font-semibold">+${summary.metrics.totalCreditVolume.toFixed(2)}</p>
                    </div>
                    <div className="bg-[#151518] border border-slate-900 p-2.5 rounded hover:border-slate-800 transition-colors">
                      <p className="text-[9px] text-slate-500 uppercase font-semibold">Total Debit Volume</p>
                      <p className="text-xs font-mono text-rose-400 mt-1 font-semibold">-${summary.metrics.totalDebitVolume.toFixed(2)}</p>
                    </div>
                  </div>

                  {/* SCORE METER */}
                  <div className="space-y-1.5 pt-1.5">
                    <div className="flex justify-between items-center text-[10px] text-slate-400 font-mono">
                      <span>Organic Activity Score</span>
                      {rankings.find(r => r.userId === selectedUserId)?.rules.isSpamming ? (
                        <span className="text-rose-400 font-bold bg-rose-500/10 px-1.5 py-0.5 rounded">HIGH VELOCITY PENALTY</span>
                      ) : (
                        <span className="text-emerald-400 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded">EXCELLENT</span>
                      )}
                    </div>
                    <div className="w-full h-1.5 bg-[#17171b] border border-[#222] rounded-full overflow-hidden">
                      <div 
                        className={`h-full transition-all duration-500 ${
                          rankings.find(r => r.userId === selectedUserId)?.rules.isSpamming 
                            ? "w-[30%] bg-rose-500 animate-pulse" 
                            : "w-[98%] bg-emerald-500"
                        }`}
                      ></div>
                    </div>
                  </div>
                </div>
              </div>

              {/* USER TRANSACTION HISTORY LIST */}
              <div className="flex-1 flex flex-col min-h-[180px] mt-4">
                <h3 className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-2.5">
                  Transaction History & Key Logs
                </h3>

                {summary.history.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center border border-dashed border-[#1e1e24] rounded-lg p-6 text-center text-slate-600 bg-[#0c0c0e]">
                    <Coins className="w-6 h-6 mb-2 text-slate-700" />
                    <p className="text-xs font-mono">No historical records found</p>
                    <p className="text-[10px] text-slate-500 mt-1">Execute a transaction above to view dynamic history.</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                    {summary.history.map((tx) => (
                      <div 
                        key={tx.id} 
                        className={`border rounded p-2.5 text-xs transition-all ${
                          tx.status === "SUCCESS" 
                            ? "bg-[#0d0d10] border-[#1c1c22]" 
                            : "bg-rose-950/10 border-rose-500/10"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold flex items-center gap-1.5">
                            {tx.status === "SUCCESS" ? (
                              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full"></span>
                            ) : (
                              <span className="w-1.5 h-1.5 bg-rose-500 rounded-full"></span>
                            )}
                            {tx.type} Transaction
                          </span>
                          <span className={`font-mono font-bold ${tx.type === "DEBIT" ? "text-rose-400" : "text-emerald-400"}`}>
                            {tx.type === "DEBIT" ? "-" : "+"}${tx.amount.toFixed(2)}
                          </span>
                        </div>

                        {tx.status === "FAILED" && tx.reason && (
                          <p className="text-[10px] text-rose-400 mt-1 font-mono flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            Failed: {tx.reason}
                          </p>
                        )}

                        <div className="flex justify-between items-center text-[9px] text-slate-500 font-mono mt-2 border-t border-[#1a1a22] pt-1.5">
                          <span>Idempotency Key:</span>
                          <span className="text-slate-400 truncate max-w-[150px]" title={tx.idempotencyKey}>
                            {tx.idempotencyKey}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-[9px] text-slate-600 font-mono mt-0.5">
                          <span>Timestamp:</span>
                          <span>{new Date(tx.timestamp).toLocaleTimeString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-600">
              <RefreshCw className="w-8 h-8 animate-spin mb-3 text-emerald-500" />
              <p className="text-xs">Loading profile statistics...</p>
            </div>
          )}
        </section>

        {/* PANEL 3: GLOBAL RANKINGS & LIVE SYSTEM CONSOLE LOGS (5 cols) */}
        <section id="panel_global_rankings" className="lg:col-span-5 bg-[#0f0f11] p-6 flex flex-col justify-between overflow-y-auto max-h-[calc(100vh-100px)] lg:max-h-none">
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                GET /ranking
              </h2>
              <div className="text-[9px] text-slate-500 border border-[#222228] px-2 py-0.5 rounded font-mono">
                Weights: Vol (0.5) + Value (0.3) + Count (2.0)
              </div>
            </div>

            {/* LEADERBOARD CONTAINER */}
            <div className="space-y-1">
              
              {/* Leaderboard Table Headers */}
              <div className="grid grid-cols-12 gap-1.5 px-2.5 py-1.5 text-[9px] uppercase font-bold text-slate-500 border-b border-[#222228] font-mono">
                <div className="col-span-1 text-center">#</div>
                <div className="col-span-4">Profile Name</div>
                <div className="col-span-2 text-right">Volume</div>
                <div className="col-span-1 text-right">Count</div>
                <div className="col-span-2 text-right">Score</div>
                <div className="col-span-2 text-right">Abuse Mitigation</div>
              </div>

              {/* Leaderboard Rows */}
              {rankings.map((player) => {
                const isActiveUser = player.userId === selectedUserId;
                const isPenalized = player.rules.penaltyApplied;
                
                return (
                  <div 
                    key={player.userId}
                    className={`grid grid-cols-12 gap-1.5 px-2.5 py-2.5 text-xs border rounded transition-all items-center cursor-pointer ${
                      isActiveUser 
                        ? "bg-emerald-500/5 border-emerald-500/30 ring-1 ring-emerald-500/20" 
                        : "bg-[#111113] border-[#1e1e24] hover:border-slate-800"
                    }`}
                    onClick={() => setSelectedUserId(player.userId)}
                  >
                    {/* Rank */}
                    <div className="col-span-1 text-center font-mono font-semibold text-slate-500">
                      {player.rank.toString().padStart(2, "0")}
                    </div>

                    {/* User Name */}
                    <div className="col-span-4 font-semibold text-slate-200 flex items-center gap-1.5 truncate">
                      {player.name}
                      {isActiveUser && (
                        <span className="text-[8px] bg-emerald-400 text-slate-900 font-extrabold px-1 rounded-sm uppercase tracking-tighter">You</span>
                      )}
                    </div>

                    {/* Volume */}
                    <div className="col-span-2 text-right font-mono text-slate-300">
                      ${player.metrics.totalVolume.toFixed(0)}
                    </div>

                    {/* Transaction Count */}
                    <div className="col-span-1 text-right font-mono text-slate-400">
                      {player.metrics.transactionCount}
                    </div>

                    {/* Score */}
                    <div className="col-span-2 text-right font-mono font-bold text-slate-100">
                      {player.score}
                    </div>

                    {/* Abuse mitigation state */}
                    <div className="col-span-2 text-right font-mono text-[9px]">
                      {isPenalized ? (
                        <span className="text-rose-400 font-bold bg-rose-500/10 px-1 rounded border border-rose-500/20 animate-pulse" title="Triggered spam policy (>4 transactions per minute). 60% penalty applied.">
                          ⚠️ SPAM PENALTY
                        </span>
                      ) : (
                        <span className="text-emerald-400 bg-emerald-500/5 px-1 rounded border border-emerald-500/10">
                          Organic
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* FORMULA CALLOUT */}
            <div className="mt-4 p-3 bg-[#111113] border border-[#1e1e24] rounded-lg">
              <h4 className="text-[10px] uppercase font-bold text-slate-400 mb-1 font-mono tracking-wider">Scoring Standards (Fairness Protocol)</h4>
              <p className="text-[9.5px] text-slate-500 font-mono leading-relaxed">
                Base Score = <span className="text-slate-300">(Volume × 0.5) + (AverageTx × 0.3) + (SuccessfulCount × 2)</span>
              </p>
              <p className="text-[9px] text-rose-400/80 font-mono mt-1 italic">
                * Note: Submitting &gt;4 transactions inside a 60-second window triggers a Spam Penalty, discounting the dynamic score by 60%. Test this by rapidly clicking Execute!
              </p>
            </div>
          </div>

          {/* BACKEND LOGS CONSOLE TERMINAL */}
          <div className="mt-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[10px] uppercase font-bold text-slate-500 tracking-wider font-mono flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-blue-400" />
                Live Node.js Server Console Logs
              </h3>
              <span className="text-[9px] text-slate-600 font-mono">Auto-refreshes (3s)</span>
            </div>

            <div className="bg-[#09090b] border border-[#1e1e24] rounded-lg p-3.5 font-mono text-[10px] space-y-1.5 h-[160px] overflow-y-auto shadow-inner">
              {logs.length === 0 ? (
                <p className="text-slate-600 italic">Listening for transactions or system lock operations...</p>
              ) : (
                logs.map((log) => {
                  let colorClass = "text-slate-400";
                  let tagColor = "text-slate-600";
                  if (log.type === "success") {
                    colorClass = "text-emerald-400";
                    tagColor = "text-emerald-600 font-bold";
                  } else if (log.type === "warn") {
                    colorClass = "text-orange-300";
                    tagColor = "text-orange-500 font-bold";
                  } else if (log.type === "error") {
                    colorClass = "text-rose-400";
                    tagColor = "text-rose-600 font-bold";
                  } else if (log.type === "info") {
                    colorClass = "text-blue-300";
                    tagColor = "text-blue-500";
                  }

                  return (
                    <div key={log.id} className="leading-relaxed hover:bg-white/[0.02] py-0.5 px-1 rounded transition-colors">
                      <span className="text-slate-600 mr-1.5">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                      <span className={`${tagColor} mr-2`}>[{log.type.toUpperCase()}]</span>
                      <span className={colorClass}>{log.message}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER STATUS BAR */}
      <footer className="h-10 bg-[#070709] border-t border-[#1a1a22] flex flex-col sm:flex-row items-center px-6 justify-between text-[9px] text-slate-600 font-mono gap-1.5 py-2 sm:py-0">
        <div className="flex gap-4 sm:gap-6">
          <span>DB STORE: <span className="text-slate-400">IN-MEMORY MAP & ARRAYS</span></span>
          <span>ENVIRONMENT: <span className="text-slate-400">AI_STUDIO_PREVIEW</span></span>
          <span>API: <span className="text-slate-400">EXPRESS + TSX</span></span>
        </div>
        <div className="flex gap-4">
          <span className="text-emerald-500/80">LOCKING ENGINE: ACTIVE (PESSIMISTIC MUTEX)</span>
          <span className="text-slate-500">PROFILES RECORDED: {users.length}</span>
        </div>
      </footer>

      {/* NEW USER MODAL OVERLAY */}
      {showAddUserModal && (
        <div id="modal_new_user" className="fixed inset-0 z-50 bg-[#000]/70 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-[#0d0d10] border border-[#22222c] rounded-xl p-6 w-full max-w-sm shadow-2xl animate-scaleIn">
            <div className="flex items-center justify-between mb-4 border-b border-[#1e1e24] pb-3">
              <h3 className="font-semibold text-sm text-slate-100 flex items-center gap-1.5">
                <UserPlus className="w-4 h-4 text-emerald-400" />
                Create New Account
              </h3>
              <button 
                onClick={() => setShowAddUserModal(false)}
                className="text-slate-400 hover:text-white text-lg font-bold"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase text-slate-400 font-semibold tracking-wider block">Full Name</label>
                <input 
                  id="input_new_user_name"
                  type="text" 
                  placeholder="e.g. Jack Sparrow" 
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  className="w-full bg-[#141417] border border-[#222228] rounded px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500/50 font-sans"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase text-slate-400 font-semibold tracking-wider block">Starting Balance (USD)</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500 font-mono text-sm">$</div>
                  <input 
                    id="input_new_user_balance"
                    type="number" 
                    step="0.01"
                    min="0"
                    placeholder="1000.00" 
                    value={newUserBalance}
                    onChange={(e) => setNewUserBalance(e.target.value)}
                    className="w-full bg-[#141417] border border-[#222228] rounded pl-8 pr-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500/50 font-mono"
                    required
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button 
                  id="btn_cancel_add_user"
                  type="button" 
                  onClick={() => setShowAddUserModal(false)}
                  className="flex-1 bg-[#141417] border border-[#222228] text-slate-400 hover:text-white hover:bg-slate-800 text-xs py-2 rounded transition-all font-semibold"
                >
                  Cancel
                </button>
                <button 
                  id="btn_submit_add_user"
                  type="submit" 
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs py-2 rounded transition-all font-semibold"
                >
                  Create User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
