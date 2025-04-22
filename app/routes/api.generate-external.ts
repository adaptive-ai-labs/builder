import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { getApiKeysFromCookie } from '~/lib/api/cookies';
import type { NetlifySiteInfo } from '~/types/netlify';

const logger = createScopedLogger('api.generate-external');

// Define types for API responses
type NetlifyResponse = {
  id: string;
  name: string;
  url: string;
  ssl_url?: string;
  state?: string;
  error_message?: string;
  summary?: {
    status?: string;
  };
  status?: string;
};

/**
 * Generate SHA-1 hash of a string
 */
async function sha1(message: string) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-1', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  return hashHex;
}

/**
 * Helper function to deploy to Netlify
 */
async function deployToNetlify(params: {
  files: Record<string, string>;
  token: string;
  siteId?: string;
  chatId: string;
}): Promise<{
  success: boolean;
  deploy: {
    id: string;
    state: string;
    url: string;
  };
  site: NetlifySiteInfo;
}> {
  const { files, token, siteId, chatId } = params;
  let targetSiteId = siteId;
  let siteInfo: NetlifySiteInfo | undefined;

  // If no siteId provided, create a new site
  if (!targetSiteId) {
    const siteName = `bolt-diy-${chatId}-${Date.now()}`;
    const createSiteResponse = await fetch('https://api.netlify.com/api/v1/sites', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: siteName,
        custom_domain: null,
      }),
    });

    if (!createSiteResponse.ok) {
      throw new Error('Failed to create site');
    }

    const newSite = (await createSiteResponse.json()) as NetlifyResponse;
    targetSiteId = newSite.id;
    siteInfo = {
      id: newSite.id,
      name: newSite.name,
      url: newSite.url,
      chatId,
    };
  } else {
    // Get existing site info
    const siteResponse = await fetch(`https://api.netlify.com/api/v1/sites/${targetSiteId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (siteResponse.ok) {
      const existingSite = (await siteResponse.json()) as NetlifyResponse;
      siteInfo = {
        id: existingSite.id,
        name: existingSite.name,
        url: existingSite.url,
        chatId,
      };
    } else {
      // Site doesn't exist, create a new one
      const siteName = `bolt-diy-${chatId}-${Date.now()}`;
      const createSiteResponse = await fetch('https://api.netlify.com/api/v1/sites', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: siteName,
          custom_domain: null,
        }),
      });

      if (!createSiteResponse.ok) {
        throw new Error('Failed to create site');
      }

      const newSite = (await createSiteResponse.json()) as NetlifyResponse;
      targetSiteId = newSite.id;
      siteInfo = {
        id: newSite.id,
        name: newSite.name,
        url: newSite.url,
        chatId,
      };
    }
  }

  // Create file digests
  const fileDigests: Record<string, string> = {};

  for (const [filePath, content] of Object.entries(files)) {
    // Ensure file path starts with a forward slash
    const normalizedPath = filePath.startsWith('/') ? filePath : '/' + filePath;
    const hash = await sha1(content);
    fileDigests[normalizedPath] = hash;
  }

  // Create a new deploy with digests
  const deployResponse = await fetch(`https://api.netlify.com/api/v1/sites/${targetSiteId}/deploys`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      files: fileDigests,
      async: true,
      skip_processing: false,
      draft: false,
      function_schedules: [],
      required: Object.keys(fileDigests),
      framework: null,
    }),
  });

  if (!deployResponse.ok) {
    throw new Error('Failed to create deployment');
  }

  const deploy = (await deployResponse.json()) as NetlifyResponse;
  let retryCount = 0;
  const maxRetries = 60;

  // Poll until deploy is ready for file uploads
  while (retryCount < maxRetries) {
    const statusResponse = await fetch(`https://api.netlify.com/api/v1/sites/${targetSiteId}/deploys/${deploy.id}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const status = (await statusResponse.json()) as NetlifyResponse;

    if (status.state === 'prepared' || status.state === 'uploaded') {
      // Upload all files
      for (const [filePath, content] of Object.entries(files)) {
        const normalizedPath = filePath.startsWith('/') ? filePath : '/' + filePath;

        let uploadSuccess = false;
        let uploadRetries = 0;

        while (!uploadSuccess && uploadRetries < 3) {
          try {
            const uploadResponse = await fetch(
              `https://api.netlify.com/api/v1/deploys/${deploy.id}/files${normalizedPath}`,
              {
                method: 'PUT',
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/octet-stream',
                },
                body: content,
              },
            );

            uploadSuccess = uploadResponse.ok;

            if (!uploadSuccess) {
              logger.error('Upload failed:', await uploadResponse.text());
              uploadRetries++;
              await new Promise((resolve) => setTimeout(resolve, 2000));
            }
          } catch (error) {
            logger.error('Upload error:', error);
            uploadRetries++;
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }

        if (!uploadSuccess) {
          throw new Error(`Failed to upload file ${filePath}`);
        }
      }
    }

    if (status.state === 'ready') {
      // Only return after files are uploaded
      if (Object.keys(files).length === 0 || status.summary?.status === 'ready') {
        return {
          success: true,
          deploy: {
            id: status.id,
            state: status.state,
            url: status.ssl_url || status.url,
          },
          site: siteInfo,
        };
      }
    }

    if (status.state === 'error') {
      throw new Error(status.error_message || 'Deploy preparation failed');
    }

    retryCount++;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  if (retryCount >= maxRetries) {
    throw new Error('Deploy preparation timed out');
  }

  // Return the deploy ID and site info
  if (!siteInfo) {
    throw new Error('Site information is missing');
  }

  return {
    success: true,
    deploy: {
      id: deploy.id || '',
      state: deploy.state || 'published',
      url: deploy.url || siteInfo.url || '',
    },
    site: siteInfo,
  };
}

