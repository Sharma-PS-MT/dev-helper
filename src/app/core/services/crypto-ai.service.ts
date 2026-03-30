import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, map, catchError, of } from 'rxjs';
import { AuthConfigService } from './auth-config.service';
import { BinanceCandle } from './binance.service';
import { computeIndicators, formatIndicatorsForPrompt } from './technical-indicators';

export interface FeatureImportance {
  feature: string;
  importance: number;
  value: number;
}

export interface BacktestMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalReturn: number;
  totalPnl: number;
  avgWinPct: number;
  avgLossPct: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdown: number;
  longestWinStreak: number;
  longestLoseStreak: number;
  finalEquity: number;
  equityCurve: number[];
}

export interface SentimentResult {
  score: number;
  summary: string;
  factors: string[];
}

export interface AiPrediction {
  currentPrice: number;
  predictedPrice: number;
  trend: 'UP' | 'DOWN' | 'NEUTRAL';
  confidence: number;
  reasons: string[];
  futureCandles: { time: number; value: number }[];
  source: string;
  mode?: string;
  confluenceScore?: number;
  indicators?: Record<string, number>;
  featureImportances?: FeatureImportance[];
  trainingMetrics?: Record<string, any>;
  geminiInterpretation?: string;
  sentiment?: SentimentResult;
}

export interface BacktestResult {
  trades: any[];
  metrics: BacktestMetrics;
  config: Record<string, any>;
}

export type PredictionMode = 'gemini' | 'rule' | 'ml';

@Injectable({ providedIn: 'root' })
export class CryptoAiService {

  constructor(private http: HttpClient, private authConfig: AuthConfigService) {}

  // --- Option A: Gemini-Powered Prediction (frontend-direct) ---
  predictWithGemini(candles: BinanceCandle[], symbol: string, interval: string): Observable<AiPrediction> {
    const key = this.authConfig.config().geminiApiKey;
    if (!key) return of(this.fallbackPrediction(candles, 'gemini'));

    const indicators = computeIndicators(candles);
    const indicatorSummary = formatIndicatorsForPrompt(candles, indicators);

    const recentCandles = candles.slice(-30).map(c =>
      `T=${c.time} O=${c.open} H=${c.high} L=${c.low} C=${c.close}`
    ).join('\n');

    const prompt = `You are a crypto technical analysis AI. Analyze the following ${symbol} ${interval} candle data and indicators.

RECENT 30 CANDLES:
${recentCandles}

CURRENT INDICATORS:
${indicatorSummary}

Respond ONLY with valid JSON (no markdown, no backticks):
{
  "predictedPrice": <number>,
  "trend": "UP" | "DOWN" | "NEUTRAL",
  "confidence": <0.0-1.0>,
  "reasons": ["reason1", "reason2", "reason3", "reason4"],
  "futureCandles": [{"time": <unix_sec>, "value": <price>}, ...]
}

Predict the next 5 candle close prices. Base your confidence on indicator alignment strength. Provide 3-5 clear technical reasons.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${key}`;

    return this.http.post<any>(url, {
      contents: [{ parts: [{ text: prompt }] }]
    }).pipe(
      map(res => {
        const text = res.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return this.fallbackPrediction(candles, 'gemini');

        const parsed = JSON.parse(jsonMatch[0]);
        const current = candles[candles.length - 1].close;
        return {
          currentPrice: current,
          predictedPrice: parsed.predictedPrice || current,
          trend: parsed.trend || 'NEUTRAL',
          confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
          reasons: parsed.reasons || [],
          futureCandles: parsed.futureCandles || [],
          source: 'gemini' as const
        } as AiPrediction;
      }),
      catchError(err => {
        console.error('Gemini prediction failed:', err);
        return of(this.fallbackPrediction(candles, 'gemini'));
      })
    );
  }

