import express from "express";
import type { Request, Response } from "express";
import {
  Connection,
  Keypair,
} from "@solana/web3.js";
import type {
  ParsedInstruction,
  PartiallyDecodedInstruction,
} from "@solana/web3.js";
import path from "path";
import cors from "cors";
import fs from "fs";
import { randomBytes } from "node:crypto";

const app = express();
app.use(cors());
app.use(express.json());

// Resolve __dirname equivalent in ES module mode
const publicPath = path.join(process.cwd(), "public");
app.use(express.static(publicPath));

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const REQUIRED_LAMPORTS = 1_000_000;
const PAYMENT_MAX_AGE_SECONDS = 5 * 60;
const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const SOL_PRICE_FALLBACK_USD = 142.5;
const PAYMENT_SIGNATURE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

// Load keys or fallback gracefully
let SERVER_PUBKEY = "Generate via npm run setup";
let serverKeypair: Keypair | null = null;
if (fs.existsSync("server-key.json")) {
  const secret = JSON.parse(fs.readFileSync("server-key.json", "utf-8"));
  serverKeypair = Keypair.fromSecretKey(Uint8Array.from(secret));
  SERVER_PUBKEY = serverKeypair.publicKey.toBase58();
}

// In-memory event log for the Web Dashboard UI
let eventLogs: Array<{ time: string; type: string; details: any }> = [];

function logEvent(type: string, details: any) {
  const log = { time: new Date().toLocaleTimeString(), type, details };
  eventLogs.unshift(log);
  if (eventLogs.length > 20) eventLogs.pop();
}

// Signatures are reserved synchronously while verification is in progress.
const usedSignatures = new Set<string>();
const paymentQuotes = new Map<string, {
  expiresAt: number;
  reservedBy?: string;
  consumed?: boolean;
}>();

async function fetchSolUsdPrice(): Promise<number> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      { signal: controller.signal },
    );
    if (!response.ok) throw new Error(`CoinGecko responded with HTTP ${response.status}`);
    const body: unknown = await response.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("solana" in body) ||
      typeof body.solana !== "object" ||
      body.solana === null ||
      !("usd" in body.solana) ||
      typeof body.solana.usd !== "number" ||
      !Number.isFinite(body.solana.usd)
    ) {
      throw new Error("CoinGecko returned an invalid SOL price");
    }
    return body.solana.usd;
  } catch (error) {
    logEvent("SOL_PRICE_FALLBACK", {
      reason: error instanceof Error ? error.message : "Unknown price lookup error",
      fallbackUsd: SOL_PRICE_FALLBACK_USD,
    });
    return SOL_PRICE_FALLBACK_USD;
  } finally {
    clearTimeout(timeout);
  }
}

async function getDeadDropVault() {
  const [solUsdPrice, performanceSamples] = await Promise.all([
    fetchSolUsdPrice(),
    connection.getRecentPerformanceSamples(1),
  ]);
  const latestSample = performanceSamples[0];
  const tps = latestSample && latestSample.samplePeriodSecs > 0
    ? Math.round(latestSample.numTransactions / latestSample.samplePeriodSecs)
    : 0;

  return {
    id: `DROP-${Math.floor(1000 + Math.random() * 9000)}-X`,
    classification: "CONFIDENTIAL_ONCHAIN_INTEL",
    timestamp: new Date().toISOString(),
    networkMetrics: {
      targetCluster: "solana-devnet",
      tps,
      solUsdPrice: solUsdPrice.toFixed(2),
      liquidityDepthUsd: "Not available",
    },
    agentCredentials: {
      endpoint: "https://api.deaddrop.network/v1/stream",
      ttl: "60 seconds",
    },
  };
}

