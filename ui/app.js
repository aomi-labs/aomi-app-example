/* ============================================================
   Hyperliquid × Aomi — Trading Intelligence
   Zero-build vanilla JS. Synthetic Hyperliquid market data +
   hand-rolled Aomi agent with tool-call → dashboard pulse.
   ============================================================ */

/* ---------- seeded RNG so each asset is stable per load ---------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- market definitions ---------- */
const MARKETS = {
  BTC: { name: 'BTC-PERP', px: 68421.5, chg: 2.34,  funding: 0.0118, dec: 1, tick: 0.5,  sizeMul: 1,    seed: 11 },
  ETH: { name: 'ETH-PERP', px: 3284.70, chg: -1.12, funding: 0.0091, dec: 2, tick: 0.05, sizeMul: 14,   seed: 23 },
  SOL: { name: 'SOL-PERP', px: 172.36,  chg: 5.81,  funding: 0.0203, dec: 3, tick: 0.01, sizeMul: 260,  seed: 37 },
  ARB: { name: 'ARB-PERP', px: 0.8421,  chg: -3.04, funding: -0.0042, dec: 4, tick: 0.0001, sizeMul: 52000, seed: 53 },
};

let current = 'BTC';
const state = {}; // per-asset computed snapshot

/* ---------- build a full snapshot for an asset ---------- */
function buildSnapshot(sym) {
  const m = MARKETS[sym];
  const rnd = mulberry32(m.seed);
  const px = m.px;

  // sparkline: 64 points, drift toward sign of change
  const pts = [];
  let v = px / (1 + m.chg / 100);          // ~open
  const open = v;
  const drift = (px - open) / 64;
  for (let i = 0; i < 64; i++) {
    v += drift + (rnd() - 0.5) * px * 0.0028;
    pts.push(v);
  }
  pts[pts.length - 1] = px;

  // order book: 12 levels each side around mid
  const levels = 12;
  const asks = [], bids = [];
  let aCum = 0, bCum = 0;
  for (let i = 0; i < levels; i++) {
    const gap = m.tick * (i + 1) * (1 + Math.floor(i / 3));
    const aSz = (0.4 + rnd() * 2.6) * m.sizeMul;
    const bSz = (0.4 + rnd() * 2.6) * m.sizeMul;
    aCum += aSz; bCum += bSz;
    asks.push({ price: px + gap + m.tick, size: aSz, cum: aCum });
    bids.push({ price: px - gap, size: bSz, cum: bCum });
  }
  const maxCum = Math.max(aCum, bCum);
  const bestAsk = asks[0].price, bestBid = bids[0].price;
  const spread = bestAsk - bestBid;

  // funding history: 24 hourly bars around current funding
  const fund = [];
  for (let i = 0; i < 24; i++) {
    const base = m.funding;
    const noise = (rnd() - 0.5) * 0.046;
    fund.push(base + noise + Math.sin(i / 2.3 + m.seed) * 0.012);
  }
  fund[fund.length - 1] = m.funding;

  return { sym, m, px, open, chg: m.chg, pts, asks, bids, maxCum, bestAsk, bestBid, spread, fund };
}

/* ---------- formatting ---------- */
const fmt = (n, d) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
function priceHTML(n, d) {
  const s = fmt(n, d);
  const dot = s.indexOf('.');
  if (dot === -1) return s;
  return s.slice(0, dot) + '<span class="cents">' + s.slice(dot) + '</span>';
}
const fmtSize = (n) => n >= 1000 ? (n / 1000).toFixed(1) + 'K' : (n >= 100 ? n.toFixed(0) : n.toFixed(2));
const signPct = (n) => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

/* ============================================================
   RENDERERS
   ============================================================ */
function renderHero(s) {
  document.getElementById('heroAsset').textContent = s.m.name;
  document.getElementById('heroPrice').innerHTML = priceHTML(s.px, s.m.dec);
  const pill = document.getElementById('heroChange');
  const up = s.chg >= 0;
  pill.className = 'pill ' + (up ? 'up' : 'down');
  pill.textContent = signPct(s.chg);
  const lo = Math.min(...s.pts), hi = Math.max(...s.pts);
  document.getElementById('sparkLo').textContent = fmt(lo, s.m.dec);
  document.getElementById('sparkHi').textContent = fmt(hi, s.m.dec);
  drawSpark(s);
}

