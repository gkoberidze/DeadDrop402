import express from "express";
import type { Request, Response } from "express";
import { Connection, Keypair } from "@solana/web3.js";
import path from "path";
import cors from "cors";
import fs from "fs";

const app = express();
app.use(cors());
app.use(express.json());

// Resolve __dirname equivalent in ES module mode
const publicPath = path.join(process.cwd(), "public");
app.use(express.static(publicPath));

const connection = new Connection("https://api.devnet.solana.com", "confirmed");

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

// Track used signatures to prevent Replay Attacks
const usedSignatures = new Set<string>();

// Dynamic High-Value Payload Generator
function getDeadDropVault() {
  return {
    id: `DROP-${Math.floor(1000 + Math.random() * 9000)}-X`,
    classification: "CONFIDENTIAL_ONCHAIN_INTEL",
    timestamp: new Date().toISOString(),
    networkMetrics: {
      targetCluster: "solana-devnet",
      tps: Math.floor(2800 + Math.random() * 400),
      solUsdPrice: (142.50 + Math.random() * 2.5).toFixed(2),
      liquidityDepthUsd: "$1,240,000",
    },
    agentCredentials: {
      apiKey: `sk_live_${Math.random().toString(36).substring(2, 15)}`,
      endpoint: "https://api.deaddrop.network/v1/stream",
      ttl: "60 seconds",
    },
  };
}

// Main HTTP 402 Protected Endpoint
app.get("/api/v1/deaddrop/intel", async (req: Request, res: Response) => {
  const paymentSignature = req.headers["payment-signature"] as string;
  const REQUIRED_LAMPORTS = 1000000; // 0.001 SOL

  // 1. Throw HTTP 402 if no payment header
  if (!paymentSignature) {
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
      },
    });
  }

  // 2. Prevent Replay Attacks (Check if signature was already spent)
  if (usedSignatures.has(paymentSignature)) {
    logEvent("REPLAY_ATTACK_BLOCKED", { signature: paymentSignature });
    return res.status(400).json({ error: "Replay attack detected: Signature has already been used." });
  }

  // 3. Validate on-chain transaction thoroughly
  try {
    logEvent("VERIFYING_TX", { signature: paymentSignature });
    const tx = await connection.getParsedTransaction(paymentSignature, {
      maxSupportedTransactionVersion: 0,
    });

    // Check if transaction exists and did not fail on-chain
    if (!tx || tx.meta?.err !== null) {
      logEvent("VERIFY_FAILED", { reason: "Transaction unconfirmed, failed, or invalid." });
      return res.status(400).json({ error: "Invalid or failed transaction signature." });
    }

    // Ensure we know the server pubkey for validation
    if (!serverKeypair) {
      return res.status(500).json({ error: "Server wallet key not configured." });
    }

    // Verify recipient and transferred lamport amount
    const accountKeys = tx.transaction.message.accountKeys;
    const recipientIndex = accountKeys.findIndex(
      (acc) => acc.pubkey.toBase58() === SERVER_PUBKEY
    );

    if (recipientIndex === -1 || !tx.meta) {
      logEvent("VERIFY_FAILED", { reason: "Recipient not found in transaction instructions." });
      return res.status(400).json({ error: "Payment recipient mismatch." });
    }

    const preBalance = tx.meta.preBalances[recipientIndex];
    const postBalance = tx.meta.postBalances[recipientIndex];
    const diff = postBalance - preBalance;

    if (diff < REQUIRED_LAMPORTS) {
      logEvent("VERIFY_FAILED", { reason: `Insufficient funds transferred. Expected ${REQUIRED_LAMPORTS}, got ${diff}` });
      return res.status(400).json({ error: "Insufficient payment amount." });
    }

    // Mark signature as used to block subsequent replay attempts
    usedSignatures.add(paymentSignature);

    const unlockedPayload = getDeadDropVault();
    logEvent("PAYLOAD_UNLOCKED", { dropId: unlockedPayload.id, recipient: SERVER_PUBKEY, signature: paymentSignature });
    return res.status(200).json({
      status: "UNLOCKED",
      protocol: "x402",
      data: unlockedPayload,
    });
  } catch (err: any) {
    logEvent("VERIFY_ERROR", { message: err.message });
    return res.status(500).json({ error: "Verification failed.", details: err.message });
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