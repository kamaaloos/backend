import { metrics } from '@opentelemetry/api';
import * as client from 'prom-client';

/** Shared Prometheus registry (scraped at GET /api/metrics). */
export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

const prepDuration = new client.Histogram({
  name: 'restaurant_prep_duration_seconds',
  help: 'Kitchen prep time from PREPARING → READY',
  buckets: [30, 60, 120, 180, 300, 600, 900, 1200, 1800],
  registers: [registry],
});

const paymentSettleDuration = new client.Histogram({
  name: 'restaurant_payment_settle_duration_seconds',
  help: 'Payment settle time from createdAt → paidAt',
  buckets: [1, 5, 15, 30, 60, 120, 300, 600],
  registers: [registry],
});

const prepSloBreach = new client.Counter({
  name: 'restaurant_prep_slo_breach_total',
  help: 'Prep samples that exceeded SLO_PREP_SECONDS',
  registers: [registry],
});

const paymentSloBreach = new client.Counter({
  name: 'restaurant_payment_slo_breach_total',
  help: 'Payment settles that exceeded SLO_PAYMENT_SETTLE_SECONDS',
  registers: [registry],
});

const otelMeter = metrics.getMeter('restaurant-api');
const otelPrep = otelMeter.createHistogram('order.prep_duration', {
  unit: 'ms',
  description: 'Kitchen prep duration PREPARING → READY',
});
const otelPay = otelMeter.createHistogram('payment.settle_duration', {
  unit: 'ms',
  description: 'Payment settle duration created → paid',
});

export function prepSloSeconds(): number {
  return Number(process.env.SLO_PREP_SECONDS ?? 900);
}

export function paymentSloSeconds(): number {
  return Number(process.env.SLO_PAYMENT_SETTLE_SECONDS ?? 120);
}

/** Record kitchen prep duration (ms). */
export function recordPrepDurationMs(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return;
  const seconds = ms / 1000;
  prepDuration.observe(seconds);
  otelPrep.record(ms);
  if (seconds > prepSloSeconds()) {
    prepSloBreach.inc();
  }
}

/** Record payment settle duration (ms). */
export function recordPaymentSettleDurationMs(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return;
  const seconds = ms / 1000;
  paymentSettleDuration.observe(seconds);
  otelPay.record(ms);
  if (seconds > paymentSloSeconds()) {
    paymentSloBreach.inc();
  }
}

export async function metricsText(): Promise<string> {
  return registry.metrics();
}

export function metricsContentType(): string {
  return registry.contentType;
}
