/* ─────────────────────────────────────────────────────────────────────────────
   Hyperliquid × Aomi — sample app frontend.

   Two modes:
     • Demo (no backend)  → market data + chat handled in-browser by calling
                            Hyperliquid's public info API directly.
     • Connected          → chat is routed to an Aomi runtime backend that has
                            the `hyperliquid` plugin loaded. Market data still
                            comes straight from Hyperliquid for snappiness.
   ───────────────────────────────────────────────────────────────────────── */

const HL_INFO = 'https://api.hyperliquid.xyz/info';
const REFRESH_MIDS_MS = 5_000;
const REFRESH_BOOK_MS = 5_000;
const REFRESH_FUNDING_MS = 60_000;

const ASSETS = ['BTC', 'ETH', 'SOL', 'ARB'];

const state = {
  coin: 'BTC',
  lastPrice: null,
  sparklineCloses: [],
  timers: { mids: null, book: null, funding: null },
  backend: { url: '', appId: 'hyperliquid' },
  chatHistory: [],
};

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  hydrateConfig();
  wireAssetTabs();
  wireChat();
  wireWalletLookup();
  wireConfigSave();
  switchCoin('BTC');
});

window.addEventListener('beforeunload', clearAllTimers);

// ─── Hyperliquid API ─────────────────────────────────────────────────────────