function drawSpark(s) {
  const cv = document.getElementById('spark');
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || 420, h = cv.clientHeight || 120;
  cv.width = w * dpr; cv.height = h * dpr;
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const pts = s.pts, lo = Math.min(...pts), hi = Math.max(...pts);
  const pad = 8, span = (hi - lo) || 1;
  const X = i => (i / (pts.length - 1)) * (w - 2) + 1;
  const Y = val => h - pad - ((val - lo) / span) * (h - pad * 2);
  const up = s.chg >= 0;
  const col = up ? '#97fce4' : '#f0676f';

  // area fill
  ctx.beginPath();
  ctx.moveTo(X(0), Y(pts[0]));
  for (let i = 1; i < pts.length; i++) ctx.lineTo(X(i), Y(pts[i]));
  ctx.lineTo(X(pts.length - 1), h); ctx.lineTo(X(0), h); ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, up ? 'rgba(151,252,228,0.22)' : 'rgba(240,103,111,0.20)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fill();

  // line
  ctx.beginPath();
  ctx.moveTo(X(0), Y(pts[0]));
  for (let i = 1; i < pts.length; i++) ctx.lineTo(X(i), Y(pts[i]));
  ctx.lineWidth = 1.6; ctx.strokeStyle = col; ctx.lineJoin = 'round';
  ctx.shadowColor = col; ctx.shadowBlur = 8; ctx.stroke();
  ctx.shadowBlur = 0;

  // end dot
  ctx.beginPath();
  ctx.arc(X(pts.length - 1), Y(pts[pts.length - 1]), 2.6, 0, Math.PI * 2);
  ctx.fillStyle = col; ctx.fill();
}

function renderStats(s) {
  const f = document.getElementById('statFunding');
  const up = s.m.funding >= 0;
  f.className = 'stat-value ' + (up ? 'up' : 'down');
  f.textContent = (up ? '+' : '') + (s.m.funding).toFixed(4) + '%';
  document.getElementById('statFundingFoot').textContent =
    (up ? 'longs pay shorts' : 'shorts pay longs') + ' · ' + ((s.m.funding * 24 * 365).toFixed(1)) + '% APR';

  document.getElementById('statMark').innerHTML = priceHTML(s.px + s.m.tick * 2, s.m.dec);
  const sp = document.getElementById('statSpread');
  sp.textContent = fmt(s.spread, s.m.dec);
  const bps = (s.spread / s.px) * 10000;
  document.getElementById('statSpreadFoot').textContent = bps.toFixed(1) + ' bps · ' + fmt(s.bestBid, s.m.dec) + ' / ' + fmt(s.bestAsk, s.m.dec);
}

function renderBook(s) {
  const asksEl = document.getElementById('bookAsks');
  const bidsEl = document.getElementById('bookBids');
  const row = (lv, side) => {
    const w = (lv.cum / s.maxCum) * 100;
    return `<div class="book-row">
      <div class="depth" style="width:${w}%"></div>
      <span class="bk-price">${fmt(lv.price, s.m.dec)}</span>
      <span class="bk-size">${fmtSize(lv.size)}</span>
      <span class="bk-total">${fmtSize(lv.cum)}</span>
    </div>`;
  };
  // asks shown high→low so best ask sits just above mid
  asksEl.innerHTML = s.asks.slice().reverse().map(l => row(l, 'a')).join('');
  bidsEl.innerHTML = s.bids.map(l => row(l, 'b')).join('');

  document.getElementById('midPrice').innerHTML = priceHTML((s.bestAsk + s.bestBid) / 2, s.m.dec);
  document.getElementById('midSpread').textContent = fmt(s.spread, s.m.dec);
}

function renderFunding(s) {
  const wrap = document.getElementById('fchartBars');
  const max = Math.max(...s.fund.map(Math.abs)) || 1;
  wrap.innerHTML = s.fund.map((v, i) => {
    const pct = Math.max((Math.abs(v) / max) * 48, 3); // half-height max, min sliver
    const cls = v >= 0 ? 'pos' : 'neg';
    const now = i === s.fund.length - 1 ? ' is-now' : '';
    return `<div class="fbar-col${now}" title="h-${24 - i}: ${(v).toFixed(4)}%">
      <div class="fbar ${cls}" style="height:${pct}%"></div>
    </div>`;
  }).join('');
}

function renderAll(sym) {
  const s = state[sym] || (state[sym] = buildSnapshot(sym));
  renderHero(s); renderStats(s); renderBook(s); renderFunding(s);
}

