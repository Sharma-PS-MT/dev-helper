"""
Rule-Based Trading Engine with Signal Confluence.
Each indicator produces a weighted signal. The final prediction is derived
from the weighted aggregate score with volume & regime filters applied.
All parameters are included in the output for full transparency.
"""

import numpy as np
import pandas as pd
from config import INDICATOR_CONFIG as IC, RULE_ENGINE_CONFIG as RC
from indicators.technical import compute_all_indicators


# Signal strength constants
STRONG_BUY = RC["STRONG_BUY"]    # +2
BUY = RC["BUY"]                  # +1
NEUTRAL = RC["NEUTRAL"]          # 0
SELL = RC["SELL"]                 # -1
STRONG_SELL = RC["STRONG_SELL"]  # -2

WEIGHTS = RC["weights"]


def predict(df: pd.DataFrame) -> dict:
    """
    Run rule-based prediction on OHLCV DataFrame.
    Returns a comprehensive prediction dict with per-indicator breakdown.
    """
    df = compute_all_indicators(df.copy())
    last = df.iloc[-1]
    current_price = float(last["close"])

    signals = []
    reasons = []

    # ------------------------------------------------------------------
    # 1. RSI SIGNAL
    # ------------------------------------------------------------------
    rsi_val = float(last.get("rsi", 50))
    rsi_signal, rsi_reason = _evaluate_rsi(rsi_val)
    signals.append(("rsi", rsi_signal))
    reasons.append(rsi_reason)

    # ------------------------------------------------------------------
    # 2. MACD SIGNAL
    # ------------------------------------------------------------------
    macd_line_val = float(last.get("macd_line", 0))
    macd_signal_val = float(last.get("macd_signal", 0))
    macd_hist_val = float(last.get("macd_histogram", 0))

    # MACD crossover
    prev = df.iloc[-2] if len(df) > 1 else last
    prev_hist = float(prev.get("macd_histogram", 0))

    sig, reason = _evaluate_macd_crossover(macd_line_val, macd_signal_val, macd_hist_val, prev_hist)
    signals.append(("macd", sig))
    reasons.append(reason)

    # MACD histogram momentum
    sig_h, reason_h = _evaluate_macd_histogram(macd_hist_val, prev_hist)
    signals.append(("macd_histogram", sig_h))
    reasons.append(reason_h)

    # ------------------------------------------------------------------
    # 3. BOLLINGER BANDS SIGNAL
    # ------------------------------------------------------------------
    bb_upper = float(last.get("bb_upper", current_price))
    bb_lower = float(last.get("bb_lower", current_price))
    bb_bw = float(last.get("bb_bandwidth", 0))
    sig_bb, reason_bb = _evaluate_bollinger(current_price, bb_upper, bb_lower, bb_bw)
    signals.append(("bollinger_bands", sig_bb))
    reasons.append(reason_bb)

    # ------------------------------------------------------------------
    # 4. MA CROSSOVER & TREND
    # ------------------------------------------------------------------
    sma20 = float(last.get("sma_20", current_price))
    sma50 = float(last.get("sma_50", current_price))
    ema12 = float(last.get("ema_12", current_price))
    ema26 = float(last.get("ema_26", current_price))

    sig_mac, reason_mac = _evaluate_ma_crossover(current_price, sma20, sma50, ema12, ema26)
    signals.append(("ma_crossover", sig_mac))
    reasons.append(reason_mac)

    sig_mat, reason_mat = _evaluate_ma_trend(current_price, sma20, sma50)
    signals.append(("ma_trend", sig_mat))
    reasons.append(reason_mat)

    # ------------------------------------------------------------------
    # 5. STOCHASTIC RSI
    # ------------------------------------------------------------------
    stoch_k = float(last.get("stoch_rsi_k", 50))
    stoch_d = float(last.get("stoch_rsi_d", 50))
    sig_sr, reason_sr = _evaluate_stoch_rsi(stoch_k, stoch_d)
    signals.append(("stoch_rsi", sig_sr))
    reasons.append(reason_sr)

    # ------------------------------------------------------------------
    # 6. OBV TREND
    # ------------------------------------------------------------------
    if len(df) > 20:
        obv_now = float(last.get("obv", 0))
        obv_20ago = float(df.iloc[-20].get("obv", 0))
        sig_obv, reason_obv = _evaluate_obv(obv_now, obv_20ago, current_price,
                                            float(df.iloc[-20]["close"]))
        signals.append(("obv_trend", sig_obv))
        reasons.append(reason_obv)

    # ------------------------------------------------------------------
    # 7. ROC
    # ------------------------------------------------------------------
    roc_val = float(last.get("roc", 0))
    sig_roc, reason_roc = _evaluate_roc(roc_val)
    signals.append(("roc", sig_roc))
    reasons.append(reason_roc)

    # ------------------------------------------------------------------
    # 8. ICHIMOKU CLOUD
    # ------------------------------------------------------------------
    ichi_conv = float(last.get("ichimoku_conversion", current_price))
    ichi_base = float(last.get("ichimoku_base", current_price))
    ichi_spa = float(last.get("ichimoku_span_a", current_price))
    ichi_spb = float(last.get("ichimoku_span_b", current_price))
    sig_ichi, reason_ichi = _evaluate_ichimoku(current_price, ichi_conv, ichi_base, ichi_spa, ichi_spb)
    signals.append(("ichimoku", sig_ichi))
    reasons.append(reason_ichi)

    # ------------------------------------------------------------------
    # 9. ATR VOLATILITY
    # ------------------------------------------------------------------
    atr_val = float(last.get("atr", 0))
    atr_pct = atr_val / current_price * 100 if current_price > 0 else 0
    sig_atr, reason_atr = _evaluate_atr(atr_pct)
    signals.append(("atr_volatility", sig_atr))
    reasons.append(reason_atr)

    # ------------------------------------------------------------------
    # VOLUME FILTER
    # ------------------------------------------------------------------
    vol_ratio = float(last.get("volume_ratio", 1.0))
    volume_pass = vol_ratio >= IC["volume_filter_min"]
    vol_reason = (f"Volume ratio = {vol_ratio:.2f}× avg "
                  f"→ {'High volume confirms signal' if volume_pass else 'Low volume — signal weakened'} "
                  f"[FILTER: {'PASS' if volume_pass else 'WEAK'}]")
    signals.append(("volume", BUY if vol_ratio > IC["volume_surge_multiplier"] else NEUTRAL))
    reasons.append(vol_reason)

    # ------------------------------------------------------------------
    # ADX REGIME FILTER
    # ------------------------------------------------------------------
    adx_val = float(last.get("adx", 0))
    is_trending = adx_val > IC["adx_trend_threshold"]
    adx_reason = (f"ADX({IC['adx_period']}) = {adx_val:.1f} "
                  f"{'> ' + str(IC['adx_trend_threshold']) + ' → Trending market, momentum signals weighted higher' if is_trending else '< ' + str(IC['adx_trend_threshold']) + ' → Ranging market, mean-reversion signals preferred'}")
    reasons.append(adx_reason)

    # ------------------------------------------------------------------
    # COMPUTE CONFLUENCE SCORE
    # ------------------------------------------------------------------
    weighted_score = 0.0
    bullish_count = 0
    bearish_count = 0

    for name, sig in signals:
        weight = WEIGHTS.get(name, 0.5)
        # In ranging markets, reduce momentum signal weights
        if not is_trending and name in ["macd", "macd_histogram", "roc"]:
            weight *= 0.6
        # In trending markets, reduce mean-reversion weights
        if is_trending and name in ["bollinger_bands", "stoch_rsi"]:
            weight *= 0.7

        if not volume_pass and name not in ["volume", "atr_volatility"]:
            weight *= 0.7  # Reduce all signal weights on low volume

        weighted_score += sig * weight
        if sig > 0:
            bullish_count += 1
        elif sig < 0:
            bearish_count += 1

    # Determine trend
    if weighted_score >= RC["strong_buy_threshold"]:
        trend = "UP"
    elif weighted_score >= RC["buy_threshold"]:
        trend = "UP"
    elif weighted_score <= RC["strong_sell_threshold"]:
        trend = "DOWN"
    elif weighted_score <= RC["sell_threshold"]:
        trend = "DOWN"
    else:
        trend = "NEUTRAL"

    # Confidence based on indicator agreement and score magnitude
    total_signals = bullish_count + bearish_count
    agreement = abs(bullish_count - bearish_count) / max(1, total_signals)
    score_magnitude = min(1.0, abs(weighted_score) / 8.0)
    confidence = round(min(0.95, agreement * 0.4 + score_magnitude * 0.4 + 0.15), 2)

    # Generate future price projections
    recent_returns = df["close"].pct_change().tail(10).mean()
    trend_mult = 1 if trend == "UP" else -1 if trend == "DOWN" else 0
    delta = current_price * abs(recent_returns) * trend_mult * confidence
    last_time = int(last.get("time", 0))

    future_candles = []
    for i in range(1, 6):
        noise = np.random.normal(0, abs(delta) * 0.2) if delta != 0 else 0
        projected = round(current_price + delta * i + noise, 2)
        future_candles.append({"time": last_time + i * 300, "value": projected})

    predicted_price = round(current_price + delta * 3, 2)

    return {
        "currentPrice": current_price,
        "predictedPrice": predicted_price,
        "trend": trend,
        "confidence": confidence,
        "reasons": reasons,
        "futureCandles": future_candles,
        "source": "rule-based",
        "mode": "rule",
        "confluenceScore": round(weighted_score, 2),
        "indicators": {
            "rsi": round(rsi_val, 1),
            "macd_line": round(macd_line_val, 4),
            "macd_signal": round(macd_signal_val, 4),
            "macd_histogram": round(macd_hist_val, 4),
            "bb_upper": round(bb_upper, 2),
            "bb_lower": round(bb_lower, 2),
            "bb_bandwidth": round(bb_bw, 2),
            "sma_20": round(sma20, 2),
            "sma_50": round(sma50, 2),
            "adx": round(adx_val, 1),
            "atr": round(atr_val, 2),
            "atr_pct": round(atr_pct, 3),
            "volume_ratio": round(vol_ratio, 2),
            "stoch_rsi_k": round(stoch_k, 1),
            "stoch_rsi_d": round(stoch_d, 1),
            "roc": round(roc_val, 2),
        },
    }


