"""
Binance Historical Data Fetcher.
Fetches OHLCV candle data via Binance public REST API with pagination.
Includes in-memory caching to avoid redundant API calls.
"""

import time
import requests
import pandas as pd
from config import DATA_CONFIG, INTERVAL_SECONDS


# In-memory cache: key = "symbol_interval" -> (timestamp, DataFrame)
_cache: dict = {}


def fetch_candles(symbol: str, interval: str, limit: int = None) -> pd.DataFrame:
    """
    Fetch historical OHLCV candles from Binance.
    Uses pagination to collect up to `limit` candles (default: target_candle_count from config).
    Results are cached for cache_ttl_seconds.
    
    Returns DataFrame with columns: time, open, high, low, close, volume
    """
    limit = limit or DATA_CONFIG["target_candle_count"]
    cache_key = f"{symbol}_{interval}_{limit}"

    # Check cache
    if cache_key in _cache:
        cached_time, cached_df = _cache[cache_key]
        if time.time() - cached_time < DATA_CONFIG["cache_ttl_seconds"]:
            return cached_df.copy()

    # Paginated fetch
    all_candles = []
    max_per_request = DATA_CONFIG["max_candles_per_request"]
    end_time = None

    while len(all_candles) < limit:
        batch_limit = min(max_per_request, limit - len(all_candles))
        params = {
            "symbol": symbol,
            "interval": interval,
            "limit": batch_limit,
        }
        if end_time:
            params["endTime"] = end_time

        try:
            url = f"{DATA_CONFIG['binance_base_url']}/api/v3/klines"
            resp = requests.get(url, params=params, timeout=10)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            print(f"Binance fetch error: {e}")
            break

        if not data:
            break

        # Parse klines
        for k in data:
            all_candles.append({
                "time": int(k[0]) // 1000,  # Convert ms to seconds
                "open": float(k[1]),
                "high": float(k[2]),
                "low": float(k[3]),
                "close": float(k[4]),
                "volume": float(k[5]),
            })

        # Set end_time for next page (go backwards in time)
        earliest_time_ms = int(data[0][0])
        end_time = earliest_time_ms - 1

        # If we got fewer than requested, we've hit the beginning
        if len(data) < batch_limit:
            break

    if not all_candles:
        return pd.DataFrame(columns=["time", "open", "high", "low", "close", "volume"])

    # Deduplicate and sort by time
    df = pd.DataFrame(all_candles)
    df = df.drop_duplicates(subset=["time"]).sort_values("time").reset_index(drop=True)

    # Cache the result
    _cache[cache_key] = (time.time(), df)

    return df.copy()


def candles_from_request(candle_list: list) -> pd.DataFrame:
    """
    Convert candle list from API request body to a DataFrame.
    Each candle: {"time": int, "open": float, "high": float, "low": float, "close": float, "volume": float}
    """
    df = pd.DataFrame(candle_list)
    for col in ["open", "high", "low", "close", "volume"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df["time"] = df["time"].astype(int)
    return df.sort_values("time").reset_index(drop=True)


def clear_cache():
    """Clear the in-memory cache."""
    global _cache
    _cache = {}