async function hlPost(body) {
  const res = await fetch(HL_INFO, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Hyperliquid ${body.type} failed: ${res.status}`);
  return res.json();
}

const hl = {
  meta:               ()         => hlPost({ type: 'meta' }),
  allMids:            ()         => hlPost({ type: 'allMids' }),
  l2Book:             (coin)     => hlPost({ type: 'l2Book', coin }),
  clearinghouseState: (user)     => hlPost({ type: 'clearinghouseState', user }),
  openOrders:         (user)     => hlPost({ type: 'openOrders', user }),
  userFills:          (user)     => hlPost({ type: 'userFills', user }),
  fundingHistory:     (coin, startTime, endTime) => {
    const body = { type: 'fundingHistory', coin, startTime };
    if (endTime) body.endTime = endTime;
    return hlPost(body);
  },
  candleSnapshot:     (coin, interval, startTime, endTime) =>
    hlPost({ type: 'candleSnapshot', req: { coin, interval, startTime, endTime } }),
};

// ─── Status dot ──────────────────────────────────────────────────────────────

function setStatus(kind, label) {
  const dot = document.getElementById('status-dot');
  const lab = document.getElementById('status-label');
  dot.classList.remove('live', 'error');
  if (kind === 'live')  dot.classList.add('live');
  if (kind === 'error') dot.classList.add('error');
  lab.textContent = label;
}

// ─── Asset switching ─────────────────────────────────────────────────────────

function wireAssetTabs() {
  document.querySelectorAll('.asset-tab').forEach(tab => {
    tab.addEventListener('click', () => switchCoin(tab.dataset.coin));
  });
}

function switchCoin(coin) {
  state.coin = coin;
  state.lastPrice = null;
  state.sparklineCloses = [];

  document.querySelectorAll('.asset-tab').forEach(tab => {
    const active = tab.dataset.coin === coin;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  document.getElementById('hero-coin').textContent = coin;
  document.getElementById('ob-coin').textContent = `${coin}-PERP`;
  document.getElementById('funding-chart-coin').textContent = coin;

  clearAllTimers();
  refreshAll();
  state.timers.mids    = setInterval(refreshMids,    REFRESH_MIDS_MS);
  state.timers.book    = setInterval(refreshBook,    REFRESH_BOOK_MS);
  state.timers.funding = setInterval(refreshFunding, REFRESH_FUNDING_MS);
}

function clearAllTimers() {
  Object.values(state.timers).forEach(t => t && clearInterval(t));
  state.timers = { mids: null, book: null, funding: null };
}

async function refreshAll() {
  setStatus('', 'Connecting…');
  try {
    await Promise.all([refreshHero(), refreshMids(), refreshBook(), refreshFunding()]);
    setStatus('live', 'Live');
  } catch (err) {
    console.error(err);
    setStatus('error', 'Connection error');
  }
}

// ─── Price hero + sparkline ──────────────────────────────────────────────────

async function refreshHero() {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const candles = await hl.candleSnapshot(state.coin, '1h', now - day, now);
  if (!Array.isArray(candles) || candles.length === 0) return;

  const closes = candles.map(c => Number(c.c));
  state.sparklineCloses = closes;

  const first = closes[0];
  const last = closes[closes.length - 1];
  const pct = ((last - first) / first) * 100;

  const arrow = document.getElementById('change-arrow');
  const pctEl = document.getElementById('change-pct');
  const change = document.getElementById('hero-change');

  change.classList.remove('positive', 'negative', 'neutral');
  if (pct > 0.01)       { change.classList.add('positive'); arrow.textContent = '▲'; }
  else if (pct < -0.01) { change.classList.add('negative'); arrow.textContent = '▼'; }
  else                  { change.classList.add('neutral');  arrow.textContent = '—'; }
  pctEl.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;

  drawSparkline(closes, pct >= 0);
}

function drawSparkline(values, positive) {
  const canvas = document.getElementById('sparkline');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 220;
  const h = canvas.clientHeight || 64;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  if (values.length < 2) return;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = w / (values.length - 1);

  const color = positive ? '#10b981' : '#ef4444';

  ctx.beginPath();
  values.forEach((v, i) => {
    const x = i * step;
    const y = h - ((v - min) / range) * (h - 6) - 3;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.stroke();

  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, color + '33');
  grad.addColorStop(1, color + '00');
  ctx.fillStyle = grad;
  ctx.fill();
}

// ─── Mids ────────────────────────────────────────────────────────────────────

async function refreshMids() {
  try {
    const mids = await hl.allMids();
    const price = Number(mids[state.coin]);
    if (!isFinite(price)) return;

    const heroPrice = document.getElementById('hero-price');
    const markValue = document.getElementById('mark-value');

    const formatted = formatPrice(price);
    heroPrice.textContent = formatted;
    markValue.textContent = formatted;

    if (state.lastPrice !== null) {
      const dir = price > state.lastPrice ? 'flash-up' : price < state.lastPrice ? 'flash-down' : null;
      if (dir) {
        heroPrice.classList.add(dir);
        setTimeout(() => heroPrice.classList.remove(dir), 400);
      }
    }
    state.lastPrice = price;
    setStatus('live', 'Live');
  } catch (err) {
    console.error('mids refresh failed', err);
    setStatus('error', 'Connection error');
  }
}

// ─── Order book ──────────────────────────────────────────────────────────────

async function refreshBook() {
  try {
    const book = await hl.l2Book(state.coin);
    const levels = book?.levels;
    if (!levels || levels.length !== 2) return;

    const bids = levels[0].slice(0, 10);
    const asks = levels[1].slice(0, 10);

    const bestBid = Number(bids[0]?.px);
    const bestAsk = Number(asks[0]?.px);
    if (isFinite(bestBid) && isFinite(bestAsk)) {
      const mid = (bestBid + bestAsk) / 2;
      const spread = bestAsk - bestBid;
      const spreadPct = (spread / mid) * 100;
      document.getElementById('spread-value').textContent =
        `${formatPrice(spread)} (${spreadPct.toFixed(3)}%)`;
      document.getElementById('ob-mid-price').textContent = formatPrice(mid);
    }

    const maxSize = Math.max(
      ...bids.map(l => Number(l.sz)),
      ...asks.map(l => Number(l.sz)),
      0.0001,
    );

    renderBookRows('bids-rows', bids, maxSize);
    renderBookRows('asks-rows', asks.slice().reverse(), maxSize);
  } catch (err) {
    console.error('book refresh failed', err);
  }
}

function renderBookRows(id, levels, maxSize) {
  const host = document.getElementById(id);
  host.innerHTML = '';
  levels.forEach(level => {
    const px = Number(level.px);
    const sz = Number(level.sz);
    const pct = (sz / maxSize) * 100;
    const row = document.createElement('div');
    row.className = 'ob-row';
    row.innerHTML = `
      <span class="bar" style="width:${pct.toFixed(1)}%"></span>
      <span>${formatPrice(px)}</span>
      <span>${formatSize(sz)}</span>
    `;
    host.appendChild(row);
  });
}

// ─── Funding ────────────────────────────────────────────────────────────────

async function refreshFunding() {
  try {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const history = await hl.fundingHistory(state.coin, now - day, now);
    if (!Array.isArray(history) || history.length === 0) return;

    const latest = history[history.length - 1];
    const rate = Number(latest.fundingRate);
    const pct = rate * 100;

    const fundingValue = document.getElementById('funding-value');
    const fundingDir = document.getElementById('funding-direction');
    fundingValue.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(4)}%`;
    fundingValue.classList.remove('positive', 'negative', 'neutral');
    fundingDir.classList.remove('positive', 'negative', 'neutral');
    if (rate > 0)      { fundingValue.classList.add('positive'); fundingDir.classList.add('positive'); fundingDir.textContent = 'Longs pay shorts'; }
    else if (rate < 0) { fundingValue.classList.add('negative'); fundingDir.classList.add('negative'); fundingDir.textContent = 'Shorts pay longs'; }
    else               { fundingValue.classList.add('neutral');  fundingDir.classList.add('neutral');  fundingDir.textContent = 'Neutral'; }

    drawFundingChart(history);
  } catch (err) {
    console.error('funding refresh failed', err);
  }
}