# =============================================================================
# INDIVIDUAL INDICATOR EVALUATORS
# =============================================================================

def _evaluate_rsi(rsi_val: float) -> tuple:
    if rsi_val < IC["rsi_extreme_oversold"]:
        return STRONG_BUY, f"RSI({IC['rsi_period']}) = {rsi_val:.1f} < {IC['rsi_extreme_oversold']} → Extremely oversold [STRONG_BUY, weight={WEIGHTS['rsi']}]"
    elif rsi_val < IC["rsi_oversold"]:
        return BUY, f"RSI({IC['rsi_period']}) = {rsi_val:.1f} < {IC['rsi_oversold']} → Oversold [BUY, weight={WEIGHTS['rsi']}]"
    elif rsi_val > IC["rsi_extreme_overbought"]:
        return STRONG_SELL, f"RSI({IC['rsi_period']}) = {rsi_val:.1f} > {IC['rsi_extreme_overbought']} → Extremely overbought [STRONG_SELL, weight={WEIGHTS['rsi']}]"
    elif rsi_val > IC["rsi_overbought"]:
        return SELL, f"RSI({IC['rsi_period']}) = {rsi_val:.1f} > {IC['rsi_overbought']} → Overbought [SELL, weight={WEIGHTS['rsi']}]"
    else:
        return NEUTRAL, f"RSI({IC['rsi_period']}) = {rsi_val:.1f} → Neutral zone [{IC['rsi_oversold']}-{IC['rsi_overbought']}] [NEUTRAL]"


