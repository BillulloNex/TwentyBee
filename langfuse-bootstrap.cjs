// langfuse-bootstrap.cjs
// Loaded via NODE_OPTIONS=--require before the Twenty server starts.
// Registers Langfuse AI observability when LANGFUSE_SECRET_KEY is set.
// Zero-impact when the env var is absent.

'use strict';

if (process.env.LANGFUSE_SECRET_KEY) {
  try {
    const { LangfuseSpanProcessor } = require('@langfuse/otel');
    const { LangfuseVercelAiSdkIntegration } = require('@langfuse/vercel-ai-sdk');
    const { registerTelemetry } = require('ai');
    const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
    const { resourceFromAttributes } = require('@opentelemetry/resources');

    const langfuseProcessor = new LangfuseSpanProcessor({
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      baseUrl: process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
    });

    const tracerProvider = new NodeTracerProvider({
      resource: resourceFromAttributes({
        'service.name': process.env.OTEL_SERVICE_NAME || 'twentybee-server',
      }),
    });

    tracerProvider.addSpanProcessor(langfuseProcessor);
    tracerProvider.register();

    registerTelemetry(new LangfuseVercelAiSdkIntegration());

    console.log('[Langfuse] AI observability enabled');
  } catch (error) {
    console.warn('[Langfuse] Failed to initialise AI observability:', error.message);
  }
}
