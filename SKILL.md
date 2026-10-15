---
name: ape-check
description: Check any token contract address in seconds and get one card with holders, liquidity, deployer, socials and vibes. Use when the user pastes a contract address, asks "is this a rug", "ape-check <address>", or "/ape-check".
---

# /ape-check

1. Take the contract address from the user's message (EVM `0x…` or Solana base58). If they named a chain, pass it as `--chain <dexscreener chain id>` (e.g. `robinhood`, `base`, `solana`, `bsc`, `ethereum`).
2. Run:

   ```bash
   node "${CLAUDE_SKILL_DIR}/ape-check.mjs" <address> [--chain <chain>] --png ape-check.png
   ```

   Add `--json` instead when you need the raw numbers.
3. Show the card exactly as printed, then one or two lines of your own on the flags (✗) only if there are any. Don't add numbers the card didn't show, and don't predict price.

Data: DexScreener (pairs, liquidity, volume, socials) and GeckoTerminal (holders, top-10 share, honeypot, mint/freeze authority, deployer and its holding, launchpad), plus a public RPC for the deployer's tx count where one is available. No API keys. If a source has nothing for the token, the card says so instead of guessing.
