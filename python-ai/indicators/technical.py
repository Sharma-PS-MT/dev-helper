"""
Comprehensive Technical Indicator Library.
Computes 15+ indicators from OHLCV data using pandas.
All functions accept pandas Series/DataFrames and return pandas Series.
"""

import numpy as np
import pandas as pd
from config import INDICATOR_CONFIG as IC


# =============================================================================
# MOVING AVERAGES
# =============================================================================

def sma(series: pd.Series, period: int) -> pd.Series:
    """Simple Moving Average."""
    return series.rolling(window=period, min_periods=period).mean()


def ema(series: pd.Series, period: int) -> pd.Series:
    """Exponential Moving Average."""
    return series.ewm(span=period, adjust=False).mean()


# =============================================================================
# RSI — Relative Strength Index
# =============================================================================

def rsi(close: pd.Series, period: int = None) -> pd.Series:
    """
    RSI using Wilder's smoothing method.
    Returns values 0-100 where <30 = oversold, >70 = overbought.
    """
    period = period or IC["rsi_period"]
    delta = close.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = (-delta).where(delta < 0, 0.0)

    avg_gain = gain.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()

    rs = avg_gain / avg_loss.replace(0, np.nan)
    result = 100.0 - (100.0 / (1.0 + rs))
    return result.fillna(50.0)


def stochastic_rsi(close: pd.Series, period: int = None,
                   smooth_k: int = None, smooth_d: int = None) -> tuple:
    """
    Stochastic RSI — RSI of RSI.
    Returns (stoch_k, stoch_d) both 0-100.
    """
    period = period or IC["stoch_rsi_period"]
    smooth_k = smooth_k or IC["stoch_rsi_smooth_k"]
    smooth_d = smooth_d or IC["stoch_rsi_smooth_d"]

    rsi_vals = rsi(close, period)
    rsi_min = rsi_vals.rolling(window=period).min()
    rsi_max = rsi_vals.rolling(window=period).max()

    stoch = ((rsi_vals - rsi_min) / (rsi_max - rsi_min).replace(0, np.nan)) * 100
    k = stoch.rolling(window=smooth_k).mean().fillna(50.0)
    d = k.rolling(window=smooth_d).mean().fillna(50.0)
    return k, d


# =============================================================================
# MACD — Moving Average Convergence Divergence
# =============================================================================

def macd(close: pd.Series, fast: int = None, slow: int = None,
         signal_period: int = None) -> tuple:
    """
    MACD indicator.
    Returns (macd_line, signal_line, histogram).
    """
    fast = fast or IC["macd_fast"]
    slow = slow or IC["macd_slow"]
    signal_period = signal_period or IC["macd_signal"]

    ema_fast = ema(close, fast)
    ema_slow = ema(close, slow)
    macd_line = ema_fast - ema_slow
    signal_line = ema(macd_line, signal_period)
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


# =============================================================================
# BOLLINGER BANDS
# =============================================================================

def bollinger_bands(close: pd.Series, period: int = None,
                    std_dev: float = None) -> tuple:
    """
    Bollinger Bands.
    Returns (upper_band, middle_band, lower_band, bandwidth_pct).
    """
    period = period or IC["bb_period"]
    std_dev = std_dev or IC["bb_std_dev"]

    middle = sma(close, period)
    rolling_std = close.rolling(window=period).std()
    upper = middle + std_dev * rolling_std
    lower = middle - std_dev * rolling_std

    # Bandwidth as percentage (measures squeeze)
    bandwidth = ((upper - lower) / middle * 100).fillna(0)
    return upper, lower, middle, bandwidth


# =============================================================================
# ATR — Average True Range
# =============================================================================

def atr(high: pd.Series, low: pd.Series, close: pd.Series,
        period: int = None) -> pd.Series:
    """
    Average True Range — measures volatility.
    Higher ATR = more volatile market.
    """
    period = period or IC["atr_period"]
    prev_close = close.shift(1)
    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low - prev_close).abs()
    ], axis=1).max(axis=1)
    return tr.rolling(window=period, min_periods=1).mean()


# =============================================================================
# ADX — Average Directional Index
# =============================================================================

def adx(high: pd.Series, low: pd.Series, close: pd.Series,
        period: int = None) -> tuple:
    """
    ADX — measures trend strength (not direction).
    ADX > 25 = trending, > 40 = strong trend.
    Returns (adx_value, plus_di, minus_di).
    """
    period = period or IC["adx_period"]

    plus_dm = high.diff()
    minus_dm = -low.diff()
    plus_dm = plus_dm.where((plus_dm > minus_dm) & (plus_dm > 0), 0.0)
    minus_dm = minus_dm.where((minus_dm > plus_dm) & (minus_dm > 0), 0.0)

    atr_vals = atr(high, low, close, period)

    plus_di = 100 * (plus_dm.ewm(alpha=1.0 / period, adjust=False).mean() /
                     atr_vals.replace(0, np.nan))
    minus_di = 100 * (minus_dm.ewm(alpha=1.0 / period, adjust=False).mean() /
                      atr_vals.replace(0, np.nan))

    dx = 100 * ((plus_di - minus_di).abs() /
                (plus_di + minus_di).replace(0, np.nan))
    adx_val = dx.ewm(alpha=1.0 / period, adjust=False).mean()

    return adx_val.fillna(0), plus_di.fillna(0), minus_di.fillna(0)


