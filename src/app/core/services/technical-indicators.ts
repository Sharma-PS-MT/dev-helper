import { BinanceCandle } from './binance.service';

export interface TechnicalIndicators {
  ma20: number[];
  ma50: number[];
  rsi: number[];
  macd: { macd: number; signal: number; histogram: number }[];
  bollingerUpper: number[];
  bollingerLower: number[];
}

export function computeIndicators(candles: BinanceCandle[]): TechnicalIndicators {
  const closes = candles.map(c => c.close);
  return {
    ma20: sma(closes, 20),
    ma50: sma(closes, 50),
    rsi: computeRSI(closes, 14),
    macd: computeMACD(closes, 12, 26, 9),
    bollingerUpper: bollingerBand(closes, 20, 2, 'upper'),
    bollingerLower: bollingerBand(closes, 20, 2, 'lower'),
  };
}

function sma(data: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j];
    result.push(sum / period);
  }
  return result;
}

function ema(data: number[], period: number): number[] {
  const result: number[] = [];
  const k = 2 / (period + 1);
  let prev = data[0];
  result.push(prev);
  for (let i = 1; i < data.length; i++) {
    prev = data[i] * k + prev * (1 - k);
    result.push(prev);
  }
  return result;
}

function computeRSI(data: number[], period: number): number[] {
  const result: number[] = new Array(data.length).fill(NaN);
  if (data.length < period + 1) return result;

  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = data[i] - data[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  result[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < data.length; i++) {
    const change = data[i] - data[i - 1];
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  }
  return result;
}

function computeMACD(data: number[], fast: number, slow: number, signal: number): { macd: number; signal: number; histogram: number }[] {
  const emaFast = ema(data, fast);
  const emaSlow = ema(data, slow);
  const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
  const signalLine = ema(macdLine, signal);
  return macdLine.map((v, i) => ({
    macd: v,
    signal: signalLine[i],
    histogram: v - signalLine[i]
  }));
}

function bollingerBand(data: number[], period: number, stdDevMultiplier: number, band: 'upper' | 'lower'): number[] {
  const ma = sma(data, period);
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (isNaN(ma[i])) { result.push(NaN); continue; }
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += Math.pow(data[j] - ma[i], 2);
    const stdDev = Math.sqrt(variance / period);
    result.push(band === 'upper' ? ma[i] + stdDevMultiplier * stdDev : ma[i] - stdDevMultiplier * stdDev);
  }
  return result;
}

// Format indicators for AI prompt
export function formatIndicatorsForPrompt(candles: BinanceCandle[], indicators: TechnicalIndicators): string {
  const last = candles.length - 1;
  const c = candles[last];
  return `Current: O=${c.open} H=${c.high} L=${c.low} C=${c.close} V=${c.volume}
MA20=${indicators.ma20[last]?.toFixed(2)} MA50=${indicators.ma50[last]?.toFixed(2)}
RSI=${indicators.rsi[last]?.toFixed(1)}
MACD=${indicators.macd[last]?.macd.toFixed(2)} Signal=${indicators.macd[last]?.signal.toFixed(2)} Hist=${indicators.macd[last]?.histogram.toFixed(2)}
BB_Upper=${indicators.bollingerUpper[last]?.toFixed(2)} BB_Lower=${indicators.bollingerLower[last]?.toFixed(2)}`;
}
