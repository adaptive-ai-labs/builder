import { type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('api.build-stream');

export async function loader({ params }: LoaderFunctionArgs) {
  try {
    const { jobId } = params;

    if (!jobId) {
      return new Response('Job ID is required', { status: 400 });
    }

    const buildServiceUrl = 'https://build-api-829111227941.asia-southeast1.run.app';

    logger.info(`Starting SSE stream for job: ${jobId}`);

    // Create SSE stream that proxies from build service
    const stream = new ReadableStream({
      start(controller) {
        const connectToSSE = async () => {
          try {
            // Connect to build service SSE endpoint
            const sseResponse = await fetch(`${buildServiceUrl}/api/v1/build/${jobId}/sse`);

            if (!sseResponse.ok) {
              throw new Error(`SSE connection failed: ${sseResponse.statusText}`);
            }

            const reader = sseResponse.body?.getReader();

            if (!reader) {
              throw new Error('No response body');
            }

            // Relay SSE data to frontend
            const pump = async () => {
              try {
                while (true) {
                  const { done, value } = await reader.read();

                  if (done) {
                    logger.info(`SSE stream ended for job: ${jobId}`);
                    controller.close();
                    break;
                  }

                  // Relay the chunk to the frontend
                  controller.enqueue(value);
                }
              } catch (error) {
                logger.error(`SSE stream error for job ${jobId}:`, error);
                controller.error(error);
              }
            };

            pump();
          } catch (error) {
            logger.error(`Failed to connect to SSE for job ${jobId}:`, error);

            // Send error event and close
            const errorData = `data: ${JSON.stringify({
              error: error instanceof Error ? error.message : 'Unknown error',
              jobId,
            })}\n\n`;

            controller.enqueue(new TextEncoder().encode(errorData));
            controller.close();
          }
        };

        connectToSSE();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control',
      },
    });
  } catch (error) {
    logger.error('Error setting up build stream:', error);
    return new Response(
      `data: ${JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      })}\n\n`,
      {
        status: 500,
        headers: { 'Content-Type': 'text/event-stream' },
      },
    );
  }
}
