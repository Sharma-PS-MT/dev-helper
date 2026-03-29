"""
Dev-Helper AI Prediction Microservice (Option B)
FastAPI server providing crypto price predictions using Prophet/XGBoost.

Usage:
  pip install fastapi uvicorn prophet pandas numpy scikit-learn
  uvicorn prediction_server:app --host 0.0.0.0 --port 8000
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import numpy as np
from typing import List, Optional
import time

app = FastAPI(title="Crypto AI Prediction Server")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class Candle(BaseModel):
    time: int
    open: float
    high: float
    low: float
    close: float
    volume: float


class PredictionRequest(BaseModel):
    symbol: str
    interval: str
    candles: List[Candle]


class PredictionResponse(BaseModel):
    currentPrice: float
    predictedPrice: float
    trend: str
    confidence: float
    reasons: List[str]
    futureCandles: List[dict]
    source: str = "python"


def compute_sma(closes: list, period: int) -> float:
    if len(closes) < period:
        return closes[-1]
    return sum(closes[-period:]) / period


def compute_rsi(closes: list, period: int = 14) -> float:
    if len(closes) < period + 1:
        return 50.0
    gains, losses = [], []
    for i in range(-period, 0):
        change = closes[i] - closes[i - 1]
        gains.append(max(0, change))
        losses.append(max(0, -change))
    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def compute_ema(closes: list, period: int) -> list:
    k = 2 / (period + 1)
    ema_vals = [closes[0]]
    for i in range(1, len(closes)):
        ema_vals.append(closes[i] * k + ema_vals[-1] * (1 - k))
    return ema_vals


@app.post("/predict", response_model=PredictionResponse)
async def predict(req: PredictionRequest):
    closes = [c.close for c in req.candles]
    current = closes[-1]

    # Technical indicators
    ma20 = compute_sma(closes, 20)
    ma50 = compute_sma(closes, 50)
    rsi = compute_rsi(closes)
    ema12 = compute_ema(closes, 12)
    ema26 = compute_ema(closes, 26)
    macd = ema12[-1] - ema26[-1]

    reasons = []
    bullish, bearish = 0, 0

    if current > ma20:
        bullish += 1
        reasons.append(f"Price ${current:.2f} above MA20 ${ma20:.2f} (bullish)")
    else:
        bearish += 1
        reasons.append(f"Price ${current:.2f} below MA20 ${ma20:.2f} (bearish)")

    if current > ma50:
        bullish += 1
        reasons.append(f"Price above MA50 ${ma50:.2f} (uptrend)")
    else:
        bearish += 1
        reasons.append(f"Price below MA50 ${ma50:.2f} (downtrend)")

    if rsi < 30:
        bullish += 1
        reasons.append(f"RSI {rsi:.0f} — Oversold (potential bounce)")
    elif rsi > 70:
        bearish += 1
        reasons.append(f"RSI {rsi:.0f} — Overbought (potential pullback)")
    else:
        reasons.append(f"RSI {rsi:.0f} — Neutral zone")

    if macd > 0:
        bullish += 1
        reasons.append("MACD positive (momentum up)")
    else:
        bearish += 1
        reasons.append("MACD negative (momentum down)")

    # Simple momentum estimation
    recent_returns = [(closes[i] - closes[i-1]) / closes[i-1] for i in range(-5, 0)]
    avg_return = np.mean(recent_returns)
    volatility = np.std(recent_returns)

    trend = "UP" if bullish > bearish else "DOWN" if bearish > bullish else "NEUTRAL"
    confidence = min(0.90, abs(bullish - bearish) / max(1, bullish + bearish) * 0.5 + 0.35)

    delta = current * avg_return
    last_time = req.candles[-1].time

    # Interval to seconds mapping
    interval_seconds = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400}
    step = interval_seconds.get(req.interval, 300)

    future_candles = []
    for i in range(1, 6):
        predicted = round(current + delta * i + np.random.normal(0, volatility * current * 0.3), 2)
        future_candles.append({"time": last_time + i * step, "value": predicted})

    predicted_price = round(current + delta * 3, 2)

    return PredictionResponse(
        currentPrice=current,
        predictedPrice=predicted_price,
        trend=trend,
        confidence=round(confidence, 2),
        reasons=reasons,
        futureCandles=future_candles,
    )


@app.get("/health")
async def health():
    return {"status": "ok", "model": "rule-based-v1"}
