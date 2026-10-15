#!/usr/bin/env node
// /ape-check: paste a contract address, get one card. Holders, liquidity, deployer, socials, vibes.
//
//   node ape-check.mjs <address> [--chain robinhood] [--png card.png] [--json]
//
// Data: DexScreener (pairs, liquidity, volume, socials), GeckoTerminal (holders, distribution, honeypot,
// deployer, launchpad), and the chain's public RPC where we know one (deployer tx count). No API keys.
// No prices on the card on purpose: this is about whether the contract is sketchy, not where it's going.
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const argv = process.argv.slice(2);
const flag = (k) => { const i = argv.indexOf(`--${k}`); return i < 0 ? null : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const addr = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1]?.startsWith('--') !== true && /^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(a));
if (!addr) { console.error('usage: ape-check <contract address> [--chain <dexscreener chain id>] [--png out.png] [--json]'); process.exit(1); }
const t0 = Date.now();

// Public RPCs for the deployer tx count, tried in order. Keyless ones rate-limit (nodeflare: 1 req/10s), so we fall
// through the list, then wait out the limit once and go round again.
const RPC = {
  robinhood: ['https://robinhood-rpc.publicnode.com', 'https://robinhood.drpc.org', 'https://4663.rpc.thirdweb.com', 'https://rpc.nodeflare.app/robinhood/public'],
  ethereum: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org'],
  base: ['https://base-rpc.publicnode.com', 'https://base.drpc.org'],
  bsc: ['https://bsc-rpc.publicnode.com', 'https://bsc.drpc.org'],
  arbitrum: ['https://arbitrum-one-rpc.publicnode.com', 'https://arbitrum.drpc.org'],
};
async function txCount(urls, who) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionCount', params: [who, 'latest'] });
  for (let round = 0; round < 2; round++) {
    for (const url of urls) {
      const r = await getJSON(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      if (typeof r?.result === 'string' && /^0x[0-9a-f]+$/i.test(r.result)) return parseInt(r.result, 16);
    }
    if (round === 0) await new Promise((res) => setTimeout(res, 10500));
  }
  return null;
}
// DexScreener chain id -> GeckoTerminal network id, where they differ.
const GT_NET = { ethereum: 'eth', arbitrum: 'arbitrum', solana: 'solana', base: 'base', bsc: 'bsc', robinhood: 'robinhood', polygon: 'polygon_pos', avalanche: 'avax' };

async function getJSON(url, opts = {}) {
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000), ...opts });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

const ds = await getJSON(`https://api.dexscreener.com/latest/dex/tokens/${addr}`);
let pairs = (ds?.pairs || []).filter((p) => p.baseToken?.address?.toLowerCase() === addr.toLowerCase());
const chain = flag('chain') || pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0]?.chainId;
if (!chain) { console.error(`no DEX pairs found for ${addr}. pass --chain if it's brand new.`); process.exit(2); }
pairs = pairs.filter((p) => p.chainId === chain).sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
const top = pairs[0] || {};

const gt = (await getJSON(`https://api.geckoterminal.com/api/v2/networks/${GT_NET[chain] || chain}/tokens/${addr.toLowerCase()}/info`))?.data?.attributes || {};
const dev = gt.developer_address || null;
let devTxs = null;
if (dev && RPC[chain]) devTxs = await txCount(RPC[chain], dev);

const sum = (k) => pairs.reduce((s, p) => s + (k(p) || 0), 0);
const liq = sum((p) => p.liquidity?.usd);
const vol24 = sum((p) => p.volume?.h24);
const buys = sum((p) => p.txns?.h24?.buys), sells = sum((p) => p.txns?.h24?.sells);
const born = Math.min(...pairs.map((p) => p.pairCreatedAt || Infinity));
const ageDays = Number.isFinite(born) ? (Date.now() - born) / 864e5 : null;
const info = top.info || {};
const socials = [...(info.websites || []).map((w) => w.url), ...(info.socials || []).map((s) => s.url)];
if (gt.twitter_handle && !socials.some((s) => /x\.com|twitter\.com/.test(s))) socials.push(`https://x.com/${gt.twitter_handle}`);
if (gt.telegram_handle) socials.push(`https://t.me/${gt.telegram_handle}`);
const h = gt.holders || {};
const top10 = h.distribution_percentage?.top_10 != null ? Number(h.distribution_percentage.top_10) : null;
const devPct = gt.developer_holding_percentage != null ? Number(gt.developer_holding_percentage) : null;