function drawFundingChart(history) {
  const canvas = document.getElementById('funding-canvas');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 600;
  const h = canvas.clientHeight || 100;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const rates = history.map(r => Number(r.fundingRate));
  const absMax = Math.max(...rates.map(Math.abs), 0.000001);
  const barW = Math.max(2, w / rates.length - 1);
  const midY = h / 2;

  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(w, midY);
  ctx.stroke();

  rates.forEach((rate, i) => {
    const x = (i / rates.length) * w;
    const height = (Math.abs(rate) / absMax) * (h / 2 - 4);
    if (rate >= 0) {
      ctx.fillStyle = '#10b981';
      ctx.fillRect(x, midY - height, barW, height);
    } else {
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(x, midY, barW, height);
    }
  });
}

// ─── Wallet lookup ──────────────────────────────────────────────────────────

function wireWalletLookup() {
  const input = document.getElementById('nav-wallet-input');
  const btn = document.getElementById('nav-wallet-btn');
  btn.addEventListener('click', () => doWalletLookup(input.value.trim()));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') doWalletLookup(input.value.trim());
  });
}

async function doWalletLookup(addr) {
  const results = document.getElementById('wallet-results');
  if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
    results.innerHTML = `<div class="wallet-placeholder">Enter a valid 0x… address (40 hex chars).</div>`;
    return;
  }

  results.innerHTML = `<div class="wallet-placeholder">Loading…</div>`;

  try {
    const [chState, fills] = await Promise.all([
      hl.clearinghouseState(addr),
      hl.userFills(addr).catch(() => []),
    ]);

    const summary = chState?.marginSummary;
    const positions = (chState?.assetPositions || [])
      .map(p => p.position)
      .filter(p => Number(p.szi) !== 0);

    let html = '';
    if (summary) {
      const accountValue = Number(summary.accountValue);
      const totalNotional = Number(summary.totalNtlPos);
      const totalMargin = Number(summary.totalMarginUsed);
      html += `
        <div class="account-summary">
          <div class="acc-metric"><span class="acc-label">Account Value</span><span class="acc-value">${formatUsd(accountValue)}</span></div>
          <div class="acc-metric"><span class="acc-label">Notional</span><span class="acc-value">${formatUsd(totalNotional)}</span></div>
          <div class="acc-metric"><span class="acc-label">Margin Used</span><span class="acc-value">${formatUsd(totalMargin)}</span></div>
        </div>
      `;
    }

    if (positions.length === 0) {
      html += `<div class="wallet-placeholder">No open positions.</div>`;
    } else {
      positions.forEach(p => {
        const size = Number(p.szi);
        const side = size > 0 ? 'long' : 'short';
        const entry = Number(p.entryPx);
        const upnl = Number(p.unrealizedPnl);
        html += `
          <div class="position-card">
            <div class="pos-left">
              <span class="pos-coin">${escapeHtml(p.coin)}</span>
              <span class="pos-side ${side}">${side.toUpperCase()} · ${Math.abs(size)} @ ${formatPrice(entry)}</span>
            </div>
            <div class="pos-right">
              <span class="pos-pnl ${upnl >= 0 ? 'positive' : 'negative'}">${upnl >= 0 ? '+' : ''}${formatUsd(upnl)}</span>
              <span class="pos-size">unrealised</span>
            </div>
          </div>
        `;
      });
    }

    if (Array.isArray(fills) && fills.length > 0) {
      const recent = fills.slice(0, 5);
      html += `
        <table class="tool-result" aria-label="Recent fills">
          <thead><tr><th>Time</th><th>Coin</th><th>Side</th><th>Px</th><th>Sz</th></tr></thead>
          <tbody>
            ${recent.map(f => `
              <tr>
                <td>${formatTime(Number(f.time))}</td>
                <td>${escapeHtml(f.coin)}</td>
                <td>${f.side === 'B' ? 'Buy' : 'Sell'}</td>
                <td>${formatPrice(Number(f.px))}</td>
                <td>${formatSize(Number(f.sz))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }

    results.innerHTML = html;
  } catch (err) {
    console.error(err);
    results.innerHTML = `<div class="wallet-placeholder">Lookup failed. Address may not have Hyperliquid activity.</div>`;
  }
}

