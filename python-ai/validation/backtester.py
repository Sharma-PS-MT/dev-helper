"""
Walk-Forward Backtesting Framework.
Simulates trading on historical data using either rule-based or ML engine.
Tracks entry/exit signals, PnL per trade, and equity curve.
"""

import numpy as np
import pandas as pd
from typing import List
from config import BACKTEST_CONFIG as BC, INTERVAL_SECONDS
from engines import rule_engine
from engines import ml_engine
from validation.metrics import compute_backtest_metrics


def run_backtest(df: pd.DataFrame, mode: str, symbol: str, interval: str) -> dict:
    """
    Run a backtest on historical OHLCV data.
    
    Args:
        df: DataFrame with OHLCV columns
        mode: "rule" for rule-based, "ml" for ML-based
        symbol: trading pair symbol
        interval: candle interval
    
    Returns: dict with trades list and performance metrics
    """
    if len(df) < 100:
        return {"error": "Need at least 100 candles for backtesting", "trades": [], "metrics": {}}

    trades = []
    position = None  # None = no position, dict = active position
    capital = BC["initial_capital"]

    # Sliding window prediction — step through the data
    window_size = 60  # minimum candles needed for indicators
    step_size = 1     # evaluate every candle

    for i in range(window_size, len(df) - 1):
        window_df = df.iloc[max(0, i - 200):i + 1].copy()
        current_price = float(df.iloc[i]["close"])
        current_time = int(df.iloc[i].get("time", i))
        next_price = float(df.iloc[i + 1]["close"])

        # Get prediction from chosen engine
        try:
            if mode == "rule":
                pred = rule_engine.predict(window_df)
            else:
                pred = ml_engine.predict(window_df, symbol, interval)
        except Exception:
            continue

        trend = pred.get("trend", "NEUTRAL")
        confidence = pred.get("confidence", 0)

        # --- POSITION MANAGEMENT ---
        if position is not None:
            # Check stop-loss / take-profit
            pnl_pct = (current_price - position["entry_price"]) / position["entry_price"]
            if position["direction"] == "SHORT":
                pnl_pct = -pnl_pct

            # Stop loss hit
            if pnl_pct <= -BC["stop_loss_pct"]:
                trades.append(_close_trade(position, current_price, current_time, "stop_loss"))
                position = None
                continue

            # Take profit hit
            if pnl_pct >= BC["take_profit_pct"]:
                trades.append(_close_trade(position, current_price, current_time, "take_profit"))
                position = None
                continue

            # Exit on opposite signal
            if (position["direction"] == "LONG" and trend == "DOWN" and confidence > 0.5):
                trades.append(_close_trade(position, current_price, current_time, "signal_exit"))
                position = None
            elif (position["direction"] == "SHORT" and trend == "UP" and confidence > 0.5):
                trades.append(_close_trade(position, current_price, current_time, "signal_exit"))
                position = None

        # --- ENTRY LOGIC ---
        if position is None and confidence >= 0.4:
            if trend == "UP":
                position_size = capital * BC["position_size_pct"]
                position = {
                    "direction": "LONG",
                    "entry_price": current_price * (1 + BC["slippage_pct"]),
                    "entry_time": current_time,
                    "size": position_size,
                    "confidence": confidence,
                }
            elif trend == "DOWN":
                position_size = capital * BC["position_size_pct"]
                position = {
                    "direction": "SHORT",
                    "entry_price": current_price * (1 - BC["slippage_pct"]),
                    "entry_time": current_time,
                    "size": position_size,
                    "confidence": confidence,
                }

    # Close any remaining position at the end
    if position is not None:
        final_price = float(df.iloc[-1]["close"])
        final_time = int(df.iloc[-1].get("time", len(df)))
        trades.append(_close_trade(position, final_price, final_time, "end_of_data"))

    # Compute metrics
    metrics = compute_backtest_metrics(trades, BC["initial_capital"], BC["risk_free_rate"])

    return {
        "trades": trades[-50:],  # Return last 50 trades to keep response small
        "metrics": metrics,
        "config": {
            "initialCapital": BC["initial_capital"],
            "stopLoss": f"{BC['stop_loss_pct'] * 100}%",
            "takeProfit": f"{BC['take_profit_pct'] * 100}%",
            "commission": f"{BC['commission_pct'] * 100}%",
            "totalCandles": len(df),
            "mode": mode,
        },
    }


def _close_trade(position: dict, exit_price: float, exit_time: int,
                 exit_reason: str) -> dict:
    """Close a position and compute PnL."""
    entry = position["entry_price"]
    size = position["size"]

    if position["direction"] == "LONG":
        exit_adj = exit_price * (1 - BC["slippage_pct"])
        pnl_pct = (exit_adj - entry) / entry
    else:
        exit_adj = exit_price * (1 + BC["slippage_pct"])
        pnl_pct = (entry - exit_adj) / entry

    # Subtract commission both ways
    pnl_pct -= BC["commission_pct"] * 2
    pnl = size * pnl_pct

    return {
        "direction": position["direction"],
        "entry_price": round(entry, 2),
        "exit_price": round(exit_adj, 2),
        "entry_time": position["entry_time"],
        "exit_time": exit_time,
        "pnl": round(float(pnl), 2),
        "pnl_pct": round(float(pnl_pct * 100), 2),
        "exit_reason": exit_reason,
        "confidence": position.get("confidence", 0),
    }
