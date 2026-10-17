import { Keypair } from "@solana/web3.js";
import fs from "fs";

const serverKey = Keypair.generate();
const agentKey = Keypair.generate();

console.log("=== NULLPROTOCOL WALLET INITIALIZATION ===");
console.log("Server Public Key (Recipient):", serverKey.publicKey.toBase58());
console.log("AI Agent Public Key (Payer):   ", agentKey.publicKey.toBase58());

fs.writeFileSync("server-key.json", JSON.stringify(Array.from(serverKey.secretKey)));
fs.writeFileSync("agent-key.json", JSON.stringify(Array.from(agentKey.secretKey)));

console.log("\n✅ Keypairs saved to server-key.json and agent-key.json");
console.log(`\n👉 Request Devnet SOL for your agent wallet at https://faucet.solana.com/ with pubkey: ${agentKey.publicKey.toBase58()}`);