# =============================================================================
# OBV — On-Balance Volume
# =============================================================================

def obv(close: pd.Series, volume: pd.Series) -> pd.Series:
    """
    On-Balance Volume — cumulative volume indicator.
    Rising OBV confirms uptrend, falling OBV confirms downtrend.
    """
    direction = np.sign(close.diff()).fillna(0)
    return (direction * volume).cumsum()


# =============================================================================
# VWAP — Volume Weighted Average Price
# =============================================================================

def vwap(high: pd.Series, low: pd.Series, close: pd.Series,
         volume: pd.Series) -> pd.Series:
    """
    VWAP — price weighted by volume.
    Price above VWAP = bullish, below = bearish.
    """
    typical_price = (high + low + close) / 3
    cum_tp_vol = (typical_price * volume).cumsum()
    cum_vol = volume.cumsum()
    return cum_tp_vol / cum_vol.replace(0, np.nan)


# =============================================================================
# ROC — Rate of Change
# =============================================================================

def roc(close: pd.Series, period: int = None) -> pd.Series:
    """Rate of Change — momentum oscillator as percentage."""
    period = period or IC["roc_period"]
    return ((close - close.shift(period)) / close.shift(period) * 100).fillna(0)


# =============================================================================
# ICHIMOKU CLOUD
# =============================================================================

def ichimoku(high: pd.Series, low: pd.Series, close: pd.Series) -> dict:
    """
    Ichimoku Cloud indicator.
    Returns dict with conversion_line, base_line, span_a, span_b.
    """
    conv_period = IC["ichimoku_conversion"]
    base_period = IC["ichimoku_base"]
    span_b_period = IC["ichimoku_span_b"]

    conversion = (high.rolling(conv_period).max() + low.rolling(conv_period).min()) / 2
    base = (high.rolling(base_period).max() + low.rolling(base_period).min()) / 2
    span_a = ((conversion + base) / 2).shift(base_period)
    span_b = ((high.rolling(span_b_period).max() +
               low.rolling(span_b_period).min()) / 2).shift(base_period)

    return {
        "conversion": conversion.fillna(close),
        "base": base.fillna(close),
        "span_a": span_a.fillna(close),
        "span_b": span_b.fillna(close),
    }


# =============================================================================
# VOLUME INDICATORS
# =============================================================================

def volume_sma_ratio(volume: pd.Series, period: int = None) -> pd.Series:
    """Volume relative to its SMA — ratio > 1.5 indicates surge."""
    period = period or IC["volume_sma_period"]
    vol_sma = sma(volume, period)
    return (volume / vol_sma.replace(0, np.nan)).fillna(1.0)


# =============================================================================
# MASTER COMPUTATION — All Indicators at Once
# =============================================================================

def compute_all_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute all technical indicators and append them as columns to the DataFrame.
    Expects DataFrame with columns: open, high, low, close, volume.
    Returns the same DataFrame with ~30 new indicator columns added.
    """
    c, h, l, v = df["close"], df["high"], df["low"], df["volume"]

    # Moving Averages
    df["sma_20"] = sma(c, IC["sma_fast"])
    df["sma_50"] = sma(c, IC["sma_medium"])
    df["sma_200"] = sma(c, IC["sma_slow"])
    df["ema_12"] = ema(c, IC["ema_fast"])
    df["ema_26"] = ema(c, IC["ema_medium"])
    df["ema_50"] = ema(c, IC["ema_slow"])

    # RSI
    df["rsi"] = rsi(c)

    # Stochastic RSI
    df["stoch_rsi_k"], df["stoch_rsi_d"] = stochastic_rsi(c)

    # MACD
    df["macd_line"], df["macd_signal"], df["macd_histogram"] = macd(c)

    # Bollinger Bands
    df["bb_upper"], df["bb_lower"], df["bb_middle"], df["bb_bandwidth"] = bollinger_bands(c)

    # ATR
    df["atr"] = atr(h, l, c)

    # ADX
    df["adx"], df["plus_di"], df["minus_di"] = adx(h, l, c)

    # OBV
    df["obv"] = obv(c, v)

    # VWAP
    df["vwap"] = vwap(h, l, c, v)

    # Volume ratio
    df["volume_ratio"] = volume_sma_ratio(v)

    # ROC
    df["roc"] = roc(c)

    # Ichimoku
    ichi = ichimoku(h, l, c)
    df["ichimoku_conversion"] = ichi["conversion"]
    df["ichimoku_base"] = ichi["base"]
    df["ichimoku_span_a"] = ichi["span_a"]
    df["ichimoku_span_b"] = ichi["span_b"]

    return df