// ─── Chat ───────────────────────────────────────────────────────────────────

function wireChat() {
  const input = document.getElementById('chat-input');
  const btn = document.getElementById('send-btn');

  const send = () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';
    handleUserMessage(text);
  };

  btn.addEventListener('click', send);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

  document.querySelectorAll('.suggestion').forEach(s => {
    s.addEventListener('click', () => {
      input.value = s.dataset.prompt;
      input.focus();
      input.dispatchEvent(new Event('input'));
    });
  });
}

async function handleUserMessage(text) {
  appendMessage('user', text);
  const typingId = appendTyping();
  state.chatHistory.push({ role: 'user', content: text });

  try {
    const reply = state.backend.url
      ? await chatViaAomi(text)
      : await chatDemo(text);
    removeTyping(typingId);
    appendMessage('agent', reply.text, reply.toolCalls);
    state.chatHistory.push({ role: 'assistant', content: reply.text });
    reactToChatResponse(text, reply.text, reply.toolCalls);
  } catch (err) {
    console.error(err);
    removeTyping(typingId);
    appendMessage('agent', `Sorry, I hit an error: ${err.message}`);
  }
}

async function chatViaAomi(text) {
  const url = state.backend.url.replace(/\/$/, '') + '/chat';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: state.backend.appId,
      message: text,
      history: state.chatHistory.slice(-10),
    }),
  });
  if (!res.ok) throw new Error(`Backend returned ${res.status}`);
  const data = await res.json();
  return {
    text: data.message || data.text || data.reply || JSON.stringify(data),
    toolCalls: data.tool_calls || data.toolCalls || [],
  };
}

/* Demo mode: a small intent router that calls the same info endpoints the
   Rust plugin would, then formats a human-readable answer. Not a real LLM.
   Demonstrates which tools an Aomi backend would invoke for each question. */