// Vibes: plain rules, every flag shows its reason.
const flags = [], greens = [];
if (gt.is_honeypot === true) flags.push('honeypot: you can buy, you can\'t sell');
if (gt.mint_authority) flags.push('mint authority still live');
if (gt.freeze_authority) flags.push('freeze authority still live');
if (top10 != null) (top10 > 50 ? flags : top10 < 30 ? greens : []).push(`top 10 wallets hold ${top10.toFixed(1)}%`);
if (devPct != null) (devPct > 5 ? flags : devPct === 0 ? greens : []).push(`deployer holds ${devPct}%`);
if (liq < 50e3) flags.push(`thin liquidity ($${Math.round(liq).toLocaleString('en-US')})`);
if (ageDays != null && ageDays < 3) flags.push(`${ageDays < 1 ? `${Math.round(ageDays * 24)}h` : `${ageDays.toFixed(1)}d`} old`);
if (!socials.length) flags.push('no website or socials');
if (gt.gt_verified) greens.push('GeckoTerminal verified');
if (gt.launchpad_details?.completed) greens.push('graduated its launchpad');
const verdict = flags.some((f) => f.startsWith('honeypot')) ? 'DO NOT' : flags.length === 0 ? 'CLEAN-ISH' : flags.length <= 2 ? 'MID' : 'TRENCHES';
const line = { 'DO NOT': 'it\'s a trap. close the tab.', 'CLEAN-ISH': 'no red flags in the data. still a coin.', MID: 'a couple of yellow flags. read them.', TRENCHES: 'the trenches are calling. let it ring.' }[verdict];

const usd = (n) => `$${n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : Math.round(n)}`;
const short = (a) => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : 'unknown';
const card = {
  token: `${gt.name || top.baseToken?.name || '?'} ($${gt.symbol || top.baseToken?.symbol || '?'})`,
  chain, address: addr,
  holders: { count: h.count ?? null, top10, '11_30': h.distribution_percentage?.['11_30'] != null ? Number(h.distribution_percentage['11_30']) : null },
  liquidity: { usd: liq, pools: pairs.length, main: top.dexId ? `${top.dexId}${top.labels?.length ? ' ' + top.labels.join('/') : ''} ${top.baseToken?.symbol}/${top.quoteToken?.symbol}` : null, vol24, buys, sells },
  deployer: { address: dev, holds_pct: devPct, txs_sent: devTxs, launchpad: gt.launchpad_details?.completed ? `graduated ${gt.launchpad_details.completed_at?.slice(0, 10)}` : null },
  age_days: ageDays, socials, gt_score: gt.gt_score ?? null, honeypot: gt.is_honeypot ?? null,
  vibes: { verdict, line, flags, greens }, seconds: (Date.now() - t0) / 1000,
};

if (flag('json')) { console.log(JSON.stringify(card, null, 2)); process.exit(0); }

