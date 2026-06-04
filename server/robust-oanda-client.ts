// server/robust-oanda-client.ts
import CircuitBreaker from 'opossum';
import fetchRetry from 'fetch-retry';

export class RobustOandaAPI {
  private baseUrl: string;
  private token: string;
  private accountId: string;
  private breaker: CircuitBreaker;

  constructor(token: string, accountId: string, environment: "practice" | "live") {
    this.token = token;
    this.accountId = accountId;
    this.baseUrl = environment === "live"
      ? "https://api-fxtrade.oanda.com"
      : "https://api-fxpractice.oanda.com";

    this.breaker = new CircuitBreaker(this._makeRequest.bind(this), {
      timeout: 15000,
      errorThresholdPercentage: 40,
      resetTimeout: 30000,
      rollingCountTimeout: 10000,
      rollingCountBuckets: 10,
    });

    this.breaker.on('open', () => console.error('🔴 [OANDA] Circuit Breaker OPEN — Pausing new trades'));
    this.breaker.on('halfOpen', () => console.log('🟡 [OANDA] Circuit Breaker half-open'));
    this.breaker.on('close', () => console.log('🟢 [OANDA] Circuit Breaker closed'));
  }

  private async _makeRequest(path: string, options: RequestInit = {}): Promise<any> {
    const fetchWithRetry = fetchRetry(fetch, {
      retries: 4,
      retryDelay: (attempt: number) => Math.pow(2, attempt) * 800 + Math.random() * 400,
    });

    const res = await fetchWithRetry(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'No body');
      throw new Error(`OANDA ${res.status}: ${text}`);
    }
    return res.json();
  }

  async request(path: string, options: RequestInit = {}) {
    if (this.breaker.opened) throw new Error('Circuit breaker is OPEN');
    return this.breaker.fire(path, options);
  }

  async getAccount() { return this.request(`/v3/accounts/${this.accountId}`); }
  async getOpenTrades() {
    const data = await this.request(`/v3/accounts/${this.accountId}/openTrades`);
    return data.trades || [];
  }
  async getPrice(instrument: string) {
    const data = await this.request(`/v3/accounts/${this.accountId}/pricing?instruments=${instrument}`);
    const price = data.prices[0];
    return { bid: parseFloat(price.bids[0].price), ask: parseFloat(price.asks[0].price) };
  }
  async getCandles(instrument: string, granularity: string, count: number) {
    const data = await this.request(`/v3/instruments/${instrument}/candles?granularity=${granularity}&count=${count}`);
    return data.candles.map((c: any) => ({
      time: c.time,
      open: parseFloat(c.mid.o),
      high: parseFloat(c.mid.h),
      low: parseFloat(c.mid.l),
      close: parseFloat(c.mid.c),
    }));
  }
  // TODO: Add placeTrade and other methods by copying from original OandaAPI
}
