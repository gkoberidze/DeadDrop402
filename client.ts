import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import fs from "node:fs";
import process from "node:process";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const replayDemoEnabled = process.argv.includes("--replay");
const swarmDemoEnabled = process.argv.includes("--swarm");

const singleAgent = {
  name: "BioByte-Autonomous-Agent-01",
  maxBudgetLamports: 2_000_000,
};

const swarmAgents = [
  { name: "MarketScout", maxBudgetLamports: 1_500_000 },
  { name: "ChainWatcher", maxBudgetLamports: 1_250_000 },
  { name: "RiskAnalyst", maxBudgetLamports: 1_000_000 },
];

interface PaymentChallenge {
  paymentDetails: {
    network: string;
    recipient: string;
    amountLamports: number;
    memo: string;
  };
}

function isPaymentChallenge(value: unknown): value is PaymentChallenge {
  if (typeof value !== "object" || value === null || !("paymentDetails" in value)) {
    return false;
  }
  const details = value.paymentDetails;
  return typeof details === "object" && details !== null &&
    "network" in details && typeof details.network === "string" &&
    "recipient" in details && typeof details.recipient === "string" &&
    "amountLamports" in details && typeof details.amountLamports === "number" &&
    "memo" in details && typeof details.memo === "string";
}

function loadAgentWallet(): Keypair {
  if (!fs.existsSync("agent-key.json")) {
    throw new Error("Agent key missing! Run `npm run setup` first.");
  }
  const secret: unknown = JSON.parse(fs.readFileSync("agent-key.json", "utf-8"));
  if (!Array.isArray(secret) || !secret.every((byte) => Number.isInteger(byte))) {
    throw new Error("agent-key.json is not a valid Solana keypair.");
  }
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function runAutonomousAgent(
  agent: typeof singleAgent,
  agentKeypair: Keypair,
): Promise<boolean> {
  const targetUrl = "http://localhost:4020/api/v1/deaddrop/intel";
  const agentHeaders = { "x-agent-name": agent.name };

  console.log(`\n🤖 [AGENT INITIALIZATION] ${agent.name}`);
  console.log(`💳 Shared demo wallet: ${agentKeypair.publicKey.toBase58()}`);

  try {
    const balance = await connection.getBalance(agentKeypair.publicKey);
    console.log(`💰 Wallet balance: ${(balance / 1e9).toFixed(5)} SOL`);

    console.log(`\n🔍 ${agent.name} requests protected intel...`);
    const quoteResponse = await fetch(targetUrl, { headers: agentHeaders });
    const quoteBody: unknown = await quoteResponse.json();
    if (quoteResponse.status !== 402 || !isPaymentChallenge(quoteBody)) {
      console.error(`❌ Expected an HTTP 402 quote, received HTTP ${quoteResponse.status}:`, quoteBody);
      return false;
    }

    const paymentDetails = quoteBody.paymentDetails;
    console.log(`⚡ [HTTP 402] Quote received for ${paymentDetails.network}`);
    console.log(`   └─ Price: ${(paymentDetails.amountLamports / 1e9).toFixed(3)} SOL`);
    console.log(`   └─ Quote memo: ${paymentDetails.memo}`);

    if (paymentDetails.amountLamports > agent.maxBudgetLamports) {
      console.log(`⛔ [${agent.name}] Declined: quote exceeds this agent's budget.`);
      return false;
    }
    if (balance < paymentDetails.amountLamports + 10_000) {
      console.log(`⛔ [${agent.name}] Declined: insufficient SOL for payment and network fees.`);
      return false;
    }

    console.log(`✅ [${agent.name}] Approved within budget. Sending Devnet micropayment...`);
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: agentKeypair.publicKey,
        toPubkey: new PublicKey(paymentDetails.recipient),
        lamports: paymentDetails.amountLamports,
      }),
      new TransactionInstruction({
        keys: [],
        programId: MEMO_PROGRAM_ID,
        data: Buffer.from(paymentDetails.memo, "utf8"),
      }),
    );

    const signature = await sendAndConfirmTransaction(connection, transaction, [agentKeypair]);
    console.log(`✅ Payment confirmed: ${signature}`);

    const unlockResponse = await fetch(targetUrl, {
      method: "GET",
      headers: {
        ...agentHeaders,
        "payment-signature": signature,
      },
    });
    const unlockBody: unknown = await unlockResponse.json();
    if (!unlockResponse.ok) {
      console.error(`❌ [${agent.name}] Unlock failed (HTTP ${unlockResponse.status}):`, unlockBody);
      return false;
    }

    console.log(`\n🔓 [${agent.name}] DATA UNLOCKED`);
    console.dir(unlockBody, { depth: null, colors: true });

    if (replayDemoEnabled) {
      console.log(`\n🔁 [${agent.name}] Replay demo: resending the same signature...`);
      const replayResponse = await fetch(targetUrl, {
        headers: {
          ...agentHeaders,
          "payment-signature": signature,
        },
      });
      const replayBody: unknown = await replayResponse.json();
      if (replayResponse.status === 400) {
        console.log(`✅ Replay rejected as expected (HTTP 400):`, replayBody);
      } else {
        console.error(`❌ Unexpected replay response (HTTP ${replayResponse.status}):`, replayBody);
        return false;
      }
    }

    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown agent error";
    console.error(`❌ [${agent.name}] Agent run failed: ${message}`);
    return false;
  }
}

async function main() {
  let agentKeypair: Keypair;
  try {
    agentKeypair = loadAgentWallet();
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : "Could not load agent wallet."}`);
    process.exitCode = 1;
    return;
  }

  if (swarmDemoEnabled) {
    console.log("\n🛰️  DEADROP402 MULTI-AGENT BUYING DEMO");
    console.log("Three autonomous buyer profiles will purchase sequentially.");
    console.log("They share the configured throwaway Devnet agent wallet.");
    let successfulPurchases = 0;
    for (const agent of swarmAgents) {
      if (await runAutonomousAgent(agent, agentKeypair)) {
        successfulPurchases += 1;
      }
    }
    console.log(`\n📊 Swarm complete: ${successfulPurchases}/${swarmAgents.length} successful purchases.`);
    if (successfulPurchases !== swarmAgents.length) process.exitCode = 1;
    return;
  }

  const success = await runAutonomousAgent(singleAgent, agentKeypair);
  if (!success) process.exitCode = 1;
}

void main();
