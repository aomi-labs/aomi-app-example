//! Hyperliquid tool implementations.
//!
//! All tools call the single Hyperliquid public endpoint:
//!   POST https://api.hyperliquid.xyz/info
//! discriminated by a `type` field in the request body.
//! No API key required for any of these read endpoints.

use aomi_sdk::schemars::JsonSchema;
use aomi_sdk::*;
use serde::Deserialize;
use serde_json::{json, Value};

const API_URL: &str = "https://api.hyperliquid.xyz/info";

#[derive(Clone, Default)]
pub(crate) struct HyperliquidApp;

// ─── HTTP helper ─────────────────────────────────────────────────────────────

fn post_info(body: Value) -> Result<Value, String> {
    let client = reqwest::blocking::Client::new();
    let resp = client
        .post(API_URL)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| format!("[hyperliquid] request failed: {e}"))?
        .json::<Value>()
        .map_err(|e| format!("[hyperliquid] parse failed: {e}"))?;
    Ok(json!({ "source": "hyperliquid", "data": resp }))
}

// ─── Tool: GetMeta ────────────────────────────────────────────────────────────

pub(crate) struct GetMeta;

#[derive(Debug, Deserialize, JsonSchema)]
pub(crate) struct GetMetaArgs {}

impl DynAomiTool for GetMeta {
    type App = HyperliquidApp;
    type Args = GetMetaArgs;

    const NAME: &'static str = "get_meta";
    const DESCRIPTION: &'static str =
        "Get exchange metadata: the full universe of tradeable perpetual assets with size decimals and tick sizes.";

    fn run(_app: &HyperliquidApp, _args: Self::Args, _ctx: DynToolCallCtx) -> Result<Value, String> {
        post_info(json!({ "type": "meta" }))
    }
}

// ─── Tool: GetAllMids ─────────────────────────────────────────────────────────

pub(crate) struct GetAllMids;

#[derive(Debug, Deserialize, JsonSchema)]
pub(crate) struct GetAllMidsArgs {}

impl DynAomiTool for GetAllMids {
    type App = HyperliquidApp;
    type Args = GetAllMidsArgs;

    const NAME: &'static str = "get_all_mids";
    const DESCRIPTION: &'static str =
        "Get current mid-prices for all listed perpetual assets on Hyperliquid.";

    fn run(_app: &HyperliquidApp, _args: Self::Args, _ctx: DynToolCallCtx) -> Result<Value, String> {
        post_info(json!({ "type": "allMids" }))
    }
}

// ─── Tool: GetL2Book ─────────────────────────────────────────────────────────

pub(crate) struct GetL2Book;

#[derive(Debug, Deserialize, JsonSchema)]
pub(crate) struct GetL2BookArgs {
    /// Asset ticker, e.g. "BTC", "ETH", "SOL"
    pub(crate) coin: String,
}

impl DynAomiTool for GetL2Book {
    type App = HyperliquidApp;
    type Args = GetL2BookArgs;

    const NAME: &'static str = "get_l2_book";
    const DESCRIPTION: &'static str =
        "Get the L2 order book snapshot (bid and ask price levels with sizes) for a specific asset.";

    fn run(_app: &HyperliquidApp, args: Self::Args, _ctx: DynToolCallCtx) -> Result<Value, String> {
        post_info(json!({ "type": "l2Book", "coin": args.coin }))
    }
}

// ─── Tool: GetClearinghouseState ─────────────────────────────────────────────

pub(crate) struct GetClearinghouseState;

#[derive(Debug, Deserialize, JsonSchema)]
pub(crate) struct GetClearinghouseStateArgs {
    /// Ethereum-style hex address (0x...)
    pub(crate) user: String,
}

impl DynAomiTool for GetClearinghouseState {
    type App = HyperliquidApp;
    type Args = GetClearinghouseStateArgs;

    const NAME: &'static str = "get_clearinghouse_state";
    const DESCRIPTION: &'static str =
        "Get account state for a user address: open positions, margin summary, unrealised PnL, and total account value.";

    fn run(_app: &HyperliquidApp, args: Self::Args, _ctx: DynToolCallCtx) -> Result<Value, String> {
        post_info(json!({ "type": "clearinghouseState", "user": args.user }))
    }
}

// ─── Tool: GetOpenOrders ─────────────────────────────────────────────────────

