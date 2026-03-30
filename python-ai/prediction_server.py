"""
Dev-Helper AI Prediction Microservice — Production Server
FastAPI server providing dual-mode crypto price predictions:
  1. Rule-Based Mode: Weighted signal confluence from 15+ technical indicators
  2. ML Prediction Mode: XGBoost ensemble with Optuna-tuned hyperparameters

Also provides backtesting, model training, and Gemini AI interpretation.

Usage:
  pip install -r requirements.txt
  uvicorn prediction_server:app --host 0.0.0.0 --port 8000
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import pandas as pd

from data.fetcher import fetch_candles, candles_from_request
from engines import rule_engine, ml_engine
from gemini.interpreter import interpret_prediction, analyze_sentiment
from validation.backtester import run_backtest

app = FastAPI(title="Crypto AI Prediction Server", version="2.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# =============================================================================
# REQUEST / RESPONSE MODELS
# =============================================================================

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
    mode: str = "rule"                  # "rule" or "ml"
    geminiApiKey: Optional[str] = None  # For NL interpretation


class TrainRequest(BaseModel):
    symbol: str
    interval: str
    candles: Optional[List[Candle]] = None  # If None, fetch from Binance
    limit: int = 2000


class BacktestRequest(BaseModel):
    symbol: str
    interval: str
    mode: str = "rule"                  # "rule" or "ml"
    candles: Optional[List[Candle]] = None
    limit: int = 1000


class SentimentRequest(BaseModel):
    symbol: str
    geminiApiKey: str


# =============================================================================
# ENDPOINTS
# =============================================================================

@app.post("/predict")
async def predict(req: PredictionRequest):
    """
    Run prediction using specified mode.
    - mode="rule": Rule-based with signal confluence (all parameters in output)
    - mode="ml": XGBoost ML with feature importances
    Optionally adds Gemini NL interpretation if API key is provided.
    """
    # Convert candles to DataFrame
    candle_dicts = [c.model_dump() for c in req.candles]
    df = candles_from_request(candle_dicts)

    if len(df) < 30:
        return {"error": "Need at least 30 candles for prediction"}

    # Run appropriate engine
    if req.mode == "ml":
        result = ml_engine.predict(df, req.symbol, req.interval)
    else:
        result = rule_engine.predict(df)

    # Optional: Gemini NL interpretation
    if req.geminiApiKey:
        interpretation = interpret_prediction(result, req.symbol, req.interval, req.geminiApiKey)
        result["geminiInterpretation"] = interpretation

        # Also get sentiment
        sentiment = analyze_sentiment(req.symbol, req.geminiApiKey)
        result["sentiment"] = sentiment

    return result


@app.post("/train")
async def train_model(req: TrainRequest):
    """
    Train/retrain the XGBoost model for a symbol+interval pair.
    Can use provided candles or fetch from Binance.
    """
    if req.candles:
        candle_dicts = [c.model_dump() for c in req.candles]
        df = candles_from_request(candle_dicts)
    else:
        df = fetch_candles(req.symbol, req.interval, req.limit)

    if len(df) < 500:
        return {"error": f"Need at least 500 candles for training, got {len(df)}"}

    metrics = ml_engine.train(df, req.symbol, req.interval)
    return {"status": "ok", "metrics": metrics}


@app.post("/backtest")
async def backtest(req: BacktestRequest):
    """
    Run backtesting on historical data using specified mode.
    Returns trades list and performance metrics (Sharpe, drawdown, win rate).
    """
    if req.candles:
        candle_dicts = [c.model_dump() for c in req.candles]
        df = candles_from_request(candle_dicts)
    else:
        df = fetch_candles(req.symbol, req.interval, req.limit)

    if len(df) < 100:
        return {"error": f"Need at least 100 candles for backtesting, got {len(df)}"}

    result = run_backtest(df, req.mode, req.symbol, req.interval)
    return result


@app.post("/sentiment")
async def sentiment(req: SentimentRequest):
    """Get Gemini-powered market sentiment analysis for a symbol."""
    result = analyze_sentiment(req.symbol, req.geminiApiKey)
    return result


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "version": "2.0.0",
        "modes": ["rule-based", "xgboost-ml"],
        "endpoints": ["/predict", "/train", "/backtest", "/sentiment", "/health"],
    }
