import { Connection, Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } from "@solana/web3.js";
import fs from "fs";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");

async function executeAgentFlow() {
  if (!fs.existsSync("agent-key.json")) {
    console.error("❌ Run 'npm run setup' first to generate keypair files!");
    return;
  }

  const agentSecret = JSON.parse(fs.readFileSync("agent-key.json", "utf-8"));
  const agentKeypair = Keypair.fromSecretKey(Uint8Array.from(agentSecret));

  console.log("\n🤖 [AI Agent] Requesting data from DeadDrop Server...");
  console.log(`🔑 Agent Address: ${agentKeypair.publicKey.toBase58()}`);

  // Step 1: Request Endpoint (Triggers 402)
  let response = await fetch("http://localhost:4020/api/v1/deaddrop/intel");

  if (response.status === 402) {
    const errorData = await response.json();
    console.log("\n⚠️ [HTTP 402 INTERCEPTED] Payment required to access endpoint.");
    console.log("💳 Details:", errorData.paymentDetails);

    // Step 2: Build & Sign Solana Micropayment
    console.log("\n⚡ [Solana Devnet] Signing micropayment transaction...");
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: agentKeypair.publicKey,
        toPubkey: new PublicKey(errorData.paymentDetails.recipient),
        lamports: errorData.paymentDetails.amountLamports,
      })
    );

    try {
      const signature = await sendAndConfirmTransaction(connection, transaction, [agentKeypair]);
      console.log(`✅ On-Chain Settlement Confirmed! Tx Signature:`);
      console.log(`🔗 https://explorer.solana.com/tx/${signature}?cluster=devnet`);

      // Step 3: Retry Request with PAYMENT-SIGNATURE header
      console.log("\n🔓 [Re-Authenticating] Submitting x402 Header Proof...");
      response = await fetch("http://localhost:4020/api/v1/deaddrop/intel", {
        headers: {
          "payment-signature": signature,
        },
      });

      const payload = await response.json();
      console.log("\n🎉 [200 OK] Ephemeral Secret Unlocked:");
      console.log(JSON.stringify(payload, null, 2));
    } catch (err: any) {
      console.error("❌ Solana Transaction Failed! Make sure agent wallet has Devnet SOL gas.");
      console.error(err.message);
    }
  }
}

executeAgentFlow();