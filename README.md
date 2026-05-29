# aomi-hyperliquid-sample

A canonical Aomi SDK sample: a Hyperliquid perpetual market dashboard with a chat-native AI agent. The same plugin powers both surfaces, which is the whole point.

The left panel is a live trading terminal pulling from Hyperliquid's public info API. The right panel is the agent. When you ask the agent a question, it calls a tool, answers, and the matching dashboard panel pulses purple — chat and UI are wired together through the plugin.

```
┌──────────────────────────────────────────────────────────────┐
│  aomi × Hyperliquid          BTC ETH SOL ARB   0x…wallet   ● │
├──────────────────────────────────┬───────────────────────────┤
│  Price $75,631.50  +1.24%        │  AI: trading intelligence │
│  ╱╲╱╲╲╱╲╱  (sparkline)           │  ─────────────────────    │
│  Funding +0.0042%   Mark  Spread │  > BTC funding trend?     │
│  ┌────── Order Book ──────────┐  │  ⚡ get_funding_history    │
│  │  asks  $75,640   …         │  │  Rising over 24h, latest  │
│  │  ───   $75,635  ── mid ─── │  │  +0.0042%, avg +0.0031%.  │
│  │  bids  $75,628   …         │  │                           │
│  └────────────────────────────┘  │  > ETH order book?        │
│  Funding chart (24h bars)        │  ⚡ get_l2_book           │
│  Account lookup                  │  ETH top of book: …       │
└──────────────────────────────────┴───────────────────────────┘
```

## What's in the box

```
aomi-hyperliquid-sample/
├── app/                ← Rust Aomi plugin (the backend)
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs      ← dyn_aomi_app! manifest
│       └── tool.rs     ← 8 read-only Hyperliquid tools
└── ui/                 ← Standalone HTML/CSS/JS frontend
    ├── index.html
    ├── style.css
    └── app.js
```

The plugin exposes 8 tools, all backed by Hyperliquid's free public info endpoint (no API key, no signer, no custody):

| Tool                       | What it returns                                       |
| -------------------------- | ----------------------------------------------------- |
| `get_meta`                 | Tradeable universe                                    |
| `get_all_mids`             | Current mid-prices for every perp                     |
| `get_l2_book`              | L2 bid/ask snapshot                                   |
| `get_clearinghouse_state`  | Account positions and margin for an address          |
| `get_open_orders`          | Pending limit orders for an address                  |
| `get_user_fills`           | Trade history for an address                         |
| `get_funding_history`      | Historical funding rates                              |
| `get_candle_snapshot`      | OHLCV candles                                         |

## Run the UI

The UI has zero build step. Direct browser calls to `https://api.hyperliquid.xyz/info` (CORS-open) power every dashboard panel.

```bash
cd ui
python3 -m http.server 8080
open http://localhost:8080
```

In demo mode (no backend configured) the chat panel runs an in-browser intent router that calls the same Hyperliquid endpoints the Rust plugin would. It's a stand-in that lets the dashboard be demoed standalone, and shows which tools each question would map to.

## Build the plugin

```bash
cd app
cargo build --release
```

That produces `target/release/libhyperliquid.dylib` (macOS) or `.so` (Linux), ready to be loaded by any Aomi runtime.

## Connect chat to a real Aomi backend

1. Run an Aomi runtime with the plugin loaded (e.g. `product-mono` locally, or `https://api.aomi.dev`).
2. In the UI, expand **Configure Aomi backend** in the chat panel.
3. Paste the backend URL and click **Connect**.

The frontend then `POST`s to `${backendUrl}/chat` with:

```json
{ "app_id": "hyperliquid", "message": "What's the BTC funding trend?", "history": [ … ] }
```

and expects a response of shape `{ "message": "…", "tool_calls": [ "get_funding_history", … ] }`. Tool names in the response trigger the matching dashboard panel to pulse, so the user can see *which* plugin call answered their question.

## Try these

| Ask                                                        | What happens                                                                      |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| "What's the ETH funding rate trend over the last 24h?"     | Active asset switches to ETH, agent calls `get_funding_history`, funding panel pulses |
| "Show me the SOL order book depth"                         | Switches to SOL, calls `get_l2_book`, order book pulses                          |
| "Which perpetuals have the most extreme funding rates?"    | Calls `get_meta` + `get_funding_history` across the top universe, returns top 5  |
| "Look up positions for 0x…"                                | Calls `get_clearinghouse_state` + `get_user_fills`, account panel pulses         |

## Design decisions

**Repo placement.** Lives at `aomi-labs/aomi-hyperliquid-sample` so external developers can clone and build without checking out the SDK monorepo. The plugin source mirrors `aomi-sdk/apps/hyperliquid` but pins the SDK from crates.io (`aomi-sdk = "=0.1.19"`), not by path.

**Standalone UI.** The plan considered embedding `<AomiFrame />` from `@aomi-labs/react`. That package is currently ESM-only with React 18/19, `@assistant-ui/react`, `wagmi`, and `viem` as peer dependencies — it requires a build toolchain (Vite, Next.js, or similar) and is not loadable from a `<script>` tag. To keep the sample faithful to its "zero infra" promise the UI implements its own thin chat panel that calls the same `POST /chat` shape the widget would. When Aomi ships a CDN bundle of the widget, this sample can swap to it without changing the backend contract.

**Read-only.** The plugin only wraps Hyperliquid's *info* endpoint. Placing or cancelling orders requires signed L1 actions, which is out of scope for a sample. A follow-up `aomi-hyperliquid-trade` plugin would layer transactional tools on top, gated by Aomi's namespace permissions.

## License

MIT.
