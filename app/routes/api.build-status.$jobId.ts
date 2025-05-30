import { type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('api.build-status');

export async function loader({ params }: LoaderFunctionArgs) {
  try {
    const { jobId } = params;

    if (!jobId) {
      return new Response(JSON.stringify({ error: 'Job ID is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const buildServiceUrl = 'https://build-api-829111227941.asia-southeast1.run.app';

    logger.info(`Fetching build status for job: ${jobId}`);

    // Fetch job status from build service
    const statusResponse = await fetch(`${buildServiceUrl}/api/v1/build/${jobId}`);

    if (!statusResponse.ok) {
      logger.error(`Failed to fetch build status: ${statusResponse.statusText}`);
      return new Response(
        JSON.stringify({
          error: `Failed to get build status: ${statusResponse.statusText}`,
        }),
        {
          status: statusResponse.status,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    const jobData: any = await statusResponse.json();
    logger.info(`Job ${jobId} status: ${jobData.status}`);

    return new Response(JSON.stringify(jobData), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    logger.error('Error fetching build status:', error);
    return new Response(
      JSON.stringify({
        error: `Failed to fetch build status: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}
