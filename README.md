# /ape-check

A Claude Code skill. Paste a contract address and get one card: holders, liquidity, deployer, socials and vibes.

```
╭──────────────────────────────────────────────────────────╮
│ /ape-check  Humphrey Reserve ($HUMPH)                    │
│ chain      solana · 7jNwX4…pump                          │
├──────────────────────────────────────────────────────────┤
│ holders    no data                                       │
│ liquidity  $37.2K across 1 pool                          │
│ 24h        $2.52M volume · 84442 buys / 33414 sells      │
│ deployer   unknown · holds ?%                            │
│ age        2.9d                                          │
│ socials    humph.fun · x.com/humph_sol                   │
├──────────────────────────────────────────────────────────┤
│ vibes       MID                                          │
│            a couple of yellow flags. read them.          │
│            ✗ thin liquidity ($37,183)                    │
│            ✗ 2.9d old                                    │
╰──────────────────────────────────────────────────────────╯
  0.6s · dexscreener + geckoterminal
```

- One file, zero dependencies, Node 18+.
- No API keys. Data comes from DexScreener (pairs, liquidity, volume, socials), GeckoTerminal (holders, top-10 share, honeypot, mint/freeze authority, deployer, launchpad) and a public RPC for the deployer's tx count where one is available.
- Every flag shows its reason. If a source has nothing for the token, the card says so.
- No prices on the card on purpose: it's about whether the contract is sketchy, not where it's going.

## Install

```bash
git clone https://github.com/500bitcoins/ape-check ~/.claude/skills/ape-check
```

Then in Claude Code type `/ape-check <address>`, or paste a contract and ask "is this a rug?".

## Run it without Claude Code

```bash
node ape-check.mjs <address> [--chain solana|base|ethereum|bsc|arbitrum|robinhood] [--png card.png] [--json]
```

`--png` renders the card as an image with headless Chrome (set `CHROME_BIN` if Chrome isn't in the default macOS location).

## Vibes

| verdict | when |
|---|---|
| DO NOT | honeypot: you can buy, you can't sell |
| CLEAN-ISH | no red flags in the data |
| MID | one or two flags |
| TRENCHES | three or more |

Flags: live mint or freeze authority, top 10 wallets above 50%, deployer holding above 5%, liquidity under $50K, younger than 3 days, no website or socials.

## License

MIT