/* ============================================================
   ASSET TABS
   ============================================================ */
document.getElementById('assetTabs').addEventListener('click', e => {
  const btn = e.target.closest('.asset-tab');
  if (!btn) return;
  selectAsset(btn.dataset.asset);
});
function selectAsset(sym) {
  if (!MARKETS[sym]) return;
  current = sym;
  document.querySelectorAll('.asset-tab').forEach(t =>
    t.classList.toggle('is-active', t.dataset.asset === sym));
  renderAll(sym);
}

/* ============================================================
   TOOL-CALL PULSE
   ============================================================ */
function pulse(cardIds) {
  cardIds.forEach((id, k) => {
    const el = document.getElementById(id);
    if (!el || el.hidden) return;
    setTimeout(() => {
      el.classList.remove('pulsing');
      void el.offsetWidth;            // restart animation
      el.classList.add('pulsing');
      setTimeout(() => el.classList.remove('pulsing'), 820);
    }, k * 140);
  });
}

/* ============================================================
   WALLET LOOKUP  → account card + get_user_state pulse
   ============================================================ */
function shortAddr(a) { return a.slice(0, 6) + '…' + a.slice(-4); }
function lookupAccount(addr) {
  const seed = [...addr].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);
  const rnd = mulberry32(Math.abs(seed) || 1);
  const equity = 25000 + rnd() * 480000;
  const margin = equity * (0.12 + rnd() * 0.4);
  const pnl = (rnd() - 0.42) * equity * 0.22;
  const syms = ['BTC', 'ETH', 'SOL', 'ARB'];
  const n = 2 + Math.floor(rnd() * 2);
  const positions = [];
  for (let i = 0; i < n; i++) {
    const sym = syms[Math.floor(rnd() * syms.length)];
    const m = MARKETS[sym];
    const long = rnd() > 0.45;
    const size = (0.5 + rnd() * 9) * (m.px < 5 ? 4000 : m.px < 300 ? 40 : 1);
    const upnl = (rnd() - 0.4) * equity * 0.06;
    positions.push({ sym, long, size, entry: m.px * (1 + (rnd() - 0.5) * 0.04), upnl });
  }

  document.getElementById('acctAddr').textContent = shortAddr(addr);
  document.getElementById('acctSummary').innerHTML = `
    <div class="acct-cell"><div class="k">Account equity</div><div class="v">$${fmt(equity, 0)}</div></div>
    <div class="acct-cell"><div class="k">Margin used</div><div class="v">$${fmt(margin, 0)}</div></div>
    <div class="acct-cell"><div class="k">Unrealized PnL</div><div class="v" style="color:${pnl >= 0 ? 'var(--mint)' : 'var(--down)'}">${pnl >= 0 ? '+' : '−'}$${fmt(Math.abs(pnl), 0)}</div></div>`;
  document.getElementById('acctPositions').innerHTML =
    `<div class="pos-row head"><span>Side</span><span class="sym">Market</span><span>Size</span><span>Entry</span><span>uPnL</span></div>` +
    positions.map(p => `<div class="pos-row">
      <span class="side ${p.long ? 'long' : 'short'}">${p.long ? 'LONG' : 'SHORT'}</span>
      <span class="sym">${p.sym}</span>
      <span>${fmtSize(p.size)}</span>
      <span>${fmt(p.entry, MARKETS[p.sym].dec)}</span>
      <span class="pnl ${p.upnl >= 0 ? 'up' : 'down'}">${p.upnl >= 0 ? '+' : '−'}$${fmt(Math.abs(p.upnl), 0)}</span>
    </div>`).join('');

  const card = document.getElementById('card-account');
  card.hidden = false;
  card.scrollIntoView ? null : null;
  document.querySelector('.dash-scroll').scrollTo({ top: document.querySelector('.dash-scroll').scrollHeight, behavior: 'smooth' });
  return { equity, pnl, positions };
}

document.getElementById('walletForm').addEventListener('submit', e => {
  e.preventDefault();
  const v = document.getElementById('walletInput').value.trim();
  const addr = /^0x[0-9a-fA-F]{6,}$/.test(v) ? v : '0x' + (v || '7a3f').replace(/[^0-9a-fA-F]/g, '').padEnd(40, '4e21d9b0c5a8f3e2761049ac').slice(0, 40);
  lookupAccount(addr);
  pulse(['card-account']);
});

