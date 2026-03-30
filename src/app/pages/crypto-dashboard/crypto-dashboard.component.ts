import {
  Component, OnInit, OnDestroy, signal, ViewChild, ElementRef, AfterViewInit, effect
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Subscription } from 'rxjs';
import {
  createChart, IChartApi, ISeriesApi, CandlestickData, LineData, Time,
  CandlestickSeries, LineSeries
} from 'lightweight-charts';
import { BinanceService, BinanceCandle } from '../../core/services/binance.service';
import { CryptoAiService, AiPrediction, PredictionMode, BacktestResult } from '../../core/services/crypto-ai.service';
import { computeIndicators } from '../../core/services/technical-indicators';

@Component({
  selector: 'app-crypto-dashboard',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatCardModule, MatSelectModule,
    MatButtonModule, MatIconModule, MatProgressSpinnerModule,
    MatButtonToggleModule, MatTooltipModule, MatProgressBarModule
  ],
  templateUrl: './crypto-dashboard.component.html',
  styleUrls: ['./crypto-dashboard.component.scss']
})
export class CryptoDashboardComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('chartContainer', { static: false }) chartContainer!: ElementRef<HTMLDivElement>;

  symbols = BinanceService.SYMBOLS;
  intervals = BinanceService.INTERVALS;
  selectedSymbol = signal('BTCUSDT');
  selectedInterval = signal('5m');
  aiSource = signal<PredictionMode>('rule');

  prediction = signal<AiPrediction | null>(null);
  predicting = signal(false);
  livePriceStr = signal('—');
  candles: BinanceCandle[] = [];

  // Backtest state
  backtestResult = signal<BacktestResult | null>(null);
  backtesting = signal(false);

  // Training state
  training = signal(false);
  trainResult = signal<any>(null);

  private chart!: IChartApi;
  private candleSeries!: ISeriesApi<any>;
  private predictionLine!: ISeriesApi<any>;
  private ma20Line!: ISeriesApi<any>;
  private wsSub?: Subscription;
  private chartReady = false;

  constructor(
    public binance: BinanceService,
    private cryptoAi: CryptoAiService
  ) {}

  ngOnInit() {}

  ngAfterViewInit() {
    this.initChart();
    this.loadData();
  }

  ngOnDestroy() {
    this.binance.disconnectWebSocket();
    this.wsSub?.unsubscribe();
    if (this.chart) this.chart.remove();
  }

  private initChart() {
    const container = this.chartContainer.nativeElement;
    this.chart = createChart(container, {
      width: container.clientWidth,
      height: 500,
      layout: { background: { color: '#0d1117' }, textColor: '#c9d1d9' },
      grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
      crosshair: {
        mode: 0,
        vertLine: { color: '#39c5cf', width: 1, style: 2 },
        horzLine: { color: '#39c5cf', width: 1, style: 2 }
      },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#30363d' },
      rightPriceScale: { borderColor: '#30363d' }
    });

    this.candleSeries = this.chart.addSeries(CandlestickSeries, {
      upColor: '#3fb950', downColor: '#f85149', borderDownColor: '#f85149',
      borderUpColor: '#3fb950', wickDownColor: '#f85149', wickUpColor: '#3fb950'
    });

    this.ma20Line = this.chart.addSeries(LineSeries, {
      color: '#f0883e', lineWidth: 1, priceLineVisible: false, lastValueVisible: false
    });

    this.predictionLine = this.chart.addSeries(LineSeries, {
      color: '#58a6ff', lineWidth: 2, lineStyle: 2, priceLineVisible: false
    });

    this.chartReady = true;

    const ro = new ResizeObserver(entries => {
      const { width } = entries[0].contentRect;
      this.chart.applyOptions({ width });
    });
    ro.observe(container);
  }

  loadData() {
    this.binance.disconnectWebSocket();
    this.wsSub?.unsubscribe();
    this.prediction.set(null);
    this.backtestResult.set(null);

    this.binance.getHistoricalCandles(this.selectedSymbol(), this.selectedInterval(), 200)
      .subscribe(candles => {
        this.candles = candles;
        if (!this.chartReady) return;

        const chartData: CandlestickData<Time>[] = candles.map(c => ({
          time: c.time as Time,
          open: c.open, high: c.high, low: c.low, close: c.close
        }));
        this.candleSeries.setData(chartData);

        const indicators = computeIndicators(candles);
        const ma20Data: LineData<Time>[] = candles
          .map((c, i) => ({ time: c.time as Time, value: indicators.ma20[i] }))
          .filter(d => !isNaN(d.value));
        this.ma20Line.setData(ma20Data);

        this.livePriceStr.set(candles[candles.length - 1]?.close.toLocaleString() || '—');
        this.chart.timeScale().fitContent();

        this.startWebSocket();
      });
  }

  private startWebSocket() {
    this.binance.connectWebSocket(this.selectedSymbol(), this.selectedInterval());
    this.wsSub = this.binance.candle$.subscribe(candle => {
      const data: CandlestickData<Time> = {
        time: candle.time as Time,
        open: candle.open, high: candle.high, low: candle.low, close: candle.close
      };
      this.candleSeries.update(data);
      this.livePriceStr.set(candle.close.toLocaleString());

      const lastIdx = this.candles.findIndex(c => c.time === candle.time);
      if (lastIdx >= 0) this.candles[lastIdx] = candle;
      else this.candles.push(candle);
    });
  }

  onSymbolChange(symbol: string) {
    this.selectedSymbol.set(symbol);
    this.loadData();
  }

  onIntervalChange(interval: string) {
    this.selectedInterval.set(interval);
    this.loadData();
  }

  runPrediction() {
    if (this.candles.length < 30) return;
    this.predicting.set(true);
    this.prediction.set(null);

    const mode = this.aiSource();
    let obs;

    if (mode === 'gemini') {
      obs = this.cryptoAi.predictWithGemini(this.candles, this.selectedSymbol(), this.selectedInterval());
    } else {
      obs = this.cryptoAi.predictWithPython(
        this.candles, this.selectedSymbol(), this.selectedInterval(),
        mode as 'rule' | 'ml'
      );
    }

    obs.subscribe(pred => {
      this.prediction.set(pred);
      this.predicting.set(false);

      if (pred.futureCandles.length > 0 && this.chartReady) {
        const lastCandle = this.candles[this.candles.length - 1];
        const lineData: LineData<Time>[] = [
          { time: lastCandle.time as Time, value: lastCandle.close },
          ...pred.futureCandles.map(fc => ({ time: fc.time as Time, value: fc.value }))
        ];
        this.predictionLine.setData(lineData);
      }
    });
  }

  runBacktest() {
    this.backtesting.set(true);
    this.backtestResult.set(null);
    const mode = this.aiSource() === 'gemini' ? 'rule' : this.aiSource();

    this.cryptoAi.runBacktest(this.selectedSymbol(), this.selectedInterval(), mode)
      .subscribe(result => {
        this.backtestResult.set(result);
        this.backtesting.set(false);
      });
  }

  trainModel() {
    this.training.set(true);
    this.trainResult.set(null);

    this.cryptoAi.trainModel(this.selectedSymbol(), this.selectedInterval())
      .subscribe(result => {
        this.trainResult.set(result);
        this.training.set(false);
      });
  }

  getSourceHint(): string {
    switch (this.aiSource()) {
      case 'gemini': return 'Uses Gemini 2.5 Flash Lite via your API key';
      case 'rule': return 'Rule-based with 15+ indicators & confluence scoring';
      case 'ml': return 'XGBoost ML with Optuna tuning (requires Python server)';
      default: return '';
    }
  }
}
