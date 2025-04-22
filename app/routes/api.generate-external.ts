import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { getApiKeysFromCookie } from '~/lib/api/cookies';

const logger = createScopedLogger('api.generate-external');

// Define OpenRouter API response type

// Request body interface
interface ExternalGenerateRequest {
  prompt: string;
  model?: string;
  openrouterApiKey?: string; // OpenRouter API key
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    // Extract prompt and model from request body
    let prompt: string;
    let modelName: string = 'openai/gpt-4.1'; // Default to GPT-4.1
    let openrouterApiKey: string | undefined;

    try {
      const body = (await request.json()) as ExternalGenerateRequest;
      prompt = body.prompt;

      if (body.model) {
        modelName = body.model;
      }

      openrouterApiKey = body.openrouterApiKey;

      if (!prompt || typeof prompt !== 'string') {
        return new Response(JSON.stringify({ error: 'Missing or invalid "prompt" in request body' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      logger.info(
        `Received external generation request with prompt: "${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}"`,
      );
      logger.info(`Using model: ${modelName}`);
    } catch (error) {
      logger.error('Failed to parse request body:', error);
      return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // If no OpenRouter API key provided in request, try to get from cookies
    if (!openrouterApiKey) {
      const cookieHeader = request.headers.get('Cookie') || '';
      const apiKeys = getApiKeysFromCookie(cookieHeader);
      openrouterApiKey = apiKeys?.openrouter;

      if (openrouterApiKey) {
        logger.info('Using OpenRouter API key from cookies');
      }
    } else {
      logger.info('Using OpenRouter API key from request payload');
    }

    // Ensure we have an OpenRouter API key
    if (!openrouterApiKey) {
      logger.warn('No OpenRouter API key found.');
      return new Response(
        JSON.stringify({
          error:
            'OpenRouter API key not configured. Please provide an API key in the request payload or ensure cookies are properly set.',
        }),
        {
          status: 401, // Unauthorized
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    // Make a direct call to OpenRouter API
    logger.info(`Making direct API call to OpenRouter with model: ${modelName}`);

    // Setup the request to OpenRouter
    const openRouterRequest = {
      model: modelName,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      stream: true, // Important: Enable streaming
    };

    try {
      // Call the OpenRouter API directly
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openrouterApiKey}`,
          'HTTP-Referer': 'http://localhost:5173', // replace with your domain
          'X-Title': 'Builder App External API',
        },
        body: JSON.stringify(openRouterRequest),
      });

      // Check if the response is successful
      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`OpenRouter API error: ${response.status} ${errorText}`);

        return new Response(
          JSON.stringify({
            error: `OpenRouter API returned ${response.status}: ${errorText}`,
          }),
          {
            status: response.status,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      // Return the stream directly
      logger.info('Successfully connected to OpenRouter API, streaming response');

      // Forward the response stream
      return new Response(response.body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    } catch (error) {
      logger.error(`Error calling OpenRouter API: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return new Response(
        JSON.stringify({
          error: `Failed to connect to OpenRouter: ${error instanceof Error ? error.message : 'Unknown error'}`,
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
  } catch (error: any) {
    logger.error('Failed to process external generation request:', error);
    return new Response(
      JSON.stringify({
        error: `Failed to process request: ${error.message}`,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}
