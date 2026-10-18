# DeadDrop402

### Data access for autonomous agents—paid for on demand.

**DeadDrop402** is an autonomous machine-to-machine (M2M) data exchange prototype for Solana. It uses HTTP `402 Payment Required` to tell an AI agent what a protected resource costs, then unlocks the payload after the agent makes a verifiable, quote-bound micropayment on-chain.

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Solana](https://img.shields.io/badge/Solana-Devnet-9945FF?logo=solana&logoColor=white)](https://solana.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-ESM-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-UI-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)

> **Hackathon project / Devnet demo.** The implementation demonstrates a payment-gated API flow. It is not audited or intended for production payments.

## The problem

AI agents can request APIs, compare data, and take action—but conventional online checkout is built for people. Credit cards, human OAuth consent, and interactive checkout pages interrupt autonomous workflows and make small, real-time data purchases difficult to coordinate.

## The solution

DeadDrop402 combines an HTTP payment challenge with a native SOL transfer on Solana Devnet. An unpaid request receives a quote with a unique memo nonce. The agent makes a transfer containing that nonce and retries with its transaction signature. The server checks the transaction on-chain before returning the resource.

### The 4-step exchange

1. **Request** — The agent requests a protected resource.
2. **HTTP 402 intercept** — The server returns `402 Payment Required` with recipient, asset, network, amount, and a short-lived quote memo.
3. **On-chain micropayment** — The agent submits a SOL transfer and Memo program instruction on Solana Devnet.
4. **Payload unlock** — The agent retries with the transaction signature in the `payment-signature` header. The server checks transaction status and age, validates the transfer and memo, and returns the payload if valid.

The current quote is **0.001 SOL** (`1,000,000` lamports) and expires after five minutes.

## Features

- **Autonomous M2M purchasing** — The example agent handles the 402 challenge, payment, and retry without a human checkout.
- **On-chain payment verification** — Checks transaction success, a system transfer to the configured server wallet, the required amount, and the recipient balance increase.
- **Quote binding** — A random, expiring memo nonce binds the payment to the issued quote and is consumed after successful unlock.
- **Replay protection** — Signatures are reserved before asynchronous verification, rejected if already in use, and retained after successful unlock. Failed verification releases the reservation for a legitimate retry.
- **Fresh payments** — Transactions older than five minutes are rejected.
- **Multi-agent swarm demo** — Three autonomous buyer profiles evaluate the same fixed-price offer against different budgets and make sequential real Devnet purchases using the configured demo wallet.
- **Live dashboard** — Shows successful unlocks, confirmed payment volume, served agent profiles, server wallet, and a live protocol event feed at `http://localhost:4020`.
- **XSS-safe log rendering** — Dashboard event values are assigned through DOM `textContent`, not inserted as HTML.
- **Live payload metrics** — SOL/USD is fetched from CoinGecko with a three-second timeout and fallback; TPS is calculated from Solana Devnet performance samples.
- **No fabricated liquidity metric** — Liquidity depth is explicitly reported as unavailable until a real data source is integrated.

## Architecture

```text
┌────────────────────┐    request / 402 quote     ┌──────────────────────┐
│                    │ ─────────────────────────> │                      │
│   AI Agent Client  │ <───────────────────────── │   DeadDrop Server    │
│                    │                            │   Express / API      │
└─────────┬──────────┘                            └──────────┬───────────┘
          │                                                   │
          │ SOL transfer + quote memo                        │ Verify signature,
          │                                                   │ transfer, memo
          ▼                                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                              Solana Devnet                               │
└──────────────────────────────────────────────────────────────────────────┘

Agent retries with `payment-signature` ───────────────────────> Server
Agent receives protected payload       <─────────────────────── Server

Dashboard ── polls `/api/v1/logs` every second ────────────────> Server
```

## Quickstart

### Prerequisites

- [Node.js](https://nodejs.org/) **v18 or later**
- npm (included with Node.js)
- A connection to Solana Devnet

### Install dependencies

```bash
npm install
```

### Generate demo wallets

```bash
npm run setup
```

This creates `server-key.json` and `agent-key.json` in the project root and prints the agent's public address. Request **Devnet SOL** for that address from the [Solana Faucet](https://faucet.solana.com/). A single purchase needs slightly more than 0.001 SOL for the payment and transaction fees. The three-agent swarm makes three real purchases, so fund the demo wallet with at least 0.004 SOL first.

> **Wallet safety:** These files contain private keys in plaintext. Keep them local, do not share or commit them, and use throwaway wallets with no real funds.

## Demo

Run the server in one terminal:

```bash
npm run server
```

Then, from the project root, run the agent in another terminal:

```bash
npm run client
```

To demonstrate replay protection after a successful unlock:

```bash
npm run client -- --replay
```

To run the three-profile autonomous buying demo:

```bash
npm run swarm
```

The profiles (`MarketScout`, `ChainWatcher`, and `RiskAnalyst`) run sequentially, each requesting a fresh quote, checking its own budget, paying on Devnet, and unlocking the protected intel. This demonstrates independent agent policies—not a bidding market—and the profiles share the same throwaway payer wallet. Open **[http://localhost:4020](http://localhost:4020)** to watch purchase totals, volume, agent status, and protocol events update live.

## API reference

### `GET /api/v1/deaddrop/intel`

Without a `payment-signature` header, the endpoint returns HTTP `402` with a payment quote:

```json
{
  "error": "402 Payment Required",
  "protocol": "x402-solana-v2",
  "message": "Autonomous data purchase required.",
  "paymentDetails": {
    "network": "solana-devnet",
    "recipient": "<server-wallet-public-key>",
    "amountLamports": 1000000,
    "asset": "SOL",
    "memo": "<unique-quote-nonce>"
  }
}
```

The agent must submit a Devnet transaction with both a system transfer of at least the quoted amount to the recipient and a Memo program instruction containing the quote nonce. It then retries:

```http
GET /api/v1/deaddrop/intel HTTP/1.1
Host: localhost:4020
payment-signature: <solana-transaction-signature>
```

The client optionally sends `x-agent-name` so the dashboard can label each buyer profile. It is a display label, not an authenticated identity.

The server rejects malformed or reused signatures, failed or unavailable transactions, payments older than five minutes, missing or expired quote memos, recipient/amount mismatches, and insufficient recipient balance increases.

### `GET /api/v1/logs`

Returns the recent in-memory event feed, server public key, and aggregate purchase statistics. The dashboard polls this endpoint every 1.5 seconds.

## Tech stack

| Area | Technologies |
| --- | --- |
| Runtime | Node.js 18+ |
| API server | Express 4, TypeScript, ESM |
| Solana | `@solana/web3.js`, Solana Devnet |
| Dashboard | HTML, Tailwind CSS, vanilla JavaScript |

## Roadmap

- [ ] Persist used signatures and quote state so replay protection survives server restarts.
- [ ] Add SPL token payments, including USDC.
- [ ] Give each agent profile its own wallet and support independent funding.
- [ ] Support multi-agent data bidding and offer selection.
- [ ] Add configurable, dynamic pricing models.
- [ ] Harden and independently audit transaction verification before any production use.

## Prototype limitations

DeadDrop402 is an educational prototype. **Do not use it to protect valuable data or accept real payments.**

- **Devnet only:** The RPC endpoint and payment flow target Solana Devnet.
- **SOL only:** Payments use native SOL; SPL tokens and USDC are not supported.
- **In-memory state:** Used signatures, quote nonces, and dashboard logs are lost when the server restarts.
- **Price fallback:** If CoinGecko is unavailable or times out after three seconds, the payload uses a fallback SOL/USD value of `$142.50`.
- **TPS availability:** TPS is derived from recent Devnet performance samples; it is `0` if the RPC returns no samples.
- **Liquidity depth:** Not integrated; the payload reports `Not available`.
- **Demo wallets:** Keypairs are stored in plaintext JSON files. Use throwaway Devnet wallets only.
- **Not audited:** Transaction parsing, RPC availability, and the overall payment protocol need additional hardening and review before production use.

## License

This project is licensed under the [MIT License](./LICENSE).