def _evaluate_macd_crossover(macd_l: float, macd_s: float, hist: float, prev_hist: float) -> tuple:
    if hist > 0 and prev_hist <= 0:
        return STRONG_BUY, f"MACD({IC['macd_fast']},{IC['macd_slow']},{IC['macd_signal']}) bullish crossover → histogram turned positive [STRONG_BUY, weight={WEIGHTS['macd']}]"
    elif hist < 0 and prev_hist >= 0:
        return STRONG_SELL, f"MACD({IC['macd_fast']},{IC['macd_slow']},{IC['macd_signal']}) bearish crossover → histogram turned negative [STRONG_SELL, weight={WEIGHTS['macd']}]"
    elif macd_l > macd_s:
        return BUY, f"MACD({IC['macd_fast']},{IC['macd_slow']},{IC['macd_signal']}) line={macd_l:.4f} > signal={macd_s:.4f} → Bullish [BUY, weight={WEIGHTS['macd']}]"
    elif macd_l < macd_s:
        return SELL, f"MACD({IC['macd_fast']},{IC['macd_slow']},{IC['macd_signal']}) line={macd_l:.4f} < signal={macd_s:.4f} → Bearish [SELL, weight={WEIGHTS['macd']}]"
    return NEUTRAL, f"MACD({IC['macd_fast']},{IC['macd_slow']},{IC['macd_signal']}) flat → [NEUTRAL]"