async function chatDemo(text) {
  const q = text.toLowerCase();
  const toolCalls = [];

  const wantsTrend   = /trend|over time|history|24h|funding/.test(q);
  const wantsBook    = /order book|depth|bid|ask|spread/.test(q);
  const wantsExtreme = /highest|extreme|top|biggest|largest|most/.test(q);
  const wantsPrices  = /price|mid|cost|how much/.test(q);
  const addrMatch    = q.match(/0x[a-f0-9]{40}/);

  if (addrMatch) {
    toolCalls.push('get_clearinghouse_state');
    const addr = addrMatch[0];
    const ch = await hl.clearinghouseState(addr);
    const positions = (ch?.assetPositions || []).map(p => p.position).filter(p => Number(p.szi) !== 0);
    const accountValue = Number(ch?.marginSummary?.accountValue || 0);
    if (positions.length === 0) {
      return { text: `Address \`${shortAddr(addr)}\` has account value ${formatUsd(accountValue)} with no open positions.`, toolCalls };
    }
    const lines = positions.map(p => {
      const side = Number(p.szi) > 0 ? 'long' : 'short';
      return `• ${escapeHtml(p.coin)} ${side} ${Math.abs(Number(p.szi))} @ ${formatPrice(Number(p.entryPx))}  uPnL ${formatUsd(Number(p.unrealizedPnl))}`;
    });
    return { text: `Account value ${formatUsd(accountValue)}\n${lines.join('\n')}`, toolCalls };
  }

  if (wantsExtreme && /funding/.test(q)) {
    toolCalls.push('get_meta', 'get_funding_history');
    const meta = await hl.meta();
    const top10 = (meta?.universe || []).slice(0, 10).map(u => u.name);
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const results = await Promise.all(
      top10.map(async coin => {
        try {
          const h = await hl.fundingHistory(coin, now - day, now);
          const latest = Array.isArray(h) && h.length > 0 ? Number(h[h.length - 1].fundingRate) : 0;
          return { coin, rate: latest };
        } catch { return { coin, rate: 0 }; }
      })
    );
    results.sort((a, b) => Math.abs(b.rate) - Math.abs(a.rate));
    const lines = results.slice(0, 5).map(r => `• ${r.coin}: ${(r.rate * 100).toFixed(4)}%`);
    return { text: `Most extreme funding rates right now (of top 10 perps):\n${lines.join('\n')}`, toolCalls };
  }

  if (wantsTrend && /funding/.test(q)) {
    toolCalls.push('get_funding_history');
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const h = await hl.fundingHistory(state.coin, now - day, now);
    if (!Array.isArray(h) || h.length === 0) {
      return { text: `No funding data for ${state.coin} in the last 24h.`, toolCalls };
    }
    const rates = h.map(r => Number(r.fundingRate) * 100);
    const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
    const first = rates[0];
    const last = rates[rates.length - 1];
    const direction = last > first ? 'rising' : last < first ? 'falling' : 'flat';
    return {
      text: `${state.coin} funding over the last 24h is ${direction}: started at ${first.toFixed(4)}%, latest ${last.toFixed(4)}%, average ${avg.toFixed(4)}%. ${avg > 0 ? 'Longs are paying shorts on average.' : 'Shorts are paying longs on average.'}`,
      toolCalls,
    };
  }

  if (wantsBook) {
    toolCalls.push('get_l2_book');
    const book = await hl.l2Book(state.coin);
    const bids = book?.levels?.[0]?.slice(0, 5) || [];
    const asks = book?.levels?.[1]?.slice(0, 5) || [];
    const bid = Number(bids[0]?.px);
    const ask = Number(asks[0]?.px);
    const spread = ask - bid;
    return {
      text: `${state.coin} top of book: bid ${formatPrice(bid)} / ask ${formatPrice(ask)}, spread ${formatPrice(spread)} (${((spread / ((ask + bid) / 2)) * 100).toFixed(3)}%). Top 5 bid sizes ${bids.map(l => formatSize(Number(l.sz))).join(', ')}. Top 5 ask sizes ${asks.map(l => formatSize(Number(l.sz))).join(', ')}.`,
      toolCalls,
    };
  }

  if (wantsPrices || /btc|eth|sol|arb|doge/.test(q)) {
    toolCalls.push('get_all_mids');
    const mids = await hl.allMids();
    const requested = ASSETS.filter(a => q.includes(a.toLowerCase()));
    const list = requested.length > 0 ? requested : ASSETS;
    const lines = list.map(c => `• ${c}: ${formatPrice(Number(mids[c]))}`);
    return { text: `Current mid-prices:\n${lines.join('\n')}`, toolCalls };
  }

  return {
    text: `In demo mode I answer questions about prices, order books, funding rates, and account positions. Try one of the suggested prompts, or connect an Aomi backend in the config panel to chat with the full LLM-powered agent.`,
    toolCalls: [],
  };
}

// ─── Chat → Dashboard reaction ──────────────────────────────────────────────
//
// The plan's headline: when the agent answers, the relevant dashboard panel
// reacts. If the user asked about a different coin, switch the active tab.
// If a particular tool ran, pulse the panel that visualises that data.

