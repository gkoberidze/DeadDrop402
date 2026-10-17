# DeadDrop402

### Data access for autonomous agents—paid for on demand.

**DeadDrop402** is an autonomous machine-to-machine (M2M) data exchange prototype for Solana. It uses the HTTP `402 Payment Required` response to tell an AI agent what a protected resource costs, then unlocks the payload after the agent makes a micropayment on-chain.

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Solana](https://img.shields.io/badge/Solana-Devnet-9945FF?logo=solana&logoColor=white)](https://solana.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-ESM-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-UI-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)

> **Hackathon project / Devnet demo.** This repository demonstrates a payment-gated API flow. It is not production-ready payment infrastructure.

## The problem

AI agents can request APIs, compare data, and take action—but conventional online checkout is built for people. Credit cards, human OAuth consent, and interactive checkout pages interrupt autonomous workflows and make small, real-time data purchases difficult to coordinate.

## The solution

DeadDrop402 combines an HTTP payment challenge with a Solana Devnet transfer. A server responds to an unpaid request with the payment details; the agent pays from its wallet and retries with the transaction signature.

### The 4-step exchange

1. **Request** — The agent requests a protected resource.
2. **HTTP 402 intercept** — The server returns `402 Payment Required` and a payment quote, including the recipient, asset, network, and amount.
3. **On-chain micropayment** — The agent signs and submits a SOL transfer on Solana Devnet.
4. **Payload unlock** — The agent retries with the transaction signature in the `payment-signature` header; the server looks up the transaction and returns the protected payload.

In the current demo, the quoted price is **0.001 SOL** (`1,000,000` lamports).

## Features

- **Autonomous M2M purchasing** — The example agent handles the challenge, payment, and retry without a human checkout.
- **Low-friction payments** — Pay per request with a native SOL transfer instead of a card-based flow.
- **Live dashboard** — View the recipient wallet and recent protocol events at `http://localhost:4020`.
- **Idempotency groundwork** — Solana transaction signatures provide stable identifiers for a future replay-safe settlement flow. **The current demo does not persist processed signatures or prevent duplicate unlocks.**
- **Devnet-first** — Test with Devnet SOL; no mainnet funds are required.

## Architecture

```text
┌────────────────────┐      GET protected data       ┌──────────────────────┐
│                    │ ─────────────────────────────> │                      │
│   AI Agent Client  │ <───────────────────────────── │   DeadDrop Server    │
│                    │       402 + payment quote      │  Express / HTTP API  │
└─────────┬──────────┘                                └──────────┬───────────┘
          │                                                      │
          │ SOL transfer on Devnet                               │ Look up
          │                                                      │ transaction
          ▼                                                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                              Solana Devnet                               │
└──────────────────────────────────────────────────────────────────────────┘

Agent retries with `payment-signature` ───────────────────────> Server
Agent receives protected payload       <─────────────────────── Server
```

The dashboard is served by the DeadDrop server and polls its in-memory event feed once per second.

## Quickstart

### Prerequisites

- [Node.js](https://nodejs.org/) **v18 or later**
- npm (included with Node.js)
- A network connection to Solana Devnet

### 1. Install dependencies

From the repository root:

```bash
npm install
```

### 2. Generate demo wallets

Create a server recipient keypair and an agent payer keypair:

```bash
npm run setup
```

The setup script writes `server-key.json` and `agent-key.json` in the project root and prints the agent's public address. Request **Devnet SOL** for that agent address from the [Solana Faucet](https://faucet.solana.com/). The agent needs enough SOL for the **0.001 SOL payment plus transaction fees**.

> **Wallet safety:** These JSON files contain secret keys in plaintext. Keep them local, never share them, and do not commit them to source control. Use throwaway wallets with no real funds.

### 3. Start the server

In one terminal:

```bash
npm run server
```

The API and dashboard are available at `http://localhost:4020`.

### 4. Run the AI agent client

In a second terminal, from the project root:

```bash
npm run client
```

The agent requests the protected endpoint, submits the Devnet payment, then retries with the resulting transaction signature.

### 5. Watch the dashboard

Open **[http://localhost:4020](http://localhost:4020)** to see the server wallet and live protocol events.

## API reference

### `GET /api/v1/deaddrop/intel`

Without a `payment-signature` header, the endpoint responds with HTTP `402` and a payment quote:

```json
{
  "error": "402 Payment Required",
  "protocol": "x402-solana-v2",
  "message": "Autonomous data purchase required.",
  "paymentDetails": {
    "network": "solana-devnet",
    "recipient": "<server-wallet-public-key>",
    "amountLamports": 1000000,
    "asset": "SOL"
  }
}
```

After payment, retry the same endpoint with the transaction signature:

```http
GET /api/v1/deaddrop/intel HTTP/1.1
Host: localhost:4020
payment-signature: <solana-transaction-signature>
```

The demo returns the protected data when it finds a transaction for that signature.

### `GET /api/v1/logs`

Returns the latest server-side protocol events and the server's public key. The dashboard uses this endpoint; the event log is held in memory and is not persistent.

## Tech stack

| Area | Technologies |
| --- | --- |
| Runtime | Node.js 18+ |
| API server | Express 4, TypeScript, ESM |
| Solana | `@solana/web3.js`, Solana Devnet |
| Dashboard | HTML, Tailwind CSS, vanilla JavaScript |

## Roadmap

- [ ] Add configurable, dynamic pricing models.
- [ ] Support SPL tokens, including USDC, in addition to native SOL.
- [ ] Enable multi-agent data bidding and offer selection.
- [ ] Persist settlement records and enforce replay protection.
- [ ] Validate transaction success, payer, recipient, and exact payment amount before releasing data.

## Prototype limitations

This project is an educational hackathon demo. **Do not use it to protect valuable data or accept real payments.** The current server checks that a transaction can be looked up, but does not verify that it succeeded or that it paid the required amount to the expected recipient. It also does not prevent reusing a transaction signature. The event feed is in-memory, and the demo wallets are stored as plaintext JSON files.

## License

No license is currently specified. Until a license is added, the project is not explicitly licensed for reuse or redistribution.