const W = 58, c = (n, s) => `\x1b[${n}m${s}\x1b[0m`, pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.replace(/\x1b\[[0-9;]*m/g, '').length));
const row = (k, v) => `│ ${pad(c('2', k.padEnd(11)) + v, W - 2)} │`;
const vcol = { 'DO NOT': '41;97', 'CLEAN-ISH': '42;30', MID: '43;30', TRENCHES: '45;97' }[verdict];
const out = [
  `╭${'─'.repeat(W)}╮`,
  `│ ${pad(c('1', `/ape-check  ${card.token}`), W - 2)} │`,
  row('chain', `${chain} · ${short(addr)}`),
  `├${'─'.repeat(W)}┤`,
  row('holders', h.count != null ? `${h.count.toLocaleString('en-US')} · top 10 hold ${top10?.toFixed(1)}%` : 'no data'),
  row('liquidity', `${usd(liq)} across ${pairs.length} pool${pairs.length === 1 ? '' : 's'}`),
  row('24h', `${usd(vol24)} volume · ${buys} buys / ${sells} sells`),
  row('deployer', `${short(dev)} · holds ${devPct ?? '?'}%${devTxs != null ? ` · ${devTxs} txs` : ''}`),
  ...(card.deployer.launchpad ? [row('', card.deployer.launchpad)] : []),
  row('age', ageDays != null ? `${ageDays < 1 ? Math.round(ageDays * 24) + 'h' : (ageDays < 3 ? ageDays.toFixed(1) : Math.floor(ageDays)) + 'd'}` : '?'),
  row('socials', socials.length ? socials.map((s) => s.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')).join(' · ').slice(0, W - 14) : c('31', 'none')),
  `├${'─'.repeat(W)}┤`,
  row('vibes', c(vcol, ` ${verdict} `)),
  row('', line),
  ...flags.map((f) => row('', c('31', `✗ ${f}`))),
  ...greens.map((g) => row('', c('32', `✓ ${g}`))),
  `╰${'─'.repeat(W)}╯`,
  c('2', `  ${card.seconds.toFixed(1)}s · dexscreener + geckoterminal${devTxs != null ? ' + rpc' : ''}`),
];
console.log(out.join('\n'));

const png = flag('png');
if (png) await renderPng(png === true ? 'ape-check.png' : png, card);

async function renderPng(file, d) {
  const esc = (s) => String(s ?? '').replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[m]);
  const vbg = { 'DO NOT': '#e5484d', 'CLEAN-ISH': '#30a46c', MID: '#f5a524', TRENCHES: '#8e4ec6' }[d.vibes.verdict];
  const r = (k, v) => `<div class="r"><span class="k">${k}</span><span>${v}</span></div>`;
  const html = `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;background:#0b0d10;font:22px/1.45 "SF Mono",Menlo,monospace;color:#e6e6e6}
  .c{box-sizing:border-box;width:1000px;margin:40px;border:2px solid #2a2f36;border-radius:18px;padding:32px 38px;background:#11141a}
  h1{font-size:30px;margin:0 0 4px}.sub{color:#7d8590;margin-bottom:18px}.r{display:flex;gap:18px;padding:6px 0;border-top:1px solid #1e232a}
  .k{color:#7d8590;width:150px;flex:none}.v{display:inline-block;background:${vbg};color:#fff;font-weight:700;padding:2px 12px;border-radius:6px;margin-right:12px}
  .f{color:#ff6369}.g{color:#3dd68c}.ft{color:#5c636b;font-size:18px;margin-top:16px}</style>
  <div class="c"><h1>/ape-check &nbsp;${esc(d.token)}</h1><div class="sub">${esc(d.chain)} · ${esc(d.address)}</div>
  ${r('holders', d.holders.count != null ? `${d.holders.count.toLocaleString('en-US')} · top 10 hold ${d.holders.top10?.toFixed(1)}%` : 'no data')}
  ${r('liquidity', `${usd(d.liquidity.usd)} across ${d.liquidity.pools} pool${d.liquidity.pools === 1 ? '' : 's'}`)}
  ${r('24h', `${usd(d.liquidity.vol24)} volume · ${d.liquidity.buys} buys / ${d.liquidity.sells} sells`)}
  ${r('deployer', `${esc(short(d.deployer.address))} · holds ${d.deployer.holds_pct ?? '?'}%${d.deployer.txs_sent != null ? ` · ${d.deployer.txs_sent} txs` : ''}${d.deployer.launchpad ? ` · ${esc(d.deployer.launchpad)}` : ''}`)}
  ${r('age', d.age_days != null ? (d.age_days < 1 ? Math.round(d.age_days * 24) + 'h' : (d.age_days < 3 ? d.age_days.toFixed(1) : Math.floor(d.age_days)) + 'd') : '?')}
  ${r('socials', d.socials.length ? esc(d.socials.map((s) => s.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')).join(' · ')) : '<span class="f">none</span>')}
  ${r('vibes', `<div><span class="v">${d.vibes.verdict}</span>${esc(d.vibes.line)}${d.vibes.flags.map((f) => `<div class="f">✗ ${esc(f)}</div>`).join('')}${d.vibes.greens.map((g) => `<div class="g">✓ ${esc(g)}</div>`).join('')}</div>`)}
  <div class="ft">${d.seconds.toFixed(1)}s · dexscreener + geckoterminal${d.deployer.txs_sent != null ? ' + rpc' : ''}</div></div>`;
  const dir = mkdtempSync(join(tmpdir(), 'ape-'));
  writeFileSync(join(dir, 'c.html'), html);
  const chrome = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  await new Promise((res) => spawn(chrome, ['--headless=new', '--hide-scrollbars', `--user-data-dir=${dir}/p`, `--window-size=1080,${Math.round(600 + 34 * (d.vibes.flags.length + d.vibes.greens.length))}`, '--force-device-scale-factor=2', `--screenshot=${file}`, `file://${dir}/c.html`], { stdio: 'ignore' }).on('exit', res));
  rmSync(dir, { recursive: true, force: true });
  console.log(`card → ${file}`);
}
