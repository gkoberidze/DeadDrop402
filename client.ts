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

// Load Agent Wallet
if (!fs.existsSync("agent-key.json")) {
  console.error("❌ Agent key missing! Run `npm run setup` first.");
  process.exit(1);
}

const secret = JSON.parse(fs.readFileSync("agent-key.json", "utf-8"));
const agentKeypair = Keypair.fromSecretKey(Uint8Array.from(secret));

// Autonomous Agent Configuration & State
const AGENT_CONFIG = {
  name: "BioByte-Autonomous-Agent-01",
  maxBudgetLamports: 2000000, // Maximum budget: 0.002 SOL
};

async function runAutonomousAgent() {
  console.log(`\n🤖 [AGENT INITIALIZATION] ${AGENT_CONFIG.name}`);
  console.log(`💳 Wallet Public Key: ${agentKeypair.publicKey.toBase58()}`);
  
  const balance = await connection.getBalance(agentKeypair.publicKey);
  console.log(`💰 Current Balance: ${balance / 1e9} SOL`);

  const targetUrl = "http://localhost:4020/api/v1/deaddrop/intel";
  console.log(`\n🔍 Requesting Intel Endpoint: ${targetUrl}...`);

  let paymentDetails: any = null;

  // Step 1: Probe Endpoint for x402 Price Details
  try {
    const res = await fetch(targetUrl);
    if (res.status === 402) {
      const data = await res.json();
      console.log("\n⚡ [HTTP 402 INTERCEPTED] Payment Required Header Detected!");
      paymentDetails = data.paymentDetails;
      console.log(`   └─ Network: ${paymentDetails.network}`);
      console.log(`   └─ Recipient: ${paymentDetails.recipient}`);
      console.log(`   └─ Price: ${paymentDetails.amountLamports} Lamports (${paymentDetails.amountLamports / 1e9} SOL)`);
      console.log(`   └─ Quote memo: ${paymentDetails.memo}`);
    } else {
      console.log("Unexpected response status:", res.status);
      return;
    }
  } catch (error: any) {
    console.error("❌ Unexpected Error Probing Endpoint:", error.message);
    return;
  }

  // Step 2: Autonomous Decision Evaluation Loop
  console.log("\n🧠 [AGENT EVALUATION LOOP] Analyzing deal parameters...");
  const requestedPrice = paymentDetails.amountLamports;

  if (requestedPrice > AGENT_CONFIG.maxBudgetLamports) {
    console.log(`❌ [DECISION: REJECTED] Price (${requestedPrice}) exceeds max budget threshold (${AGENT_CONFIG.maxBudgetLamports}). Transaction cancelled.`);
    return;
  }

  if (balance < requestedPrice) {
    console.log(`❌ [DECISION: REJECTED] Insufficient wallet balance for execution.`);
    return;
  }

  console.log(`✅ [DECISION: APPROVED] Price is within budget (${requestedPrice} <= ${AGENT_CONFIG.maxBudgetLamports} Lamports). Executing M2M payment...`);

  // Step 3: Execute On-Chain Solana Payment
  const recipientPubkey = new PublicKey(paymentDetails.recipient);
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: agentKeypair.publicKey,
      toPubkey: recipientPubkey,
      lamports: requestedPrice,
    }),
    new TransactionInstruction({
      keys: [],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(paymentDetails.memo, "utf8"),
    }),
  );

  console.log("🚀 Broadcasting transaction to Solana Devnet...");
  const signature = await sendAndConfirmTransaction(connection, transaction, [agentKeypair]);
  console.log(`🎉 Payment Confirmed! Tx Signature: ${signature}`);

  // Step 4: Submit Payment Signature & Claim Unlocked Intel Payload
  console.log("\n🔓 Submitting Proof of Payment to Unlock Vault...");
  try {
    const res = await fetch(targetUrl, {
      method: "GET",
      headers: {
        "payment-signature": signature,
      },
    });

    const responseBody: unknown = await res.json();
    if (!res.ok) {
      console.error(`❌ Unlock request failed (HTTP ${res.status}):`, responseBody);
      return;
    }

    console.log("\n✨ ================= DATA UNLOCKED ================= ✨");
    console.dir(responseBody, { depth: null, colors: true });
    console.log("========================================================\n");

    if (replayDemoEnabled) {
      console.log("🔁 [REPLAY DEMO] Resubmitting the same payment signature...");
      const replayResponse = await fetch(targetUrl, {
        headers: { "payment-signature": signature },
      });
      const replayBody: unknown = await replayResponse.json();
      if (!replayResponse.ok) {
        console.log(`✅ Server rejected the replay (HTTP ${replayResponse.status}):`, replayBody);
      } else {
        console.error("❌ Replay was unexpectedly accepted by the server.");
      }
    }
  } catch (error: any) {
    console.error("❌ Settlement Error:", error.message);
  }
}

runAutonomousAgent();