/* ============================================================
   AOMI AGENT
   ============================================================ */
const chatLog = document.getElementById('chatLog');

function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }
function scrollChat() { chatLog.scrollTo({ top: chatLog.scrollHeight, behavior: 'smooth' }); }
/* append + guarantee the element settles visible even if the entrance
   animation is throttled/paused (e.g. background tab or capture) */
function place(node) { chatLog.appendChild(node); setTimeout(() => node.classList.remove('msg-enter'), 380); scrollChat(); return node; }

function addUser(text) {
  const m = el(`<div class="msg user msg-enter"><div class="bubble"></div></div>`);
  m.querySelector('.bubble').textContent = text;
  place(m);
}
function addTyping() {
  const m = el(`<div class="msg bot msg-enter" data-typing="1"><div class="bubble typing"><i></i><i></i><i></i></div></div>`);
  place(m); return m;
}

/* intent → which tool, which cards pulse, and a reply built from live data */
function resolve(text) {
  const t = text.toLowerCase();
  let sym = (t.match(/\b(btc|eth|sol|arb)\b/) || [])[1];
  sym = sym ? sym.toUpperCase() : null;
  const target = sym || current;

  // wallet
  const addrMatch = text.match(/0x[0-9a-fA-F]{4,}/);
  if (addrMatch || /\b(wallet|account|whale|position|holdings|portfolio)\b/.test(t)) {
    return { kind: 'account', tool: 'get_user_state', cards: ['card-account'], sym: null, addr: addrMatch ? addrMatch[0] : null };
  }
  if (/\b(fund|funding|apr|carry)\b/.test(t))
    return { kind: 'funding', tool: 'get_funding_history', cards: ['card-funding', 'card-fchart'], sym: target };
  if (/\b(book|depth|liquidity|bid|ask|spread|wall)\b/.test(t))
    return { kind: 'book', tool: 'get_l2_book', cards: ['card-book', 'card-spread'], sym: target };
  if (/\b(price|mark|mid|quote|trading at|how much)\b/.test(t))
    return { kind: 'price', tool: 'get_all_mids', cards: ['card-price', 'card-mark'], sym: target };
  // default → price overview
  return { kind: 'price', tool: 'get_all_mids', cards: ['card-price'], sym: target };
}

function numSpan(val, cls) { return `<span class="num${cls ? ' ' + cls : ''}">${val}</span>`; }

function buildReply(r) {
  const sym = r.sym || current;
  const s = state[sym] || (state[sym] = buildSnapshot(sym));
  const d = s.m.dec;
  const up = s.chg >= 0;

  if (r.kind === 'account') {
    const addr = r.addr || ('0x' + 'a17f3c9e42b8' + 'd05'.repeat(8)).slice(0, 42);
    const acct = lookupAccount(addr);
    const big = acct.positions.slice().sort((a, b) => b.size - a.size)[0];
    return { tool: r.tool, args: `address: "${shortAddr(addr)}"`,
      text: `That wallet holds ${numSpan('$' + fmt(acct.equity, 0))} in equity with ${acct.positions.length} open positions, currently ${acct.pnl >= 0 ? 'up' : 'down'} ${numSpan((acct.pnl >= 0 ? '+' : '−') + '$' + fmt(Math.abs(acct.pnl), 0), acct.pnl >= 0 ? 'up' : 'down')} on the day. Biggest exposure is a <strong>${big.long ? 'long' : 'short'}</strong> on ${big.sym}. Pulled live into the account panel.` };
  }
  if (r.kind === 'funding') {
    const f = s.m.funding, apr = (f * 24 * 365).toFixed(1);
    return { tool: r.tool, args: `coin: "${sym}", lookback: "24h"`,
      text: `${sym} funding is ${numSpan((f >= 0 ? '+' : '') + f.toFixed(4) + '%', f >= 0 ? 'up' : 'down')} this hour — ${f >= 0 ? 'longs are paying shorts' : 'shorts are paying longs'}, roughly ${numSpan(apr + '% APR', f >= 0 ? 'up' : 'down')}. Over the last 24h it's stayed ${f >= 0 ? 'positive but cooling' : 'slightly negative'}. The history chart is highlighted.` };
  }
  if (r.kind === 'book') {
    const bps = ((s.spread / s.px) * 10000).toFixed(1);
    const topBid = s.bids[0], topAsk = s.asks[0];
    return { tool: r.tool, args: `coin: "${sym}", depth: 12`,
      text: `${sym} is ${numSpan(fmt(topBid.price, d))} / ${numSpan(fmt(topAsk.price, d))}, a ${numSpan(bps + ' bps')} spread. Best bid carries ${numSpan(fmtSize(topBid.size))} and there's a thicker ask wall a few levels up. Book and spread cards are pulsing on the left.` };
  }
  // price
  return { tool: r.tool, args: `coins: ["${sym}"]`,
    text: `${sym} is trading at ${numSpan('$' + fmt(s.px, d))}, ${numSpan(signPct(s.chg), up ? 'up' : 'down')} over 24h. Mark sits a hair above mid and the trend is ${up ? 'holding up' : 'leaking lower'} on the sparkline.` };
}