// Main HTTP 402 Protected Endpoint
app.get("/api/v1/deaddrop/intel", async (req: Request, res: Response) => {
  const paymentSignature = req.headers["payment-signature"];

  // 1. Throw HTTP 402 if no payment header
  if (!paymentSignature) {
    const now = Date.now();
    for (const [nonce, quote] of paymentQuotes) {
      if (quote.expiresAt <= now) paymentQuotes.delete(nonce);
    }
    const memo = randomBytes(16).toString("hex");
    paymentQuotes.set(memo, { expiresAt: now + PAYMENT_MAX_AGE_SECONDS * 1000 });
    logEvent("HTTP_402_INTERCEPT", { status: "402 Payment Required", recipient: SERVER_PUBKEY });
    return res.status(402).json({
      error: "402 Payment Required",
      protocol: "x402-solana-v2",
      message: "Autonomous data purchase required.",
      paymentDetails: {
        network: "solana-devnet",
        recipient: SERVER_PUBKEY,
        amountLamports: REQUIRED_LAMPORTS,
        asset: "SOL",
        memo,
      },
    });
  }

  if (typeof paymentSignature !== "string" || !PAYMENT_SIGNATURE_PATTERN.test(paymentSignature)) {
    return res.status(400).json({
      error: "Invalid payment signature format. Expected a base58 transaction signature.",
    });
  }

  // 2. Prevent Replay Attacks (Check if signature was already spent)
  if (usedSignatures.has(paymentSignature)) {
    logEvent("REPLAY_ATTACK_BLOCKED", { signature: paymentSignature.slice(0, 100) });
    return res.status(400).json({ error: "Replay attack detected: Signature has already been used." });
  }
  usedSignatures.add(paymentSignature);

  // 3. Validate on-chain transaction thoroughly
  let verified = false;
  let reservedMemo: string | undefined;
  try {
    logEvent("VERIFYING_TX", { signature: paymentSignature.slice(0, 100) });
    const tx = await connection.getParsedTransaction(paymentSignature, {
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) {
      logEvent("VERIFY_FAILED", { reason: "Transaction not found or not confirmed." });
      return res.status(400).json({ error: "Transaction not found or not confirmed." });
    }
    if (tx.meta && tx.meta.err !== null) {
      logEvent("VERIFY_FAILED", { reason: "Transaction failed on-chain." });
      return res.status(400).json({ error: "Transaction failed on-chain." });
    }
    if (!tx.meta) {
      logEvent("VERIFY_FAILED", { reason: "Transaction metadata is unavailable." });
      return res.status(400).json({ error: "Transaction metadata is unavailable." });
    }
    if (tx.blockTime == null) {
      logEvent("VERIFY_FAILED", { reason: "Transaction block time is unavailable." });
      return res.status(400).json({ error: "Transaction block time is unavailable." });
    }
    if (Date.now() / 1000 - tx.blockTime > PAYMENT_MAX_AGE_SECONDS) {
      logEvent("VERIFY_FAILED", { reason: "Transaction is older than five minutes." });
      return res.status(400).json({ error: "Payment transaction is older than five minutes." });
    }

    if (!serverKeypair) {
      return res.status(500).json({ error: "Server wallet key not configured." });
    }

    const instructions: (ParsedInstruction | PartiallyDecodedInstruction)[] = [
      ...tx.transaction.message.instructions,
      ...(tx.meta.innerInstructions?.flatMap((group) => group.instructions) ?? []),
    ];
    const memoInstruction = instructions.find((instruction) =>
      instruction.programId.toBase58() === MEMO_PROGRAM_ID &&
      "parsed" in instruction &&
      typeof instruction.parsed === "string"
    );

    if (!memoInstruction || !("parsed" in memoInstruction) || typeof memoInstruction.parsed !== "string") {
      logEvent("VERIFY_FAILED", { reason: "No parsed memo instruction in transaction." });
      return res.status(400).json({ error: "Payment transaction is missing a valid Memo program instruction." });
    }

    const memo = memoInstruction.parsed;
    const quote = paymentQuotes.get(memo);
    if (!quote) {
      return res.status(400).json({ error: "Payment quote is unknown or has expired." });
    }
    if (quote.expiresAt <= Date.now()) {
      return res.status(400).json({ error: "Payment quote has expired." });
    }
    if (quote.consumed) {
      return res.status(400).json({ error: "Payment quote has already been used." });
    }
    if (quote.reservedBy && quote.reservedBy !== paymentSignature) {
      return res.status(400).json({ error: "Payment quote has already been used." });
    }
    quote.reservedBy = paymentSignature;
    reservedMemo = memo;

    const systemTransfers = instructions.flatMap((instruction) => {
      if (!("parsed" in instruction) || instruction.program !== "system") return [];
      const parsed = instruction.parsed;
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("type" in parsed) ||
        parsed.type !== "transfer" ||
        !("info" in parsed) ||
        typeof parsed.info !== "object" ||
        parsed.info === null ||
        !("destination" in parsed.info) ||
        typeof parsed.info.destination !== "string" ||
        !("lamports" in parsed.info) ||
        typeof parsed.info.lamports !== "number"
      ) {
        return [];
      }
      return [{
        destination: parsed.info.destination,
        lamports: parsed.info.lamports,
      }];
    });

    if (systemTransfers.length === 0) {
      logEvent("VERIFY_FAILED", { reason: "No parsed system transfer instruction." });
      return res.status(400).json({ error: "Payment transaction contains no system transfer instruction." });
    }
    const recipientTransfers = systemTransfers.filter(
      (transfer) => transfer.destination === SERVER_PUBKEY,
    );
    if (recipientTransfers.length === 0) {
      logEvent("VERIFY_FAILED", { reason: "System transfer destination does not match server wallet." });
      return res.status(400).json({ error: "Payment transfer recipient does not match the server wallet." });
    }
    const qualifyingTransfer = recipientTransfers.find(
      (transfer) => transfer.lamports >= REQUIRED_LAMPORTS,
    );
    if (!qualifyingTransfer) {
      logEvent("VERIFY_FAILED", { reason: "Server-directed transfer is below the required amount." });
      return res.status(400).json({
        error: "Server-directed transfer is below the required amount of 0.001 SOL.",
      });
    }

    const accountKeys = tx.transaction.message.accountKeys;
    const recipientIndex = accountKeys.findIndex(
      (account) => account.pubkey.toBase58() === SERVER_PUBKEY,
    );
    if (recipientIndex === -1) {
      logEvent("VERIFY_FAILED", { reason: "Server wallet is not present in transaction account keys." });
      return res.status(400).json({ error: "Payment recipient balance could not be verified." });
    }

    const diff = tx.meta.postBalances[recipientIndex] - tx.meta.preBalances[recipientIndex];
    if (diff < REQUIRED_LAMPORTS) {
      logEvent("VERIFY_FAILED", {
        reason: `Insufficient recipient balance increase. Expected ${REQUIRED_LAMPORTS}, got ${diff}.`,
      });
      return res.status(400).json({ error: "Insufficient payment amount." });
    }

    const unlockedPayload = await getDeadDropVault();
    if (quote.expiresAt <= Date.now()) {
      return res.status(400).json({ error: "Payment quote expired before the payload could be unlocked." });
    }
    quote.consumed = true;
    delete quote.reservedBy;
    verified = true;
    logEvent("PAYLOAD_UNLOCKED", {
      dropId: unlockedPayload.id,
      recipient: SERVER_PUBKEY,
      signature: paymentSignature.slice(0, 100),
    });
    return res.status(200).json({
      status: "UNLOCKED",
      protocol: "x402",
      data: unlockedPayload,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown verification error";
    logEvent("VERIFY_ERROR", { message });
    return res.status(500).json({ error: "Payment verification failed.", details: message });
  } finally {
    if (!verified) {
      usedSignatures.delete(paymentSignature);
      if (reservedMemo) {
        const quote = paymentQuotes.get(reservedMemo);
        if (quote?.reservedBy === paymentSignature) delete quote.reservedBy;
      }
    }
  }
});

// Endpoint for Web UI live feeds
app.get("/api/v1/logs", (req: Request, res: Response) => {
  res.json({ logs: eventLogs, serverPubkey: SERVER_PUBKEY });
});

app.listen(4020, () => {
  console.log("==================================================");
  console.log("🔒 DeadDrop402 Server online: http://localhost:4020");
  console.log("==================================================");
});