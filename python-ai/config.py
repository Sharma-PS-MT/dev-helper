"""
Central configuration for the Crypto AI Trading Engine.
All tunable parameters, thresholds, and weights are defined here.
"""

# =============================================================================
# TECHNICAL INDICATOR PERIODS
# =============================================================================
INDICATOR_CONFIG = {
    # Moving Averages
    "sma_fast": 20,
    "sma_medium": 50,
    "sma_slow": 200,
    "ema_fast": 12,
    "ema_medium": 26,
    "ema_slow": 50,

    # RSI
    "rsi_period": 14,
    "rsi_oversold": 30,
    "rsi_overbought": 70,
    "rsi_extreme_oversold": 20,
    "rsi_extreme_overbought": 80,

    # Stochastic RSI
    "stoch_rsi_period": 14,
    "stoch_rsi_smooth_k": 3,
    "stoch_rsi_smooth_d": 3,

    # MACD
    "macd_fast": 12,
    "macd_slow": 26,
    "macd_signal": 9,

    # Bollinger Bands
    "bb_period": 20,
    "bb_std_dev": 2.0,

    # ATR & ADX
    "atr_period": 14,
    "adx_period": 14,
    "adx_trend_threshold": 25,      # ADX > 25 = trending market
    "adx_strong_trend": 40,         # ADX > 40 = strong trend

    # Volume
    "volume_sma_period": 20,
    "volume_surge_multiplier": 1.5,  # volume > 1.5x avg = surge
    "volume_filter_min": 1.2,        # minimum volume ratio to validate signals

    # ROC (Rate of Change)
    "roc_period": 10,

    # Ichimoku Cloud
    "ichimoku_conversion": 9,
    "ichimoku_base": 26,
    "ichimoku_span_b": 52,
}

# =============================================================================
# RULE ENGINE — SIGNAL WEIGHTS & CONFLUENCE
# =============================================================================
RULE_ENGINE_CONFIG = {
    # Signal strength values
    "STRONG_BUY": 2,
    "BUY": 1,
    "NEUTRAL": 0,
    "SELL": -1,
    "STRONG_SELL": -2,

    # Per-indicator weights in confluence scoring
    "weights": {
        "rsi": 1.5,
        "macd": 1.0,
        "macd_histogram": 1.2,
        "bollinger_bands": 1.2,
        "ma_crossover": 1.3,
        "ma_trend": 0.8,
        "volume": 0.8,
        "adx_trend": 0.6,
        "stoch_rsi": 1.0,
        "obv_trend": 0.7,
        "roc": 0.5,
        "ichimoku": 0.9,
        "atr_volatility": 0.4,
    },

    # Confluence thresholds for final signal
    "strong_buy_threshold": 5.0,
    "buy_threshold": 2.0,
    "sell_threshold": -2.0,
    "strong_sell_threshold": -5.0,

    # Minimum indicators that must agree for a valid signal
    "min_agreeing_indicators": 3,
}

# =============================================================================
# ML ENGINE — XGBOOST CONFIGURATION
# =============================================================================
ML_ENGINE_CONFIG = {
    # Prediction horizon (how many candles ahead to predict)
    "prediction_horizon": 3,

    # Walk-forward validation
    "train_window_min": 500,        # minimum candles for training
    "test_window": 200,             # candles reserved for testing
    "walk_forward_steps": 5,        # number of walk-forward folds

    # XGBoost default hyperparameters (overridden by Optuna)
    "xgb_defaults": {
        "n_estimators": 300,
        "max_depth": 6,
        "learning_rate": 0.05,
        "subsample": 0.8,
        "colsample_bytree": 0.8,
        "min_child_weight": 3,
        "gamma": 0.1,
        "reg_alpha": 0.1,
        "reg_lambda": 1.0,
    },

    # Optuna tuning
    "optuna_n_trials": 50,
    "optuna_timeout_seconds": 120,  # max 2 minutes for tuning

    # Confidence thresholds
    "high_confidence": 0.70,
    "medium_confidence": 0.55,

    # Feature engineering
    "lag_periods": [1, 2, 3, 5, 8, 13],          # Fibonacci-inspired lags
    "rolling_windows": [5, 10, 20, 50],
    "target_type": "direction",                   # "direction" or "regression"

    # Model staleness (auto-retrain if older than this)
    "model_max_age_hours": 24,
}

# =============================================================================
# BACKTESTING CONFIGURATION
# =============================================================================
BACKTEST_CONFIG = {
    "initial_capital": 10000.0,
    "position_size_pct": 0.95,       # use 95% of capital per trade
    "commission_pct": 0.001,         # 0.1% per trade (Binance fee)
    "slippage_pct": 0.0005,          # 0.05% slippage assumption
    "stop_loss_pct": 0.03,           # 3% stop loss
    "take_profit_pct": 0.06,         # 6% take profit (2:1 R:R)
    "risk_free_rate": 0.045,         # annualized risk-free rate for Sharpe
}

# =============================================================================
# GEMINI CONFIGURATION
# =============================================================================
GEMINI_CONFIG = {
    "model": "gemini-2.5-flash-lite",
    "api_base": "https://generativelanguage.googleapis.com/v1beta/models",
    "max_tokens": 1024,
    "temperature": 0.3,              # low temp for analytical responses
}

# =============================================================================
# DATA FETCHER
# =============================================================================
DATA_CONFIG = {
    "binance_base_url": "https://api.binance.com",
    "max_candles_per_request": 1000,
    "target_candle_count": 2000,     # aim for 2000 candles of history
    "cache_ttl_seconds": 300,        # cache data for 5 minutes
}

# Interval to seconds mapping
INTERVAL_SECONDS = {
    "1m": 60, "3m": 180, "5m": 300, "15m": 900,
    "30m": 1800, "1h": 3600, "2h": 7200, "4h": 14400,
    "6h": 21600, "8h": 28800, "12h": 43200, "1d": 86400,
}