function botReply(r) {
  if (r.sym) selectAsset(r.sym);
  const typing = addTyping();
  const reply = buildReply(r);

  setTimeout(() => pulse(r.cards), 480);

  setTimeout(() => {
    typing.remove();
    const m = el(`<div class="msg bot msg-enter">
      <div class="toolcall"><span class="dot"></span>${reply.tool}<span class="arr">·</span><span style="color:var(--fg-3)">${reply.args}</span></div>
      <div class="bubble"></div>
    </div>`);
    m.querySelector('.bubble').innerHTML = reply.text;
    place(m);
  }, 720);
}

function send(text) {
  if (!text.trim()) return;
  addUser(text);
  const r = resolve(text);
  botReply(r);
}

/* composer */
document.getElementById('composer').addEventListener('submit', e => {
  e.preventDefault();
  const inp = document.getElementById('chatInput');
  const v = inp.value;
  if (!v.trim()) return;
  inp.value = '';
  send(v);
});

/* suggestion chips */
const CHIPS = ['BTC funding trend', 'ETH order book', 'Spread on SOL', 'ARB price now', 'Look up a whale wallet'];
const chipsEl = document.getElementById('chips');
CHIPS.forEach(label => {
  const c = el(`<button class="chip"></button>`);
  c.textContent = label;
  c.addEventListener('click', () => send(label));
  chipsEl.appendChild(c);
});

/* greeting */
function greet() {
  const m = el(`<div class="msg bot msg-enter"><div class="bubble"></div></div>`);
  m.querySelector('.bubble').innerHTML = `I read Hyperliquid in real time. Ask me about price, funding, the order book, or a wallet — say something like <em>"how's BTC funding?"</em> and watch the matching panel light up.`;
  place(m);
}

/* ============================================================
   LIVE TICK — gentle random walk, sells the "live" feel
   ============================================================ */
function tick() {
  const s = state[current]; if (!s) return;
  const step = (Math.random() - 0.5) * s.px * 0.0006;
  s.px = Math.max(s.px + step, s.m.tick);
  s.chg = ((s.px - s.open) / s.open) * 100;
  s.pts.push(s.px); if (s.pts.length > 64) s.pts.shift();
  // nudge top of book with price
  s.bids.forEach((b, i) => { b.price = s.px - s.m.tick * (i + 1) * (1 + Math.floor(i / 3)); });
  s.asks.forEach((a, i) => { a.price = s.px + s.m.tick * (i + 1) * (1 + Math.floor(i / 3)) + s.m.tick; });
  s.bestAsk = s.asks[0].price; s.bestBid = s.bids[0].price; s.spread = s.bestAsk - s.bestBid;

  renderHero(s);
  document.getElementById('statMark').innerHTML = priceHTML(s.px + s.m.tick * 2, s.m.dec);
  document.getElementById('midPrice').innerHTML = priceHTML((s.bestAsk + s.bestBid) / 2, s.m.dec);
  // refresh book prices only (sizes stable)
  document.querySelectorAll('#bookBids .bk-price').forEach((e, i) => { if (s.bids[i]) e.textContent = fmt(s.bids[i].price, s.m.dec); });
  const revAsks = s.asks.slice().reverse();
  document.querySelectorAll('#bookAsks .bk-price').forEach((e, i) => { if (revAsks[i]) e.textContent = fmt(revAsks[i].price, s.m.dec); });
}

/* ============================================================
   BOOT
   ============================================================ */
['BTC', 'ETH', 'SOL', 'ARB'].forEach(s => state[s] = buildSnapshot(s));
renderAll('BTC');
greet();
window.addEventListener('resize', () => drawSpark(state[current]));
setInterval(tick, 1500);
