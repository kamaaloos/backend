import {
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
} from '@opentelemetry/api';

const tracer = trace.getTracer('restaurant-api');

/**
 * Run `fn` inside an active span. No-op provider when OTel is not bootstrapped.
 */
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn(span);
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      span.end();
    }
  });
}

/** Attach attributes to the current request span when present. */
export function setActiveSpanAttributes(attributes: Attributes) {
  const span = trace.getActiveSpan();
  if (!span) return;
  span.setAttributes(attributes);
}