def _evaluate_macd_histogram(hist: float, prev_hist: float) -> tuple:
    slope = hist - prev_hist
    if hist > 0 and slope > 0:
        return BUY, f"MACD histogram = {hist:.4f}, slope = +{slope:.4f} → Accelerating bullish momentum [BUY, weight={WEIGHTS['macd_histogram']}]"
    elif hist > 0 and slope < 0:
        return NEUTRAL, f"MACD histogram = {hist:.4f}, slope = {slope:.4f} → Bullish but decelerating [NEUTRAL]"
    elif hist < 0 and slope < 0:
        return SELL, f"MACD histogram = {hist:.4f}, slope = {slope:.4f} → Accelerating bearish momentum [SELL, weight={WEIGHTS['macd_histogram']}]"
    elif hist < 0 and slope > 0:
        return NEUTRAL, f"MACD histogram = {hist:.4f}, slope = +{slope:.4f} → Bearish but recovering [NEUTRAL]"
    return NEUTRAL, f"MACD histogram = {hist:.4f} → Flat [NEUTRAL]"


def _evaluate_bollinger(price: float, upper: float, lower: float, bw: float) -> tuple:
    if price <= lower:
        return STRONG_BUY, f"Price ${price:.2f} at/below lower Bollinger Band({IC['bb_period']},{IC['bb_std_dev']}σ) = ${lower:.2f} → Mean reversion expected [STRONG_BUY, weight={WEIGHTS['bollinger_bands']}]"
    elif price >= upper:
        return STRONG_SELL, f"Price ${price:.2f} at/above upper Bollinger Band({IC['bb_period']},{IC['bb_std_dev']}σ) = ${upper:.2f} → Overextended [STRONG_SELL, weight={WEIGHTS['bollinger_bands']}]"
    elif price < lower * 1.01:
        return BUY, f"Price ${price:.2f} near lower BB = ${lower:.2f} (within 1%) → Potential bounce [BUY, weight={WEIGHTS['bollinger_bands']}]"
    elif price > upper * 0.99:
        return SELL, f"Price ${price:.2f} near upper BB = ${upper:.2f} (within 1%) → Potential pullback [SELL, weight={WEIGHTS['bollinger_bands']}]"
    return NEUTRAL, f"Price ${price:.2f} inside Bollinger Bands [${lower:.2f} — ${upper:.2f}] bandwidth={bw:.1f}% [NEUTRAL]"


def _evaluate_ma_crossover(price: float, sma20: float, sma50: float,
                           ema12: float, ema26: float) -> tuple:
    if ema12 > ema26 and sma20 > sma50:
        return BUY, f"EMA(12)=${ema12:.2f} > EMA(26)=${ema26:.2f} & SMA(20) > SMA(50) → Golden alignment [BUY, weight={WEIGHTS['ma_crossover']}]"
    elif ema12 < ema26 and sma20 < sma50:
        return SELL, f"EMA(12)=${ema12:.2f} < EMA(26)=${ema26:.2f} & SMA(20) < SMA(50) → Death alignment [SELL, weight={WEIGHTS['ma_crossover']}]"
    return NEUTRAL, f"MA crossover mixed — EMA(12/26) and SMA(20/50) not aligned [NEUTRAL]"


def _evaluate_ma_trend(price: float, sma20: float, sma50: float) -> tuple:
    above_20 = price > sma20
    above_50 = price > sma50
    if above_20 and above_50:
        return BUY, f"Price ${price:.2f} above SMA(20)=${sma20:.2f} & SMA(50)=${sma50:.2f} → Uptrend [BUY, weight={WEIGHTS['ma_trend']}]"
    elif not above_20 and not above_50:
        return SELL, f"Price ${price:.2f} below SMA(20)=${sma20:.2f} & SMA(50)=${sma50:.2f} → Downtrend [SELL, weight={WEIGHTS['ma_trend']}]"
    return NEUTRAL, f"Price ${price:.2f} between SMA(20)=${sma20:.2f} and SMA(50)=${sma50:.2f} → Mixed [NEUTRAL]"