  // --- Option B: Python Server Prediction (rule or ml mode) ---
  predictWithPython(candles: BinanceCandle[], symbol: string, interval: string,
                    mode: 'rule' | 'ml' = 'rule'): Observable<AiPrediction> {
    const geminiApiKey = this.authConfig.config().geminiApiKey || '';
    const payload = {
      symbol,
      interval,
      mode,
      geminiApiKey,
      candles: candles.slice(-200).map(c => ({
        time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume
      }))
    };

    return this.http.post<AiPrediction>('/python-ai/predict', payload).pipe(
      map(res => ({ ...res, source: res.source || (mode === 'ml' ? 'xgboost-ml' : 'rule-based') })),
      catchError(err => {
        console.error('Python prediction failed:', err);
        return of(this.fallbackPrediction(candles, mode === 'ml' ? 'xgboost-ml' : 'rule-based'));
      })
    );
  }

  // --- Train ML Model ---
  trainModel(symbol: string, interval: string): Observable<any> {
    return this.http.post<any>('/python-ai/train', { symbol, interval, limit: 2000 }).pipe(
      catchError(err => {
        console.error('Training failed:', err);
        return of({ error: 'Training request failed' });
      })
    );
  }

  // --- Run Backtest ---
  runBacktest(symbol: string, interval: string, mode: string): Observable<BacktestResult> {
    return this.http.post<BacktestResult>('/python-ai/backtest', {
      symbol, interval, mode, limit: 1000
    }).pipe(
      catchError(err => {
        console.error('Backtest failed:', err);
        return of({ trades: [], metrics: {} as BacktestMetrics, config: {} });
      })
    );
  }

  // Rule-based fallback when APIs fail
  private fallbackPrediction(candles: BinanceCandle[], source: string): AiPrediction {
    const indicators = computeIndicators(candles);
    const last = candles.length - 1;
    const current = candles[last].close;
    const reasons: string[] = [];
    let bullish = 0, bearish = 0;

    const ma20 = indicators.ma20[last];
    const ma50 = indicators.ma50[last];
    const rsi = indicators.rsi[last];
    const macd = indicators.macd[last];

    if (!isNaN(ma20) && current > ma20) { bullish++; reasons.push('Price above MA20 (bullish)'); }
    else if (!isNaN(ma20)) { bearish++; reasons.push('Price below MA20 (bearish)'); }

    if (!isNaN(ma50) && current > ma50) { bullish++; reasons.push('Price above MA50 (uptrend)'); }
    else if (!isNaN(ma50)) { bearish++; reasons.push('Price below MA50 (downtrend)'); }

    if (!isNaN(rsi)) {
      if (rsi < 30) { bullish++; reasons.push(`RSI ${rsi.toFixed(0)} — Oversold (potential bounce)`); }
      else if (rsi > 70) { bearish++; reasons.push(`RSI ${rsi.toFixed(0)} — Overbought (potential pullback)`); }
      else { reasons.push(`RSI ${rsi.toFixed(0)} — Neutral zone`); }
    }

    if (macd) {
      if (macd.histogram > 0) { bullish++; reasons.push('MACD histogram positive (momentum up)'); }
      else { bearish++; reasons.push('MACD histogram negative (momentum down)'); }
    }

    const trend: 'UP' | 'DOWN' | 'NEUTRAL' = bullish > bearish ? 'UP' : bearish > bullish ? 'DOWN' : 'NEUTRAL';
    const confidence = Math.min(0.85, (Math.abs(bullish - bearish) / Math.max(1, bullish + bearish)) * 0.6 + 0.3);
    const delta = current * (trend === 'UP' ? 0.002 : trend === 'DOWN' ? -0.002 : 0);
    const futureCandles = [];
    const lastTime = candles[last].time;
    for (let i = 1; i <= 5; i++) {
      futureCandles.push({ time: lastTime + i * 60, value: parseFloat((current + delta * i).toFixed(2)) });
    }

    return { currentPrice: current, predictedPrice: parseFloat((current + delta * 3).toFixed(2)), trend, confidence, reasons, futureCandles, source };
  }
}
