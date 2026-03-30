"""
Performance Metrics Calculator.
Computes Sharpe ratio, max drawdown, win rate, and ML-specific metrics.
"""

import numpy as np
from typing import List


def compute_backtest_metrics(trades: List[dict], initial_capital: float,
                             risk_free_rate: float = 0.045) -> dict:
    """
    Compute comprehensive performance metrics from a list of trades.
    Each trade: {"entry_price", "exit_price", "direction", "pnl", "pnl_pct", "entry_time", "exit_time"}
    """
    if not trades:
        return _empty_metrics()

    pnl_list = [t["pnl"] for t in trades]
    pnl_pct_list = [t["pnl_pct"] for t in trades]
    winning_trades = [t for t in trades if t["pnl"] > 0]
    losing_trades = [t for t in trades if t["pnl"] <= 0]

    # Equity curve
    equity = [initial_capital]
    for pnl in pnl_list:
        equity.append(equity[-1] + pnl)

    equity_arr = np.array(equity)

    # Total return
    total_return = (equity_arr[-1] - initial_capital) / initial_capital * 100

    # Win rate
    win_rate = len(winning_trades) / len(trades) * 100 if trades else 0

    # Average win/loss
    avg_win = np.mean([t["pnl_pct"] for t in winning_trades]) if winning_trades else 0
    avg_loss = np.mean([abs(t["pnl_pct"]) for t in losing_trades]) if losing_trades else 0

    # Profit factor (gross profits / gross losses)
    gross_profit = sum(t["pnl"] for t in winning_trades) if winning_trades else 0
    gross_loss = abs(sum(t["pnl"] for t in losing_trades)) if losing_trades else 1
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else float('inf')

    # Max drawdown
    max_dd = _max_drawdown(equity_arr)

    # Sharpe ratio (annualized)
    if len(pnl_pct_list) > 1:
        returns = np.array(pnl_pct_list) / 100
        excess_returns = returns - risk_free_rate / 252  # daily risk-free
        sharpe = np.mean(excess_returns) / np.std(excess_returns) * np.sqrt(252) if np.std(excess_returns) > 0 else 0
    else:
        sharpe = 0

    # Longest winning/losing streak
    win_streak, lose_streak = _streaks(trades)

    return {
        "totalTrades": len(trades),
        "winningTrades": len(winning_trades),
        "losingTrades": len(losing_trades),
        "winRate": round(win_rate, 1),
        "totalReturn": round(total_return, 2),
        "totalPnl": round(sum(pnl_list), 2),
        "avgWinPct": round(float(avg_win), 2),
        "avgLossPct": round(float(avg_loss), 2),
        "profitFactor": round(float(profit_factor), 2),
        "sharpeRatio": round(float(sharpe), 2),
        "maxDrawdown": round(float(max_dd), 2),
        "longestWinStreak": win_streak,
        "longestLoseStreak": lose_streak,
        "finalEquity": round(float(equity_arr[-1]), 2),
        "equityCurve": [round(float(e), 2) for e in equity_arr[::max(1, len(equity_arr) // 100)]],
    }


def compute_ml_metrics(y_true: np.ndarray, y_pred: np.ndarray,
                       y_prob: np.ndarray = None) -> dict:
    """
    Compute ML classification metrics: accuracy, precision, recall, F1, confusion matrix.
    """
    from sklearn.metrics import (accuracy_score, precision_score, recall_score,
                                  f1_score, confusion_matrix as cm)

    accuracy = accuracy_score(y_true, y_pred)
    precision = precision_score(y_true, y_pred, zero_division=0)
    recall = recall_score(y_true, y_pred, zero_division=0)
    f1 = f1_score(y_true, y_pred, zero_division=0)
    conf_matrix = cm(y_true, y_pred, labels=[0, 1]).tolist()

    result = {
        "accuracy": round(float(accuracy), 4),
        "precision": round(float(precision), 4),
        "recall": round(float(recall), 4),
        "f1Score": round(float(f1), 4),
        "confusionMatrix": conf_matrix,
        "totalSamples": len(y_true),
    }

    return result


def _max_drawdown(equity: np.ndarray) -> float:
    """Compute maximum drawdown as a percentage."""
    peak = equity[0]
    max_dd = 0
    for val in equity:
        if val > peak:
            peak = val
        dd = (peak - val) / peak * 100 if peak > 0 else 0
        max_dd = max(max_dd, dd)
    return max_dd


def _streaks(trades: List[dict]) -> tuple:
    """Compute longest winning and losing streaks."""
    max_win, max_lose = 0, 0
    cur_win, cur_lose = 0, 0

    for t in trades:
        if t["pnl"] > 0:
            cur_win += 1
            cur_lose = 0
            max_win = max(max_win, cur_win)
        else:
            cur_lose += 1
            cur_win = 0
            max_lose = max(max_lose, cur_lose)

    return max_win, max_lose


def _empty_metrics() -> dict:
    return {
        "totalTrades": 0, "winningTrades": 0, "losingTrades": 0,
        "winRate": 0, "totalReturn": 0, "totalPnl": 0,
        "avgWinPct": 0, "avgLossPct": 0, "profitFactor": 0,
        "sharpeRatio": 0, "maxDrawdown": 0,
        "longestWinStreak": 0, "longestLoseStreak": 0,
        "finalEquity": 0, "equityCurve": [],
    }