// Define OpenRouter API response type

// Request body interface
type ExternalGenerateRequest = {
  prompt: string;
  model?: string;
  openrouterApiKey?: string;
  deploy?: boolean;
  netlifyToken?: string;
  siteId?: string;
  chatId?: string; // Chat ID for site naming (defaults to timestamp if not provided)
};

export async function action({ request }: ActionFunctionArgs) {
  try {
    // Extract prompt and model from request body
    let prompt = '';
    let modelName: string = 'openai/gpt-4.1'; // Default to GPT-4.1
    let openrouterApiKey: string | undefined;

    // Parse request body once and store in a variable
    const body = (await request.json()) as ExternalGenerateRequest;

    try {
      // Check if prompt exists and is a string
      if (!body.prompt || typeof body.prompt !== 'string') {
        return new Response(JSON.stringify({ error: 'Missing or invalid "prompt" in request body' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // At this point TypeScript knows prompt is a string
      prompt = body.prompt as string;

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
      // Check if we need to deploy
      const shouldDeploy = body.deploy === true;
      const netlifyToken = body.netlifyToken;
      const siteId = body.siteId;
      const chatId = body.chatId || `chat-${Date.now()}`;

      // If deploying but no netlify token, throw error
      if (shouldDeploy && !netlifyToken) {
        return new Response(
          JSON.stringify({
            error: 'Netlify token is required for deployment',
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

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

      // If we don't need to deploy, just return the stream directly
      if (!shouldDeploy) {
        logger.info('Successfully connected to OpenRouter API, streaming response');

        // Forward the response stream
        return new Response(response.body, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        });
      }

      // We need to fully buffer the response before starting deployment
      logger.info('Buffering complete response for deployment');

      // Cannot use the stream directly if we're deploying - we need the full content
      const reader = response.body?.getReader();

      if (!reader) {
        throw new Error('No reader available');
      }

      const decoder = new TextDecoder();
      const parser = new RegExp('data: (.*?)\n\n', 'g');
      let buffer = '';
      let result = '';
      let fullContent = '';

      // Fully consume the stream first
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        fullContent += chunk;
      }

      // Now process the complete response
      let match;
      buffer = fullContent;

      // Reset the regex lastIndex
      parser.lastIndex = 0;

      // Process all complete chunks from the full response
      while ((match = parser.exec(buffer)) !== null) {
        const data = match[1];

        if (data === '[DONE]') {
          continue;
        }

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content || '';
          result += content;
        } catch (e) {
          logger.error('Error parsing SSE chunk', e);
        }
      }

      // Parse the result as a file structure now that we have the full content
      logger.info('Processing complete response for deployment');

      let files: Record<string, string> = {};

      try {
        logger.info(`Full result length: ${result.length} characters`);

        // Look for code blocks to extract files
        const filePattern = /```([\w\.\-\/]+)([\s\S]*?)```/g;
        let fileMatch;

        // Reset regex state
        filePattern.lastIndex = 0;

        while ((fileMatch = filePattern.exec(result)) !== null) {
          const filename = fileMatch[1].trim();
          const content = fileMatch[2].trim();

          // Check if it looks like a valid file (not just a language marker)
          if (filename && content && !filename.match(/^(jsx|js|ts|html|css|bash|shell|sh)$/i)) {
            logger.info(`Found file: ${filename} (${content.length} bytes)`);
            files[filename] = content;
          } else if (filename && content && filename.match(/^(jsx|js|ts|html|css)$/i)) {
            // For cases where we just have the language but no filename, create a default filename
            const ext = filename.toLowerCase();
            const defaultName =
              ext === 'jsx' || ext === 'js'
                ? 'App.jsx'
                : ext === 'ts'
                  ? 'App.tsx'
                  : ext === 'html'
                    ? 'index.html'
                    : 'styles.css';

            logger.info(`Found file with language marker: ${ext}, using default name: ${defaultName}`);
            files[defaultName] = content;
          }
        }

        // Look for a second pattern: ```filename\nextension\n...content...```
        const altFilePattern = /```([\w\-\.]+)\s*\n([\w\-\.]+)\s*\n([\s\S]*?)```/g;
        altFilePattern.lastIndex = 0;

        while ((fileMatch = altFilePattern.exec(result)) !== null) {
          const filename = fileMatch[1].trim();
          const ext = fileMatch[2].trim().replace(/^\./, '');
          const content = fileMatch[3].trim();

          if (filename && ext && content) {
            const fullName = `${filename}.${ext}`;
            logger.info(`Found file using alt pattern: ${fullName} (${content.length} bytes)`);
            files[fullName] = content;
          }
        }

        // Extract any React components defined in the LLM output
        const reactComponentPattern = /const\s+([A-Z][\w]*?)\s*=\s*\(([\s\S]*?)\)\s*=>\s*\(([\s\S]*?)\);/g;
        reactComponentPattern.lastIndex = 0;

        const reactComponents = [];

        while ((fileMatch = reactComponentPattern.exec(result)) !== null) {
          reactComponents.push(fileMatch[0]);
        }

        if (reactComponents.length > 0 && !files['App.jsx'] && !files['index.jsx']) {
          const imports = ["import React from 'react';"];
          const appContent = `
${imports.join('\n')}

${reactComponents.join('\n\n')}

function App() {\n  return <${reactComponents[0]?.match(/const\s+([A-Z][\w]*?)\s*=/)?.[1] || 'LandingPage'} />;\n}\n\nexport default App;
`;

          logger.info(`Created App.jsx from extracted React components`);
          files['App.jsx'] = appContent;
        }

        // If we couldn't extract files using the patterns, try to find an index.html at minimum
        if (Object.keys(files).length === 0) {
          // Attempt to extract HTML elements by looking for HTML tags
          const htmlMatch = result.match(/<html[\s\S]*?<\/html>/i);

          if (htmlMatch && htmlMatch[0]) {
            logger.info(`Found HTML content, creating index.html`);
            files['index.html'] = htmlMatch[0];
          }
        }

        // If we still have no files, send raw content as index.html
        if (Object.keys(files).length === 0) {
          logger.info(`No files found, creating default index.html`);
          files['index.html'] = `<!DOCTYPE html>
<html>
<head>
  <title>Generated Application</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    h1 { color: #333; }
    pre { background: #f4f4f4; padding: 10px; border-radius: 4px; overflow-x: auto; }
  </style>
</head>
<body>
  <h1>Generated Code</h1>
  <p>There was an issue with template loading. Here's the generated content:</p>
  <pre>${result.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
</body>
</html>`;
        }

        logger.info(`Found ${Object.keys(files).length} files for deployment`);

        /*
         * Deploy directly as a static site without trying to use framework templates
         * This approach will work immediately without requiring a build step, which gets skipped in API deployments
         */
        logger.info('Preparing files for direct static deployment');

        // Check if we have an index.html file already in the files
        const hasIndexHtml = Object.keys(files).some((filename) => filename === 'index.html');

        // If we have an index.html file, we can deploy directly
        if (hasIndexHtml) {
          logger.info('Found index.html file, deploying directly');

          // We're good to go, files object already has what we need
        } else {
          // We need to create an index.html file from the result
          logger.info('No index.html found, creating one from the result');

          // Look for HTML content in the result
          const htmlMatch = result.match(/<(!DOCTYPE|html)[\s\S]*?<\/html>/i);

          if (htmlMatch && htmlMatch[0]) {
            // We found HTML content, use it directly
            logger.info('Found HTML content in the result, using it for index.html');
            files['index.html'] = htmlMatch[0];
          } else {
            // No HTML found, create a showcase page
            logger.info('No HTML content found, creating a showcase page');

            // Get all code samples that were extracted
            const codeFiles = Object.entries(files).map(([filename, content]) => {
              const extension = filename.split('.').pop() || '';
              const language = extension === 'jsx' ? 'javascript' : extension;

              return { filename, content, language };
            });

            // Create a modern, clean HTML showcase page
            let showcaseHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Generated Code</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
  <style>
    :root {
      --primary: #3063e9;
      --secondary: #0e1437;
      --accent: #24cec1;
      --bg: #f6f8fa;
      --white: #fff;
      --grey: #e7eaf1;
      --code-bg: #282c34;
      --radius: 12px;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      padding-top: 20px;
      padding-bottom: 60px;
      background-color: var(--bg);
      color: var(--secondary);
      line-height: 1.6;
    }
    .navbar-brand { font-weight: bold; color: var(--primary); }
    .code-section { margin-bottom: 30px; }
    .code-section h2 {
      margin-bottom: 10px;
      font-size: 1.5rem;
      color: var(--secondary);
      font-weight: 600;
    }
    pre {
      border-radius: var(--radius);
      position: relative;
      background: var(--code-bg);
      margin-top: 8px;
    }
    pre code {
      padding: 20px !important;
      font-family: 'Fira Code', Consolas, Monaco, 'Andale Mono', monospace;
      font-size: 0.9rem;
    }
    .hljs { background: var(--code-bg); }
    .filename-label {
      position: absolute;
      top: 0;
      right: 0;
      background: rgba(0,0,0,0.3);
      color: white;
      font-size: 12px;
      padding: 4px 8px;
      border-bottom-left-radius: 8px;
    }
    .header {
      margin-bottom: 2rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--grey);
    }
    .header h1 {
      font-weight: 700;
      color: var(--secondary);
    }
    .btn-primary {
      background-color: var(--primary);
      border-color: var(--primary);
      border-radius: var(--radius);
      padding: 0.5rem 1.2rem;
      font-weight: 500;
    }
    .btn-primary:hover {
      background-color: var(--accent);
      border-color: var(--accent);
    }
    .nav-tabs {
      border-bottom: 1px solid var(--grey);
      margin-bottom: 1.5rem;
    }
    .nav-tabs .nav-link {
      color: var(--secondary);
      border: none;
      padding: 0.5rem 1rem;
      margin-right: 0.5rem;
      border-radius: var(--radius) var(--radius) 0 0;
    }
    .nav-tabs .nav-link.active {
      background-color: var(--primary);
      color: white;
    }
    .footer {
      text-align: center;
      font-size: 0.9rem;
      color: #7c8599;
      margin-top: 3rem;
      padding-top: 1rem;
      border-top: 1px solid var(--grey);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 class="display-5">Generated Code</h1>
      <p class="lead">This page displays the code generated based on your prompt.</p>
    </div>

    <ul class="nav nav-tabs" id="myTab" role="tablist">
      <li class="nav-item" role="presentation">
        <button class="nav-link active" id="files-tab" data-bs-toggle="tab" data-bs-target="#files" type="button" role="tab" aria-controls="files" aria-selected="true">Files</button>
      </li>
      <li class="nav-item" role="presentation">
        <button class="nav-link" id="response-tab" data-bs-toggle="tab" data-bs-target="#response" type="button" role="tab" aria-controls="response" aria-selected="false">Full Response</button>
      </li>
    </ul>

    <div class="tab-content" id="myTabContent">
      <div class="tab-pane fade show active" id="files" role="tabpanel" aria-labelledby="files-tab">
`;

            // Add each code file with syntax highlighting
            for (const { filename, content, language } of codeFiles) {
              showcaseHTML += `
        <div class="code-section">
          <h2>${filename}</h2>
          <pre><span class="filename-label">${filename}</span><code class="language-${language}">${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>
        </div>
`;
            }

            showcaseHTML += `
      </div>
      <div class="tab-pane fade" id="response" role="tabpanel" aria-labelledby="response-tab">
        <div class="code-section">
          <pre style="white-space: pre-wrap; padding: 20px;">${result.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
        </div>
      </div>
    </div>

    <div class="footer">
      <p>Generated with AI assistance</p>
    </div>
  </div>

  <script>
    document.addEventListener('DOMContentLoaded', () => {
      document.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block);
      });
    });
  </script>
  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>
</body>
</html>`;

            // Replace files with our showcase
            files = { 'index.html': showcaseHTML };

            // If there are CSS files, keep them
            const cssFiles = Object.entries(files).filter(([name]) => name.endsWith('.css'));

            for (const [name, content] of cssFiles) {
              files[name] = content;
            }

            // If there are JS files, keep them
            const jsFiles = Object.entries(files).filter(([name]) => name.endsWith('.js'));

            for (const [name, content] of jsFiles) {
              files[name] = content;
            }
          }
        }

        // If we have image URLs in the HTML, add them to the files
        const htmlFile = files['index.html'];

        if (htmlFile) {
          // Add any referenced assets like images from CDNs
          const imgMatches = htmlFile.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/g);

          if (imgMatches) {
            logger.info('Found image references in HTML, adding to assets');
          }
        }

        logger.info(`Found ${Object.keys(files).length} files for deployment`);

        // Deploy to Netlify
        if (!netlifyToken) {
          throw new Error('Netlify token is required for deployment');
        }

        // Ensure chatId is always a string (fix TypeScript error)
        const deployResult = await deployToNetlify({
          files,
          token: netlifyToken,
          siteId,
          chatId: chatId || `chat-${Date.now().toString()}`,
        });

        logger.info('Deployment successful', deployResult);

        // Return a response with both the generation result and deployment info
        return new Response(
          JSON.stringify({
            result,
            files: Object.keys(files),
            deployment: deployResult,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      } catch (deployError) {
        logger.error('Deployment error:', deployError);

        // Return the generation result even if deployment failed
        return new Response(
          JSON.stringify({
            result,
            error: `Deployment failed: ${deployError instanceof Error ? deployError.message : 'Unknown error'}`,
          }),
          {
            status: 200, // Still return 200 since generation succeeded
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      // If no deployment needed, return the stream directly
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
        error: `Failed to process request: ${error instanceof Error ? error.message : String(error)}`,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}