def _evaluate_stoch_rsi(k: float, d: float) -> tuple:
    if k < 20 and d < 20:
        return STRONG_BUY, f"StochRSI K={k:.1f}, D={d:.1f} — Both deeply oversold [STRONG_BUY, weight={WEIGHTS['stoch_rsi']}]"
    elif k < 30:
        return BUY, f"StochRSI K={k:.1f}, D={d:.1f} — Oversold zone [BUY, weight={WEIGHTS['stoch_rsi']}]"
    elif k > 80 and d > 80:
        return STRONG_SELL, f"StochRSI K={k:.1f}, D={d:.1f} — Both deeply overbought [STRONG_SELL, weight={WEIGHTS['stoch_rsi']}]"
    elif k > 70:
        return SELL, f"StochRSI K={k:.1f}, D={d:.1f} — Overbought zone [SELL, weight={WEIGHTS['stoch_rsi']}]"
    return NEUTRAL, f"StochRSI K={k:.1f}, D={d:.1f} — Neutral [NEUTRAL]"


def _evaluate_obv(obv_now: float, obv_20ago: float, price_now: float, price_20ago: float) -> tuple:
    obv_trend = "up" if obv_now > obv_20ago else "down"
    price_trend = "up" if price_now > price_20ago else "down"
    if obv_trend == "up" and price_trend == "up":
        return BUY, f"OBV trending up confirming price uptrend → Volume supports bulls [BUY, weight={WEIGHTS['obv_trend']}]"
    elif obv_trend == "down" and price_trend == "down":
        return SELL, f"OBV trending down confirming price downtrend → Volume supports bears [SELL, weight={WEIGHTS['obv_trend']}]"
    elif obv_trend == "up" and price_trend == "down":
        return BUY, f"OBV divergence: volume accumulating despite price decline → Hidden bullish [BUY, weight={WEIGHTS['obv_trend']}]"
    else:
        return SELL, f"OBV divergence: volume declining despite price rise → Hidden bearish [SELL, weight={WEIGHTS['obv_trend']}]"


def _evaluate_roc(roc_val: float) -> tuple:
    if roc_val > 5:
        return BUY, f"ROC({IC['roc_period']}) = {roc_val:.2f}% → Strong upward momentum [BUY, weight={WEIGHTS['roc']}]"
    elif roc_val < -5:
        return SELL, f"ROC({IC['roc_period']}) = {roc_val:.2f}% → Strong downward momentum [SELL, weight={WEIGHTS['roc']}]"
    return NEUTRAL, f"ROC({IC['roc_period']}) = {roc_val:.2f}% → Weak momentum [NEUTRAL]"


def _evaluate_ichimoku(price: float, conv: float, base: float,
                       span_a: float, span_b: float) -> tuple:
    cloud_top = max(span_a, span_b)
    cloud_bottom = min(span_a, span_b)
    if price > cloud_top and conv > base:
        return BUY, f"Ichimoku: Price ${price:.2f} above cloud [${cloud_bottom:.2f}-${cloud_top:.2f}], conversion > base → Strong bullish [BUY, weight={WEIGHTS['ichimoku']}]"
    elif price < cloud_bottom and conv < base:
        return SELL, f"Ichimoku: Price ${price:.2f} below cloud [${cloud_bottom:.2f}-${cloud_top:.2f}], conversion < base → Strong bearish [SELL, weight={WEIGHTS['ichimoku']}]"
    elif price > cloud_bottom and price < cloud_top:
        return NEUTRAL, f"Ichimoku: Price ${price:.2f} inside cloud [${cloud_bottom:.2f}-${cloud_top:.2f}] → Indecisive [NEUTRAL]"
    return NEUTRAL, f"Ichimoku: Mixed signals — price vs cloud ambiguous [NEUTRAL]"


def _evaluate_atr(atr_pct: float) -> tuple:
    if atr_pct > 3.0:
        return NEUTRAL, f"ATR% = {atr_pct:.2f}% → Extremely high volatility, reduce position size [CAUTION]"
    elif atr_pct > 1.5:
        return NEUTRAL, f"ATR% = {atr_pct:.2f}% → Elevated volatility, wider stops needed [NEUTRAL]"
    return NEUTRAL, f"ATR% = {atr_pct:.2f}% → Normal volatility [NEUTRAL]"