function reactToChatResponse(userText, agentText, toolCalls) {
  const blob = `${userText} ${agentText}`.toUpperCase();
  const mentioned = ASSETS.find(c => new RegExp(`\\b${c}\\b`).test(blob));
  if (mentioned && mentioned !== state.coin) switchCoin(mentioned);

  const toolNames = (toolCalls || [])
    .map(t => (typeof t === 'string' ? t : t?.name))
    .filter(Boolean);
  if (toolNames.includes('get_funding_history'))     pulseCard('funding-chart-card');
  if (toolNames.includes('get_l2_book'))             pulseCard('orderbook');
  if (toolNames.includes('get_all_mids'))            pulseCard('price-hero');
  if (toolNames.includes('get_candle_snapshot'))     pulseCard('price-hero');
  if (toolNames.includes('get_meta'))                pulseCard('price-hero');
  if (
    toolNames.includes('get_clearinghouse_state') ||
    toolNames.includes('get_open_orders') ||
    toolNames.includes('get_user_fills')
  ) pulseCard('wallet-panel');
}

function pulseCard(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('pulse-highlight');
  void el.offsetWidth;
  el.classList.add('pulse-highlight');
  setTimeout(() => el.classList.remove('pulse-highlight'), 1700);
}

// ─── Chat rendering ─────────────────────────────────────────────────────────

function appendMessage(role, text, toolCalls = []) {
  const host = document.getElementById('chat-messages');
  const msg = document.createElement('div');
  msg.className = `msg msg-${role}`;
  msg.innerHTML = `
    <div class="msg-avatar">${role === 'user' ? 'YOU' : 'AI'}</div>
    <div class="msg-bubble">
      ${textToHtml(text)}
      ${toolCalls.length ? toolCalls.map(t => `<div class="msg-tool-call">⚡ tool: ${escapeHtml(t)}</div>`).join('') : ''}
    </div>
  `;
  host.appendChild(msg);
  host.scrollTop = host.scrollHeight;
}

function appendTyping() {
  const host = document.getElementById('chat-messages');
  const id = `typing-${Date.now()}`;
  const msg = document.createElement('div');
  msg.className = 'msg msg-agent';
  msg.id = id;
  msg.innerHTML = `
    <div class="msg-avatar">AI</div>
    <div class="msg-bubble">
      <div class="typing-dots"><span></span><span></span><span></span></div>
    </div>
  `;
  host.appendChild(msg);
  host.scrollTop = host.scrollHeight;
  return id;
}

function removeTyping(id) {
  document.getElementById(id)?.remove();
}

// ─── Config persistence ────────────────────────────────────────────────────

function hydrateConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem('aomi-hl-config') || '{}');
    state.backend.url = saved.url || '';
    state.backend.appId = saved.appId || 'hyperliquid';
    const urlInput = document.getElementById('backend-url-input');
    const idInput  = document.getElementById('app-id-input');
    if (urlInput) urlInput.value = state.backend.url;
    if (idInput)  idInput.value  = state.backend.appId;
  } catch {}
}

function wireConfigSave() {
  document.getElementById('config-save-btn').addEventListener('click', () => {
    const urlInput = document.getElementById('backend-url-input');
    const idInput  = document.getElementById('app-id-input');
    state.backend.url   = urlInput.value.trim();
    state.backend.appId = idInput.value.trim() || 'hyperliquid';
    localStorage.setItem('aomi-hl-config', JSON.stringify(state.backend));
    appendMessage('agent', state.backend.url
      ? `Connected to Aomi backend at ${state.backend.url}. Chat now routes through the runtime.`
      : `Backend cleared. Chat will run in demo mode.`);
  });
}

// ─── Formatters ─────────────────────────────────────────────────────────────

function formatPrice(n) {
  if (!isFinite(n)) return '—';
  if (Math.abs(n) >= 1000) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (Math.abs(n) >= 1)    return `$${n.toFixed(2)}`;
  if (Math.abs(n) >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toPrecision(4)}`;
}

function formatSize(n) {
  if (!isFinite(n)) return '—';
  if (Math.abs(n) >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return n.toFixed(n < 1 ? 4 : 2);
}

function formatUsd(n) {
  if (!isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function formatTime(ms) {
  const d = new Date(ms);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function shortAddr(a) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textToHtml(s) {
  const escaped = escapeHtml(s);
  const withCode = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
  return withCode
    .split('\n\n')
    .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
}
