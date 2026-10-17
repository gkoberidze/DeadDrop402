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
if (fs.existsSync("server-key.json")) {
  const secret = JSON.parse(fs.readFileSync("server-key.json", "utf-8"));
  SERVER_PUBKEY = Keypair.fromSecretKey(Uint8Array.from(secret)).publicKey.toBase58();
}

// In-memory event log for the Web Dashboard UI
let eventLogs: Array<{ time: string; type: string; details: any }> = [];

function logEvent(type: string, details: any) {
  const log = { time: new Date().toLocaleTimeString(), type, details };
  eventLogs.unshift(log);
  if (eventLogs.length > 20) eventLogs.pop();
}

// Protected Ephemeral Secret Payload
const DEAD_DROP_VAULT = {
  id: "DROP-9942-X",
  classification: "TOP-SECRET",
  payload: "CONFIDENTIAL: Internal API Gateway key `sk_live_9921_solana_agent` retrieved at runtime.",
  expiresIn: "30 seconds",
};

// Main HTTP 402 Protected Endpoint
app.get("/api/v1/deaddrop/intel", async (req: Request, res: Response) => {
  const paymentSignature = req.headers["payment-signature"] as string;

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
        amountLamports: 1000000, // 0.001 SOL
        asset: "SOL",
      },
    });
  }

  // 2. Validate on-chain signature
  try {
    logEvent("VERIFYING_TX", { signature: paymentSignature });
    const tx = await connection.getTransaction(paymentSignature, {
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) {
      logEvent("VERIFY_FAILED", { reason: "Transaction unconfirmed or invalid." });
      return res.status(400).json({ error: "Invalid transaction signature." });
    }

    logEvent("PAYLOAD_UNLOCKED", { dropId: DEAD_DROP_VAULT.id, recipient: SERVER_PUBKEY });
    return res.status(200).json({
      status: "UNLOCKED",
      protocol: "x402",
      data: DEAD_DROP_VAULT,
    });
  } catch (err: any) {
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