/**
 * OpenTelemetry bootstrap — must load before Nest (via node --require).
 *
 * Enable with either:
 *   OTEL_ENABLED=1
 *   OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
 *
 * Optional:
 *   OTEL_SERVICE_NAME=restaurant-api
 *   OTEL_DEBUG=1          # also print spans to console
 */
'use strict';

const enabled =
  process.env.OTEL_ENABLED === '1' ||
  process.env.OTEL_ENABLED === 'true' ||
  Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim());

if (!enabled) {
  module.exports = { started: false };
  return;
}

const { NodeSDK } = require('@opentelemetry/sdk-node');
const {
  getNodeAutoInstrumentations,
} = require('@opentelemetry/auto-instrumentations-node');
const {
  OTLPTraceExporter,
} = require('@opentelemetry/exporter-trace-otlp-http');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} = require('@opentelemetry/semantic-conventions');
const {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
} = require('@opentelemetry/sdk-trace-node');

const serviceName =
  process.env.OTEL_SERVICE_NAME?.trim() || 'restaurant-api';
const endpoint =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() ||
  'http://127.0.0.1:4318';
const debug =
  process.env.OTEL_DEBUG === '1' || process.env.OTEL_DEBUG === 'true';

const otlpExporter = new OTLPTraceExporter({
  url: `${endpoint.replace(/\/$/, '')}/v1/traces`,
});

const spanProcessors = [new BatchSpanProcessor(otlpExporter)];
if (debug) {
  spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
}

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: process.env.npm_package_version || '0.0.1',
  }),
  spanProcessors,
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false },
      '@opentelemetry/instrumentation-dns': { enabled: false },
      '@opentelemetry/instrumentation-net': { enabled: false },
      '@opentelemetry/instrumentation-http': {
        ignoreIncomingRequestHook: (req) => {
          const url = req.url || '';
          return url.includes('/health') || url.includes('/ready');
        },
      },
    }),
  ],
});

sdk.start();

process.on('SIGTERM', () => {
  sdk.shutdown().catch(() => undefined);
});

// eslint-disable-next-line no-console
console.log(
  `[otel] tracing enabled → ${endpoint}/v1/traces (service=${serviceName})`,
);

module.exports = { started: true, sdk };
