import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, map } from 'rxjs';

export interface BinanceCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BinanceTicker {
  symbol: string;
  price: number;
}

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT'];
const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'];

@Injectable({ providedIn: 'root' })
export class BinanceService {
  static readonly SYMBOLS = SYMBOLS;
  static readonly INTERVALS = INTERVALS;

  private ws: WebSocket | null = null;
  private candleSubject = new Subject<BinanceCandle>();
  candle$ = this.candleSubject.asObservable();
  wsConnected = signal(false);

  constructor(private http: HttpClient) {}

  // REST: Fetch historical klines
  getHistoricalCandles(symbol: string, interval: string, limit = 200): Observable<BinanceCandle[]> {
    return this.http.get<any[]>(`/binance-api/api/v3/klines`, {
      params: { symbol, interval, limit: limit.toString() }
    }).pipe(
      map(data => data.map(k => ({
        time: Math.floor(k[0] / 1000),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5])
      })))
    );
  }

  // WebSocket: Live candle stream
  connectWebSocket(symbol: string, interval: string): void {
    this.disconnectWebSocket();
    const wsUrl = `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${interval}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => this.wsConnected.set(true);
    this.ws.onclose = () => this.wsConnected.set(false);
    this.ws.onerror = () => this.wsConnected.set(false);

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.k) {
        const k = msg.k;
        this.candleSubject.next({
          time: Math.floor(k.t / 1000),
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
          volume: parseFloat(k.v)
        });
      }
    };
  }

  disconnectWebSocket(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.wsConnected.set(false);
    }
  }
}
