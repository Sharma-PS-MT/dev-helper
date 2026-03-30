"""
Feature Engineering Pipeline.
Transforms raw OHLCV + indicators DataFrame into 60+ ML-ready features.
Includes lagged features, rolling statistics, cross-indicator signals,
candle patterns, and market regime detection.
"""

import numpy as np
import pandas as pd
from config import ML_ENGINE_CONFIG as ML, INDICATOR_CONFIG as IC
from indicators.technical import compute_all_indicators


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Master feature engineering pipeline.
    Input:  DataFrame with OHLCV columns (open, high, low, close, volume).
    Output: DataFrame with 60+ feature columns + target columns.
    """
    # Step 1: Compute all technical indicators
    df = compute_all_indicators(df.copy())

    # Step 2: Price-derived features
    df = _price_features(df)

    # Step 3: Candle pattern features
    df = _candle_patterns(df)

    # Step 4: Lagged features
    df = _lagged_features(df)

    # Step 5: Rolling statistics
    df = _rolling_statistics(df)

    # Step 6: Cross-indicator features
    df = _cross_indicator_features(df)

    # Step 7: Market regime detection
    df = _market_regime(df)

    # Step 8: Target variable
    df = _create_targets(df)

    return df


# =============================================================================
# PRICE-DERIVED FEATURES
# =============================================================================

def _price_features(df: pd.DataFrame) -> pd.DataFrame:
    """Price relative to key levels."""
    c = df["close"]

    # Price relative to moving averages (%)
    if "sma_20" in df.columns:
        df["price_vs_sma20_pct"] = ((c - df["sma_20"]) / df["sma_20"] * 100).fillna(0)
    if "sma_50" in df.columns:
        df["price_vs_sma50_pct"] = ((c - df["sma_50"]) / df["sma_50"] * 100).fillna(0)
    if "ema_50" in df.columns:
        df["price_vs_ema50_pct"] = ((c - df["ema_50"]) / df["ema_50"] * 100).fillna(0)

    # Price relative to Bollinger Bands (% position within bands)
    if "bb_upper" in df.columns and "bb_lower" in df.columns:
        bb_range = (df["bb_upper"] - df["bb_lower"]).replace(0, np.nan)
        df["price_bb_position"] = ((c - df["bb_lower"]) / bb_range * 100).fillna(50)

    # Price relative to VWAP
    if "vwap" in df.columns:
        df["price_vs_vwap_pct"] = ((c - df["vwap"]) / df["vwap"] * 100).fillna(0)

    # Returns (percent change)
    df["return_1"] = c.pct_change(1).fillna(0) * 100
    df["return_3"] = c.pct_change(3).fillna(0) * 100
    df["return_5"] = c.pct_change(5).fillna(0) * 100
    df["return_10"] = c.pct_change(10).fillna(0) * 100

    # Log returns (more normally distributed)
    df["log_return_1"] = np.log(c / c.shift(1)).fillna(0)

    # Realized volatility
    df["realized_vol_10"] = df["log_return_1"].rolling(10).std().fillna(0) * np.sqrt(10)
    df["realized_vol_20"] = df["log_return_1"].rolling(20).std().fillna(0) * np.sqrt(20)

    return df


# =============================================================================
# CANDLE PATTERN FEATURES
# =============================================================================

def _candle_patterns(df: pd.DataFrame) -> pd.DataFrame:
    """Extract features from candlestick shape."""
    o, h, l, c = df["open"], df["high"], df["low"], df["close"]
    body = (c - o).abs()
    full_range = (h - l).replace(0, np.nan)

    # Body ratio — how much of the candle is body (vs wicks)
    df["body_ratio"] = (body / full_range).fillna(0)

    # Upper wick ratio
    upper_wick = h - pd.concat([o, c], axis=1).max(axis=1)
    df["upper_wick_ratio"] = (upper_wick / full_range).fillna(0)

    # Lower wick ratio
    lower_wick = pd.concat([o, c], axis=1).min(axis=1) - l
    df["lower_wick_ratio"] = (lower_wick / full_range).fillna(0)

    # Is bullish candle
    df["is_bullish"] = (c > o).astype(int)

    # Gap from previous close
    df["gap_pct"] = ((o - c.shift(1)) / c.shift(1) * 100).fillna(0)

    # Consecutive bullish/bearish candles
    df["consecutive_bullish"] = _consecutive_count(df["is_bullish"], 1)
    df["consecutive_bearish"] = _consecutive_count(df["is_bullish"], 0)

    return df


def _consecutive_count(series: pd.Series, target_val: int) -> pd.Series:
    """Count consecutive occurrences of target_val."""
    groups = (series != target_val).cumsum()
    counts = series.groupby(groups).cumsum()
    return counts.fillna(0).astype(int)


# =============================================================================
# LAGGED FEATURES
# =============================================================================

def _lagged_features(df: pd.DataFrame) -> pd.DataFrame:
    """Create lagged versions of key features."""
    lag_periods = ML["lag_periods"]

    # Lag close price returns
    for lag in lag_periods:
        df[f"close_lag_{lag}"] = df["close"].pct_change(lag).fillna(0) * 100

    # Lag RSI
    if "rsi" in df.columns:
        for lag in [1, 3, 5]:
            df[f"rsi_lag_{lag}"] = df["rsi"].shift(lag).fillna(50)

    # Lag MACD histogram
    if "macd_histogram" in df.columns:
        for lag in [1, 3]:
            df[f"macd_hist_lag_{lag}"] = df["macd_histogram"].shift(lag).fillna(0)

    # Lag volume ratio
    if "volume_ratio" in df.columns:
        df["volume_ratio_lag_1"] = df["volume_ratio"].shift(1).fillna(1)

    return df


# =============================================================================
# ROLLING STATISTICS
# =============================================================================

def _rolling_statistics(df: pd.DataFrame) -> pd.DataFrame:
    """Rolling mean, std, skewness of returns and indicators."""
    windows = ML["rolling_windows"]
    returns = df["log_return_1"] if "log_return_1" in df.columns else df["close"].pct_change().fillna(0)

    for w in windows:
        df[f"return_mean_{w}"] = returns.rolling(w).mean().fillna(0)
        df[f"return_std_{w}"] = returns.rolling(w).std().fillna(0)
        if w >= 10:
            df[f"return_skew_{w}"] = returns.rolling(w).skew().fillna(0)

    # Volume rolling stats
    if "volume" in df.columns:
        for w in [10, 20]:
            df[f"volume_mean_{w}"] = df["volume"].rolling(w).mean().fillna(0)
            df[f"volume_std_{w}"] = df["volume"].rolling(w).std().fillna(0)

    return df


# =============================================================================
# CROSS-INDICATOR FEATURES
# =============================================================================

def _cross_indicator_features(df: pd.DataFrame) -> pd.DataFrame:
    """Interaction features between indicators."""
    # RSI × MACD histogram — strong signal when both align
    if "rsi" in df.columns and "macd_histogram" in df.columns:
        rsi_normalized = (df["rsi"] - 50) / 50  # -1 to +1
        macd_sign = np.sign(df["macd_histogram"])
        df["rsi_macd_interaction"] = rsi_normalized * macd_sign

    # MACD histogram slope (acceleration)
    if "macd_histogram" in df.columns:
        df["macd_hist_slope"] = df["macd_histogram"].diff().fillna(0)

    # RSI divergence from price direction
    if "rsi" in df.columns:
        price_dir = np.sign(df["close"].diff())
        rsi_dir = np.sign(df["rsi"].diff())
        df["rsi_divergence"] = (price_dir != rsi_dir).astype(int)

    # MA crossover signals
    if "sma_20" in df.columns and "sma_50" in df.columns:
        df["ma_20_50_cross"] = np.sign(df["sma_20"] - df["sma_50"])
        df["ma_20_50_cross_change"] = df["ma_20_50_cross"].diff().fillna(0)

    # Bollinger Band squeeze (bandwidth below threshold)
    if "bb_bandwidth" in df.columns:
        df["bb_squeeze"] = (df["bb_bandwidth"] < df["bb_bandwidth"].rolling(50).quantile(0.2)).astype(int)

    # ATR normalized (relative to price)
    if "atr" in df.columns:
        df["atr_pct"] = (df["atr"] / df["close"] * 100).fillna(0)

    return df


# =============================================================================
# MARKET REGIME DETECTION
# =============================================================================

def _market_regime(df: pd.DataFrame) -> pd.DataFrame:
    """
    Classify market regime: trending vs ranging.
    Uses ADX for trend strength and volatility analysis.
    """
    if "adx" in df.columns:
        # ADX-based regime: 0=ranging, 1=trending, 2=strongly trending
        df["regime_adx"] = 0
        df.loc[df["adx"] > IC["adx_trend_threshold"], "regime_adx"] = 1
        df.loc[df["adx"] > IC["adx_strong_trend"], "regime_adx"] = 2

    # Volatility regime using ATR percentile
    if "atr_pct" in df.columns:
        atr_rolling_q = df["atr_pct"].rolling(100, min_periods=20).quantile(0.75)
        df["high_volatility"] = (df["atr_pct"] > atr_rolling_q).astype(int)

    return df


# =============================================================================
# TARGET VARIABLE
# =============================================================================

def _create_targets(df: pd.DataFrame) -> pd.DataFrame:
    """
    Create prediction target variables.
    - target_direction: 1 (UP) or 0 (DOWN) based on N-candle-ahead return
    - target_return: actual % return N candles ahead
    """
    horizon = ML["prediction_horizon"]
    future_close = df["close"].shift(-horizon)

    df["target_return"] = ((future_close - df["close"]) / df["close"] * 100).fillna(0)
    df["target_direction"] = (df["target_return"] > 0).astype(int)

    return df


# =============================================================================
# FEATURE SELECTION — Get clean feature matrix
# =============================================================================

def get_feature_columns(df: pd.DataFrame) -> list:
    """Return list of columns suitable for ML input (excludes raw OHLCV + targets)."""
    exclude = {
        "time", "open", "high", "low", "close", "volume",
        "target_return", "target_direction",
    }
    return [col for col in df.columns if col not in exclude and df[col].dtype in [np.float64, np.int64, np.float32, np.int32, float, int]]