pub(crate) struct GetOpenOrders;

#[derive(Debug, Deserialize, JsonSchema)]
pub(crate) struct GetOpenOrdersArgs {
    /// Ethereum-style hex address (0x...)
    pub(crate) user: String,
}

impl DynAomiTool for GetOpenOrders {
    type App = HyperliquidApp;
    type Args = GetOpenOrdersArgs;

    const NAME: &'static str = "get_open_orders";
    const DESCRIPTION: &'static str =
        "Get all pending (open) limit orders for a user address, including coin, side, size, limit price, and order ID.";

    fn run(_app: &HyperliquidApp, args: Self::Args, _ctx: DynToolCallCtx) -> Result<Value, String> {
        post_info(json!({ "type": "openOrders", "user": args.user }))
    }
}

// ─── Tool: GetUserFills ──────────────────────────────────────────────────────

pub(crate) struct GetUserFills;

#[derive(Debug, Deserialize, JsonSchema)]
pub(crate) struct GetUserFillsArgs {
    /// Ethereum-style hex address (0x...)
    pub(crate) user: String,
}

impl DynAomiTool for GetUserFills {
    type App = HyperliquidApp;
    type Args = GetUserFillsArgs;

    const NAME: &'static str = "get_user_fills";
    const DESCRIPTION: &'static str =
        "Get trade fill history for a user address, including entry price, fees paid, PnL, and transaction hashes.";

    fn run(_app: &HyperliquidApp, args: Self::Args, _ctx: DynToolCallCtx) -> Result<Value, String> {
        post_info(json!({ "type": "userFills", "user": args.user }))
    }
}

// ─── Tool: GetFundingHistory ─────────────────────────────────────────────────

pub(crate) struct GetFundingHistory;

#[derive(Debug, Deserialize, JsonSchema)]
pub(crate) struct GetFundingHistoryArgs {
    /// Asset ticker, e.g. "BTC", "ETH"
    pub(crate) coin: String,
    /// Start time in milliseconds (Unix epoch)
    pub(crate) start_time: u64,
    /// End time in milliseconds (Unix epoch). Omit to default to now.
    #[serde(default)]
    pub(crate) end_time: Option<u64>,
}

impl DynAomiTool for GetFundingHistory {
    type App = HyperliquidApp;
    type Args = GetFundingHistoryArgs;

    const NAME: &'static str = "get_funding_history";
    const DESCRIPTION: &'static str =
        "Get historical funding rate snapshots for a specific asset over a time range. Use this to analyse funding rate trends.";

    fn run(_app: &HyperliquidApp, args: Self::Args, _ctx: DynToolCallCtx) -> Result<Value, String> {
        let mut body = json!({
            "type": "fundingHistory",
            "coin": args.coin,
            "startTime": args.start_time,
        });
        if let Some(end_time) = args.end_time {
            body.as_object_mut()
                .unwrap()
                .insert("endTime".to_string(), json!(end_time));
        }
        post_info(body)
    }
}

// ─── Tool: GetCandleSnapshot ─────────────────────────────────────────────────

pub(crate) struct GetCandleSnapshot;

#[derive(Debug, Deserialize, JsonSchema)]
pub(crate) struct GetCandleSnapshotArgs {
    /// Asset ticker, e.g. "BTC", "ETH"
    pub(crate) coin: String,
    /// Interval: "1m", "5m", "15m", "1h", "4h", "1d"
    pub(crate) interval: String,
    /// Start time in milliseconds (Unix epoch)
    pub(crate) start_time: u64,
    /// End time in milliseconds (Unix epoch)
    pub(crate) end_time: u64,
}

impl DynAomiTool for GetCandleSnapshot {
    type App = HyperliquidApp;
    type Args = GetCandleSnapshotArgs;

    const NAME: &'static str = "get_candle_snapshot";
    const DESCRIPTION: &'static str =
        "Get OHLCV candlestick data for an asset at a given interval and time range. Use for price chart data and trend analysis.";

    fn run(_app: &HyperliquidApp, args: Self::Args, _ctx: DynToolCallCtx) -> Result<Value, String> {
        post_info(json!({
            "type": "candleSnapshot",
            "req": {
                "coin": args.coin,
                "interval": args.interval,
                "startTime": args.start_time,
                "endTime": args.end_time,
            }
        }))
    }
}
