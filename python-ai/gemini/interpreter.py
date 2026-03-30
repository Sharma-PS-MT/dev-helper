"""
Google Gemini AI Integration.
Provides natural language interpretation of predictions and
crypto news sentiment analysis.
"""

import requests
import json
from config import GEMINI_CONFIG


def interpret_prediction(prediction: dict, symbol: str, interval: str,
                         gemini_api_key: str) -> str:
    """
    Use Gemini to generate a natural language market analysis
    based on the raw prediction output.
    Returns a human-readable interpretation string.
    """
    if not gemini_api_key:
        return ""

    # Build a comprehensive prompt from the prediction data
    indicators = prediction.get("indicators", {})
    reasons = prediction.get("reasons", [])
    feature_importances = prediction.get("featureImportances", [])
    mode = prediction.get("mode", "rule")

    prompt = f"""You are an expert crypto market analyst. Interpret the following {symbol} ({interval} timeframe) prediction output in clear, professional language.

PREDICTION SUMMARY:
- Current Price: ${prediction.get('currentPrice', 0):,.2f}
- Predicted Price: ${prediction.get('predictedPrice', 0):,.2f}
- Trend: {prediction.get('trend', 'NEUTRAL')}
- Confidence: {prediction.get('confidence', 0) * 100:.0f}%
- Mode: {mode}
- Confluence Score: {prediction.get('confluenceScore', 'N/A')}

KEY INDICATORS:
- RSI(14): {indicators.get('rsi', 'N/A')}
- MACD Line: {indicators.get('macd_line', 'N/A')}
- MACD Histogram: {indicators.get('macd_histogram', 'N/A')}
- Bollinger Upper: {indicators.get('bb_upper', 'N/A')}
- Bollinger Lower: {indicators.get('bb_lower', 'N/A')}
- ADX: {indicators.get('adx', 'N/A')}
- Volume Ratio: {indicators.get('volume_ratio', 'N/A')}

SIGNAL REASONS:
{chr(10).join(f'- {r}' for r in reasons[:8])}
"""

    if feature_importances:
        prompt += "\nTOP ML FEATURES:\n"
        for fi in feature_importances[:5]:
            prompt += f"- {fi['feature']}: value={fi['value']}, importance={fi['importance']}\n"

    prompt += """
Write a concise 3-4 sentence market analysis paragraph explaining:
1. What the indicators are telling us about the current market condition
2. Why the prediction is bullish/bearish/neutral
3. Key risk factors to watch
4. A practical actionable insight

Keep it professional, concise, and avoid financial advice disclaimers. Respond with ONLY the analysis text, no headers or formatting."""

    try:
        url = f"{GEMINI_CONFIG['api_base']}/{GEMINI_CONFIG['model']}:generateContent?key={gemini_api_key}"
        response = requests.post(url, json={
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": GEMINI_CONFIG["temperature"],
                "maxOutputTokens": GEMINI_CONFIG["max_tokens"],
            }
        }, timeout=15)

        if response.status_code == 200:
            data = response.json()
            text = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
            return text.strip()
        else:
            return f"Gemini API error: {response.status_code}"

    except Exception as e:
        return f"Gemini interpretation unavailable: {str(e)}"


def analyze_sentiment(symbol: str, gemini_api_key: str) -> dict:
    """
    Use Gemini to analyze current crypto market sentiment for a given symbol.
    Returns a sentiment dict with score (-1 to +1) and summary.
    """
    if not gemini_api_key:
        return {"score": 0.0, "summary": "No API key provided", "headlines": []}

    prompt = f"""You are a crypto market sentiment analyst. Analyze the current market sentiment for {symbol} based on your knowledge of recent crypto market conditions, macro factors, and general market trends.

Respond ONLY with valid JSON (no markdown, no backticks):
{{
    "score": <float from -1.0 (very bearish) to +1.0 (very bullish)>,
    "summary": "<1-2 sentence sentiment summary>",
    "factors": ["<factor1>", "<factor2>", "<factor3>"]
}}"""

    try:
        url = f"{GEMINI_CONFIG['api_base']}/{GEMINI_CONFIG['model']}:generateContent?key={gemini_api_key}"
        response = requests.post(url, json={
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": 512,
            }
        }, timeout=15)

        if response.status_code == 200:
            data = response.json()
            text = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
            # Parse JSON from response
            json_match = text.strip()
            if json_match.startswith("```"):
                # Strip markdown code fences
                json_match = json_match.split("```")[1]
                if json_match.startswith("json"):
                    json_match = json_match[4:]
            parsed = json.loads(json_match)
            return {
                "score": max(-1, min(1, float(parsed.get("score", 0)))),
                "summary": parsed.get("summary", ""),
                "factors": parsed.get("factors", []),
            }
        else:
            return {"score": 0.0, "summary": f"API error: {response.status_code}", "factors": []}

    except Exception as e:
        return {"score": 0.0, "summary": f"Sentiment analysis failed: {str(e)}", "factors": []}
