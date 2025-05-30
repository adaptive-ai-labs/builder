import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { getApiKeysFromCookie, getProviderSettingsFromCookie } from '~/lib/api/cookies';
import type { NetlifySiteInfo } from '~/types/netlify';
import { selectStarterTemplate, getTemplates } from '~/utils/selectStarterTemplate';
import { streamText, type Messages } from '~/lib/.server/llm/stream-text';
import { getSystemPrompt } from '~/lib/common/prompts/prompts';
import { WORK_DIR } from '~/utils/constants';
import type { ProviderInfo } from '~/types/model';

const logger = createScopedLogger('api.generate-external-v2');

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
 * Generate a random alphanumeric string
 */
function generateRandomString(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';

  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return result;
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

// Request body interface
type ExternalGenerateRequest = {
  prompt: string;
  model?: string;
  provider?: ProviderInfo;
  apiKey?: string; // API key for the LLM provider
  template?: string; // Optional template name (will auto-select if not provided)
  autoSelectTemplate?: boolean; // Whether to auto-select template (default: true)
  deploy?: boolean;
  netlifyToken?: string;
  siteId?: string;
  chatId?: string; // Chat ID for site naming (defaults to timestamp if not provided)
  githubToken?: string; // GitHub personal access token for creating repositories
};

/**
 * Parse artifact content to extract files
 */
function parseArtifactFiles(content: string): Record<string, string> {
  const files: Record<string, string> = {};

  logger.info('Parsing artifact content for files...');
  logger.debug(`Content length: ${content.length} characters`);

  // Method 1: Look for boltAction tags with type="file"
  const fileActionPattern = /<boltAction\s+type="file"\s+filePath="([^"]+)"[^>]*>([\s\S]*?)<\/boltAction>/g;
  let match;

  logger.debug(`Looking for boltAction pattern: ${fileActionPattern.source}`);

  while ((match = fileActionPattern.exec(content)) !== null) {
    const filePath = match[1];
    const fileContent = match[2].trim();
    logger.info(`Found file in boltAction: ${filePath} (${fileContent.length} bytes)`);
    files[filePath] = fileContent;
  }

  // Method 2: Look for code blocks with filenames
  if (Object.keys(files).length === 0) {
    logger.info('No boltAction files found, trying code block pattern...');

    // Pattern for ```filename.ext
    const codeBlockPattern = /```([a-zA-Z0-9\/\-_.]+\.[a-zA-Z]+)\n([\s\S]*?)```/g;

    while ((match = codeBlockPattern.exec(content)) !== null) {
      const filePath = match[1];
      const fileContent = match[2].trim();
      logger.info(`Found file in code block: ${filePath} (${fileContent.length} bytes)`);
      files[filePath] = fileContent;
    }
  }

  // Method 3: Look for specific file patterns in markdown
  if (Object.keys(files).length === 0) {
    logger.info('No code block files found, trying markdown file pattern...');

    // Pattern for **filename.ext:**\n```
    const markdownFilePattern = /\*\*([a-zA-Z0-9\/\-_.]+\.[a-zA-Z]+):\*\*\s*\n```[a-zA-Z]*\n([\s\S]*?)```/g;

    while ((match = markdownFilePattern.exec(content)) !== null) {
      const filePath = match[1];
      const fileContent = match[2].trim();
      logger.info(`Found file in markdown pattern: ${filePath} (${fileContent.length} bytes)`);
      files[filePath] = fileContent;
    }
  }

  // Method 4: Look for file sections with headers
  if (Object.keys(files).length === 0) {
    logger.info('No markdown files found, trying file section headers...');

    // Pattern for ### filename.ext or ## filename.ext followed by code block
    const fileSectionPattern = /###?\s+([a-zA-Z0-9\/\-_.]+\.[a-zA-Z]+)\s*\n+```[a-zA-Z]*\n([\s\S]*?)```/g;

    while ((match = fileSectionPattern.exec(content)) !== null) {
      const filePath = match[1];
      const fileContent = match[2].trim();
      logger.info(`Found file in section header: ${filePath} (${fileContent.length} bytes)`);
      files[filePath] = fileContent;
    }
  }

  // Method 5: Look for common React file patterns in content
  if (Object.keys(files).length === 0) {
    logger.info('No section headers found, trying to extract React files from content...');

    // Create common React files if we detect React patterns
    if (
      content.includes('import React') ||
      content.includes('React.') ||
      content.includes('useState') ||
      content.includes('useEffect')
    ) {
      logger.info('React patterns detected, creating React file structure...');

      // Extract package.json if mentioned
      const packageMatch = content.match(/package\.json[:\s]*\n*```[a-zA-Z]*\n([\s\S]*?)```/);

      if (packageMatch) {
        files['package.json'] = packageMatch[1].trim();
        logger.info(`Created package.json (${files['package.json'].length} bytes)`);
      } else {
        // Create default package.json
        files['package.json'] = `{
  "name": "react-app",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.15",
    "@types/react-dom": "^18.2.7",
    "@vitejs/plugin-react": "^4.0.3",
    "vite": "^4.4.5"
  }
}`;
        logger.info('Created default package.json');
      }

      // Extract main component from any JSX code block
      const jsxMatches = content.match(/```jsx?\n([\s\S]*?)```/g);

      if (jsxMatches && jsxMatches.length > 0) {
        // Take the largest JSX block as the main component
        const mainJsx = jsxMatches
          .map((match) => match.replace(/```jsx?\n|```$/g, '').trim())
          .sort((a, b) => b.length - a.length)[0];

        files['src/App.jsx'] = mainJsx;
        logger.info(`Created src/App.jsx (${mainJsx.length} bytes)`);

        // Create main.jsx
        files['src/main.jsx'] = `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)`;
        logger.info('Created src/main.jsx');

        // Skip creating index.html - let Vite handle it during build
        logger.info('Skipping index.html creation - will be generated by Vite');

        // Create vite.config.js
        files['vite.config.js'] = `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})`;
        logger.info('Created vite.config.js');
      }
    }
  }

  // Method 4: Look for any structure that mentions files
  if (Object.keys(files).length === 0) {
    logger.info('No structured files found, looking for file mentions...');

    // Look for lines that mention creating files
    const lines = content.split('\n');
    let currentFile = null;
    let currentContent = [];
    let inCodeBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check if line mentions a file creation
      const fileCreationMatch = line.match(
        /(?:create|add|file|save)(?:\s+(?:a|an|the))?\s+(?:file\s+(?:called\s+)?)?["`']?([a-zA-Z0-9\/\-_.]+\.[a-zA-Z]+)["`']?/i,
      );

      if (fileCreationMatch) {
        // Save previous file if exists
        if (currentFile && currentContent.length > 0) {
          files[currentFile] = currentContent.join('\n').trim();
          logger.info(`Found file via content analysis: ${currentFile} (${files[currentFile].length} bytes)`);
        }

        currentFile = fileCreationMatch[1];
        currentContent = [];
        inCodeBlock = false;
        continue;
      }

      // Track code blocks
      if (line.startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        continue;
      }

      // If we're tracking a file and in a code block, collect content
      if (currentFile && inCodeBlock) {
        currentContent.push(line);
      }
    }

    // Save last file if exists
    if (currentFile && currentContent.length > 0) {
      files[currentFile] = currentContent.join('\n').trim();
      logger.info(`Found file via content analysis: ${currentFile} (${files[currentFile].length} bytes)`);
    }
  }

  // Log final results and debug info
  logger.info(`Total files extracted from artifact: ${Object.keys(files).length}`);
  logger.debug(`File paths found: ${Object.keys(files).join(', ')}`);

  // Enhanced debugging if no files were found
  if (Object.keys(files).length === 0) {
    logger.warn('No files extracted from content. Enhanced debugging:');
    logger.debug('Content length:', content.length);
    logger.debug('Sample content (first 1000 chars):');
    logger.debug(content.substring(0, 1000));
    logger.debug('Sample content (last 500 chars):');
    logger.debug(content.substring(Math.max(0, content.length - 500)));

    // Pattern analysis
    const patterns = [
      { name: 'boltAction tags', regex: /<boltAction/g },
      { name: 'Code blocks (```)', regex: /```/g },
      { name: 'React imports', regex: /import React/g },
      { name: 'useState usage', regex: /useState/g },
      { name: 'package.json mentions', regex: /package\.json/gi },
      { name: 'JSX elements', regex: /<[A-Z][a-zA-Z]*/g },
      { name: 'File extensions (.js/.jsx)', regex: /\.[jt]sx?/g },
    ];

    logger.debug('Pattern analysis:');
    patterns.forEach((pattern) => {
      const matches = content.match(pattern.regex);
      logger.debug(`  ${pattern.name}: ${matches ? matches.length : 0} matches`);

      if (matches && matches.length > 0 && matches.length <= 5) {
        logger.debug(`    Examples: ${matches.slice(0, 3).join(', ')}`);
      }
    });
  }

  return files;
}

/**
 * Detect framework type from files - mirrors UI logic from projectCommands.ts
 */
function detectFramework(files: Record<string, string>): string {
  // Convert to the format expected by detectProjectCommands
  const fileContents = Object.entries(files).map(([path, content]) => ({
    path,
    content,
  }));

  // Check if it has package.json
  const hasPackageJson = fileContents.some((f) => f.path.endsWith('package.json'));

  if (!hasPackageJson) {
    return 'vanilla';
  }

  const packageJsonFile = fileContents.find((f) => f.path.endsWith('package.json'));

  if (!packageJsonFile) {
    return 'vanilla';
  }

  try {
    const packageJson = JSON.parse(packageJsonFile.content);
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    const scripts = packageJson.scripts || {};

    // Framework detection based on dependencies - match the UI logic
    if (deps.next || deps['@next/core']) {
      return 'nextjs';
    }

    if (deps.react || deps['react-dom']) {
      // Check if it's a specific React framework
      if (deps.gatsby) {
        return 'gatsby';
      }

      if (scripts.dev?.includes('vite') || deps.vite) {
        return 'react-vite';
      }

      return 'react';
    }

    if (deps.vue || deps['@vue/core']) {
      if (deps.nuxt) {
        return 'nuxt';
      }

      return 'vue';
    }

    if (deps.svelte || deps['@sveltejs/kit']) {
      return 'svelte';
    }

    if (deps['@angular/core']) {
      return 'angular';
    }

    if (deps.astro || deps['@astrojs/core']) {
      return 'astro';
    }

    if (deps.remix || deps['@remix-run/node']) {
      return 'remix';
    }

    // Check for build tools that indicate a modern web app
    if (deps.vite || scripts.dev?.includes('vite')) {
      return 'vite';
    }

    if (deps.webpack || scripts.dev?.includes('webpack')) {
      return 'webpack';
    }

    // If it has package.json and scripts, it's likely a Node.js project
    if (Object.keys(scripts).length > 0) {
      return 'nodejs';
    }

    return 'vanilla';
  } catch (error) {
    logger.warn('Failed to parse package.json for framework detection:', error);
    return 'vanilla';
  }
}

/**
 * Create a ZIP archive from files in memory
 */
async function createZipArchive(files: Record<string, string>): Promise<Blob> {
  // Dynamic import to avoid bundling issues
  const { default: jsZip } = await import('jszip');
  const zip = new jsZip();

  // Add files to zip
  for (const [path, content] of Object.entries(files)) {
    // Remove leading slash if present
    const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
    zip.file(normalizedPath, content);
  }

  // Generate zip blob
  return await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

/**
 * Build the project using the cloud build service
 */
async function buildProjectWithCloudService(params: {
  siteId: string;
  archiveUrl: string;
  buildCommand?: string;
}): Promise<{
  success: boolean;
  deployUrl?: string;
  error?: string;
}> {
  const buildServiceUrl = 'https://build-api-829111227941.asia-southeast1.run.app';

  try {
    logger.info('Submitting build job to cloud service');

    // Submit build job
    const submitResponse = await fetch(`${buildServiceUrl}/api/v1/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        siteId: params.siteId,
        archiveUrl: params.archiveUrl,
        buildCommand: params.buildCommand || 'npm run build',
      }),
    });

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text();
      throw new Error(`Build service error: ${submitResponse.statusText} - ${errorText}`);
    }

    const { jobId } = (await submitResponse.json()) as { jobId: string };
    logger.info(`Build job created: ${jobId}`);

    // Poll for completion
    let attempts = 0;
    const maxAttempts = 900; // 15 minutes timeout (checking every second)
    let lastStatus = '';

    while (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const statusResponse = await fetch(`${buildServiceUrl}/api/v1/build/${jobId}`);

      if (!statusResponse.ok) {
        throw new Error(`Failed to get build status: ${statusResponse.statusText}`);
      }

      const job = (await statusResponse.json()) as {
        status: string;
        deployUrl?: string;
        error?: string;
      };

      // Only log when status changes
      if (job.status !== lastStatus) {
        logger.info(`Build job ${jobId} status changed: ${lastStatus} -> ${job.status}`);
        lastStatus = job.status;
      } else if (attempts % 10 === 0) {
        // Log every 10 seconds if status hasn't changed
        logger.debug(`Build job ${jobId} still ${job.status} (${attempts}s elapsed)`);
      }

      if (job.status === 'DEPLOYED') {
        logger.info(`Build deployed successfully: ${job.deployUrl}`);
        return {
          success: true,
          deployUrl: job.deployUrl,
        };
      }

      if (job.status === 'FAILED') {
        logger.error(`Build failed: ${job.error}`);
        return {
          success: false,
          error: job.error || 'Build failed',
        };
      }

      // If stuck in QUEUED for too long, timeout
      if (job.status === 'QUEUED' && attempts > 180) {
        logger.warn('Build job stuck in QUEUED state for over 3 minutes');
        throw new Error('Build service timeout - job stuck in queue (workers likely overloaded)');
      }

      attempts++;
    }

    throw new Error(`Build timeout - job did not complete within ${maxAttempts} seconds (5 minutes)`);
  } catch (error) {
    logger.error('Cloud build service error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown build error',
    };
  }
}

/**
 * Create a GitHub repository and upload files to it
 */
async function createGitHubRepository(files: Record<string, string>, token: string): Promise<string> {
  let repoCreated = false;
  let attempts = 0;
  const maxAttempts = 3;
  let repoName = '';
  let repo: any = null;

  // Retry loop for repo creation in case of name conflicts
  while (!repoCreated && attempts < maxAttempts) {
    try {
      // Generate a more random repo name to avoid conflicts
      const timestamp = Date.now();
      const randomSuffix = generateRandomString(6); // 6 random alphanumeric chars
      repoName = `bolt-build-${timestamp}-${randomSuffix}`;

      if (attempts > 0) {
        logger.info(`Retry ${attempts}: Creating GitHub repository: ${repoName}`);
      } else {
        logger.info(`Creating GitHub repository: ${repoName}`);
      }

      logger.info(`Files to upload to GitHub: ${Object.keys(files).length}`);
      logger.debug(`File list: ${Object.keys(files).join(', ')}`);

      // Create repository
      const createRepoResponse = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'bolt-diy-builder',
        },
        body: JSON.stringify({
          name: repoName,
          description: 'Generated project for Bolt.diy build service',
          private: false, // Must be public for archive URL access
          auto_init: false,
        }),
      });

      if (!createRepoResponse.ok) {
        const errorText = await createRepoResponse.text();

        // Check if it's a conflict error
        if (createRepoResponse.status === 409 || errorText.includes('already exists')) {
          logger.warn(`Repository name conflict: ${repoName}, will retry with new name`);
          attempts++;
          continue; // Retry with a new name
        }

        throw new Error(`Failed to create GitHub repository: ${createRepoResponse.statusText} - ${errorText}`);
      }

      repo = await createRepoResponse.json();
      repoCreated = true;
      logger.info(`Repository created successfully: ${repo.full_name}`);
    } catch (error) {
      if (attempts < maxAttempts - 1) {
        logger.warn(`Failed to create repo on attempt ${attempts + 1}:`, error);
        attempts++;

        // Add small delay before retry
        await new Promise((resolve) => setTimeout(resolve, 500));
      } else {
        throw error;
      }
    }
  }

  if (!repoCreated || !repo) {
    throw new Error('Failed to create GitHub repository after all attempts');
  }

  try {
    const ownerLogin = repo.owner.login;

    // Create a map to track directories and ensure they have at least one file
    const filesToUpload = new Map<string, string>();
    const directories = new Set<string>();

    // Process all files to identify directories
    Object.entries(files).forEach(([filePath, content]) => {
      const normalizedPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;

      if (normalizedPath && !normalizedPath.includes('..')) {
        filesToUpload.set(normalizedPath, content);

        // Extract directory paths
        const parts = normalizedPath.split('/');

        if (parts.length > 1) {
          for (let i = 1; i < parts.length; i++) {
            directories.add(parts.slice(0, i).join('/'));
          }
        }
      }
    });

    // Add .gitkeep files for empty directories (though with our current setup, all dirs have files)
    directories.forEach((dir) => {
      const gitkeepPath = `${dir}/.gitkeep`;

      if (
        !filesToUpload.has(gitkeepPath) &&
        !Array.from(filesToUpload.keys()).some((path) => path.startsWith(dir + '/'))
      ) {
        filesToUpload.set(gitkeepPath, '');
      }
    });

    // Sort files to ensure parent directories are created before nested files
    const sortedFiles = Array.from(filesToUpload.entries()).sort(([pathA], [pathB]) => {
      const depthA = pathA.split('/').length;
      const depthB = pathB.split('/').length;

      // Files with fewer slashes (less nested) come first
      if (depthA !== depthB) {
        return depthA - depthB;
      }

      // Within same depth, sort alphabetically
      return pathA.localeCompare(pathB);
    });

    logger.info(`Uploading ${sortedFiles.length} files to GitHub in order...`);

    // Upload files sequentially to avoid directory creation conflicts
    for (const [normalizedPath, content] of sortedFiles) {
      logger.info(`Uploading file to GitHub: ${normalizedPath} (${content.length} bytes)`);

      const createFileResponse = await fetch(
        `https://api.github.com/repos/${ownerLogin}/${repoName}/contents/${normalizedPath}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'bolt-diy-builder',
          },
          body: JSON.stringify({
            message: `Add ${normalizedPath}`,
            content: Buffer.from(content, 'utf8').toString('base64'),
            committer: {
              name: 'Bolt.diy Builder',
              email: 'noreply@bolt.diy',
            },
          }),
        },
      );

      if (!createFileResponse.ok) {
        const errorText = await createFileResponse.text();
        logger.error(`Failed to create file ${normalizedPath}: ${createFileResponse.statusText} - ${errorText}`);
        throw new Error(`Failed to create file ${normalizedPath}: ${createFileResponse.statusText}`);
      }

      logger.info(`Successfully uploaded file to GitHub: ${normalizedPath}`);
    }

    logger.info(`Completed uploading ${sortedFiles.length} files to GitHub repository`);

    // Return the archive URL for the main branch
    const archiveUrl = `https://github.com/${ownerLogin}/${repoName}/archive/refs/heads/main.zip`;
    logger.info(`GitHub archive URL: ${archiveUrl}`);

    // Validate archive accessibility with retry logic
    let validationAttempts = 0;
    const maxValidationAttempts = 3;
    const validationDelay = 2000; // 2 seconds

    while (validationAttempts < maxValidationAttempts) {
      try {
        const archiveResponse = await fetch(archiveUrl, { method: 'HEAD' });

        if (archiveResponse.ok) {
          logger.info(`GitHub archive validated successfully after ${validationAttempts + 1} attempts`);
          return archiveUrl;
        } else {
          logger.warn(`Archive validation attempt ${validationAttempts + 1} failed: ${archiveResponse.status}`);
        }
      } catch (validationError) {
        logger.warn(`Archive validation attempt ${validationAttempts + 1} error:`, validationError);
      }

      validationAttempts++;

      if (validationAttempts < maxValidationAttempts) {
        logger.info(`Waiting ${validationDelay}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, validationDelay));
      }
    }

    logger.warn(`Archive validation failed after ${maxValidationAttempts} attempts, but returning URL anyway`);

    return archiveUrl;
  } catch (error) {
    logger.error('Failed to create GitHub repository:', error);
    throw error;
  }
}

/**
 * Upload ZIP archive to a temporary Netlify site for use as archive URL (fallback method)
 */
async function uploadArchiveToNetlify(zipBlob: Blob, token: string): Promise<string> {
  try {
    // Create a temporary site for hosting the archive
    const siteName = `bolt-archive-${Date.now()}`;
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
      throw new Error('Failed to create temporary site for archive');
    }

    const site = (await createSiteResponse.json()) as NetlifyResponse;
    const siteId = site.id;

    // Convert blob to buffer for upload
    const arrayBuffer = await zipBlob.arrayBuffer();
    const zipBuffer = Buffer.from(arrayBuffer);

    // Create a simple HTML page that serves the ZIP file
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="refresh" content="0;url=/archive.zip">
</head>
<body>
  <a href="/archive.zip">Download Archive</a>
</body>
</html>`;

    // Prepare file digests
    const indexHash = await sha1(html);
    const zipHash = await sha1(zipBuffer.toString('binary'));

    // Create deployment
    const deployResponse = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/deploys`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        files: {
          '/index.html': indexHash,
          '/archive.zip': zipHash,
        },
        async: true,
      }),
    });

    if (!deployResponse.ok) {
      throw new Error('Failed to create deployment for archive');
    }

    const deploy = (await deployResponse.json()) as NetlifyResponse;
    const deployId = deploy.id;

    // Wait for deploy to be ready and upload files
    let ready = false;
    let retries = 0;

    while (!ready && retries < 30) {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const statusResponse = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/deploys/${deployId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const status = (await statusResponse.json()) as NetlifyResponse;

      if (status.state === 'prepared' || status.state === 'uploaded') {
        // Upload HTML
        await fetch(`https://api.netlify.com/api/v1/deploys/${deployId}/files/index.html`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/octet-stream',
          },
          body: html,
        });

        // Upload ZIP
        await fetch(`https://api.netlify.com/api/v1/deploys/${deployId}/files/archive.zip`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/octet-stream',
          },
          body: zipBuffer,
        });

        ready = true;
      } else if (status.state === 'ready') {
        return `${status.ssl_url || status.url}/archive.zip`;
      }

      retries++;
    }

    // Wait a bit more for deployment to be ready
    await new Promise((resolve) => setTimeout(resolve, 2000));

    return `https://${siteName}.netlify.app/archive.zip`;
  } catch (error) {
    logger.error('Failed to upload archive:', error);
    throw error;
  }
}

export async function action({ request, context }: ActionFunctionArgs) {
  try {
    // Parse request body
    const body = (await request.json()) as ExternalGenerateRequest;

    // Validate required fields
    if (!body.prompt || typeof body.prompt !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing or invalid "prompt" in request body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const {
      prompt,
      model = 'openai/gpt-4.1',
      provider = { name: 'OpenRouter', staticModels: [] } as ProviderInfo,
      apiKey,
      template,
      autoSelectTemplate = true,
      deploy = false,
      netlifyToken,
      siteId,
      chatId = `chat-${Date.now()}`,
      githubToken,
    } = body;

    logger.info(
      `Received external generation request: "${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}"`,
    );

    // Get API keys and provider settings from cookies and merge with request
    const cookieHeader = request.headers.get('Cookie') || '';
    const cookieApiKeys = getApiKeysFromCookie(cookieHeader);
    const providerSettings = getProviderSettingsFromCookie(cookieHeader);

    // Merge API keys: request body takes precedence over cookies
    const apiKeys = { ...cookieApiKeys };

    if (apiKey && provider) {
      apiKeys[provider.name] = apiKey;
    }

    // Build messages array exactly like the UI does
    const messages: Messages = [];
    let selectedTemplate: string | undefined = template;
    let templateTitle: string | undefined;

    // 1. Template selection (if enabled and not provided) - EXACTLY like UI
    if (autoSelectTemplate && !template) {
      try {
        logger.info('Auto-selecting template...');

        const templateResult = await selectStarterTemplate({
          message: prompt,
          model,
          provider,
        });

        if (templateResult) {
          selectedTemplate = templateResult.template;
          templateTitle = templateResult.title;
          logger.info(`Selected template: ${selectedTemplate} with title: ${templateTitle}`);
        }
      } catch (error) {
        logger.warn('Template selection failed, proceeding without template:', error);
        selectedTemplate = 'blank';
      }
    }

    // 2. Build messages exactly like UI does in sendMessage function
    if (selectedTemplate && selectedTemplate !== 'blank') {
      try {
        logger.info(`Loading template: ${selectedTemplate}`);

        const temResp = await getTemplates(selectedTemplate, templateTitle || prompt);

        if (temResp) {
          const { assistantMessage, userMessage } = temResp;

          // Mirror the exact UI message structure
          messages.push({
            id: `1-${Date.now()}`,
            role: 'user',
            content: prompt,
          } as any);

          messages.push({
            id: `2-${Date.now()}`,
            role: 'assistant',
            content: assistantMessage,
          } as any);

          messages.push({
            id: `3-${Date.now()}`,
            role: 'user',
            content: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${userMessage}`,
          } as any);
        } else {
          // Fallback if template loading fails
          selectedTemplate = 'blank';
        }
      } catch (error) {
        logger.warn('Template loading failed, proceeding without template:', error);
        selectedTemplate = 'blank';
      }
    }

    // 3. If blank template or no template, use simple message like UI does
    if (!selectedTemplate || selectedTemplate === 'blank') {
      messages.push({
        id: `1-${Date.now()}`,
        role: 'user',
        content: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${prompt}`,
      } as any);
    }

    // 4. Generate response using the same system as UI
    logger.info(`Generating response with ${provider.name} model: ${model}`);

    const options = {
      system: getSystemPrompt(WORK_DIR),
      toolChoice: 'none' as const,
    };

    let fullContent = '';

    // 5. If not deploying, stream directly
    if (!deploy) {
      logger.info('Returning stream response (no deployment)');

      const streamResult = await streamText({
        messages,
        env: context.cloudflare?.env as any,
        options,
        apiKeys,
        providerSettings,
        files: {},
        promptId: undefined,
        contextOptimization: false,
        contextFiles: {},
        summary: undefined,
      });

      return new Response(streamResult.textStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }

    // 6. For deployment, collect the full text
    logger.info('Generating content for deployment...');

    try {
      const result = await streamText({
        messages,
        env: context.cloudflare?.env as any,
        options,
        apiKeys,
        providerSettings,
        files: {},
        promptId: undefined,
        contextOptimization: false,
        contextFiles: {},
        summary: undefined,
      });

      // Collect text from fullStream
      for await (const part of result.fullStream) {
        logger.debug(`Stream part type: ${part.type}`);

        if (part.type === 'text-delta' && 'textDelta' in part && part.textDelta) {
          fullContent += part.textDelta;
        } else if (part.type === 'finish') {
          logger.info('Stream finished');
        } else if (part.type === 'error') {
          logger.error('Stream error part:', part);
          throw new Error(`Stream error: ${(part as any).error}`);
        }
      }
    } catch (streamError) {
      logger.error('Error generating content:', streamError);
      throw new Error('Failed to generate content');
    }

    logger.info(`Generated ${fullContent.length} characters`);

    // 7. Parse generated content for files
    const extractedFiles = parseArtifactFiles(fullContent);

    if (Object.keys(extractedFiles).length === 0) {
      logger.warn('No files found in generated content, creating default HTML file');
      logger.debug('Sample of generated content (first 500 chars):');
      logger.debug(fullContent.substring(0, 500));
      extractedFiles['index.html'] = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Generated Application</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.1/anime.min.js"></script>
</head>
<body class="bg-gray-50 min-h-screen flex items-center justify-center p-4">
  <div class="max-w-2xl mx-auto text-center animate-in">
    <h1 class="text-4xl font-bold text-gray-800 mb-4">Generated Application</h1>
    <p class="text-gray-600 mb-8">Your application has been generated successfully!</p>
    <div class="bg-white p-6 rounded-lg shadow-lg">
      <pre class="text-left text-sm text-gray-700 overflow-auto">${fullContent.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
    </div>
  </div>

  <script>
    // Add entrance animation
    document.addEventListener('DOMContentLoaded', () => {
      anime({
        targets: '.animate-in',
        opacity: [0, 1],
        translateY: [30, 0],
        duration: 800,
        easing: 'easeOutQuad'
      });
    });
  </script>
</body>
</html>`;
    }

    logger.info(`Extracted ${Object.keys(extractedFiles).length} files for deployment`);

    // 8. Detect framework and determine deployment strategy
    const detectedFramework = detectFramework(extractedFiles);
    logger.info(`Detected framework: ${detectedFramework}`);

    // For React projects, replace any LLM-generated index.html with proper Vite template
    if (detectedFramework === 'react' || detectedFramework === 'react-vite') {
      if (extractedFiles['index.html']) {
        logger.info('Replacing LLM-generated index.html with proper Vite template for React project');
        extractedFiles['index.html'] = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>React App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>`;
      }
    }

    let deploymentResult: { success: boolean; url?: string; error?: string } | null = null;
    const filesToDeploy = extractedFiles;

    // For framework projects that need building, use cloud build service
    const frameworksNeedingBuild = [
      'react',
      'react-vite',
      'nextjs',
      'vue',
      'nuxt',
      'svelte',
      'angular',
      'astro',
      'remix',
      'vite',
      'nodejs',
    ];
    const needsBuild = frameworksNeedingBuild.includes(detectedFramework);

    logger.info(
      `Build decision: framework=${detectedFramework}, needsBuild=${needsBuild}, cloudServiceEnabled=${process.env.USE_CLOUD_BUILD_SERVICE !== 'false'}, disableHeader=${!!request.headers.get('X-Disable-Cloud-Build')}`,
    );

    if (
      needsBuild &&
      process.env.USE_CLOUD_BUILD_SERVICE !== 'false' &&
      !request.headers.get('X-Disable-Cloud-Build')
    ) {
      logger.info('Framework project detected, using cloud build service...');

      try {
        let archiveUrl: string;

        // Try GitHub first if token is provided
        if (githubToken) {
          logger.info('Creating GitHub repository for archive...');

          try {
            archiveUrl = await createGitHubRepository(extractedFiles, githubToken);
            logger.info(`GitHub archive URL created successfully: ${archiveUrl}`);
          } catch (githubError) {
            logger.error('GitHub repository creation failed:', githubError);
            logger.info('Falling back to Netlify archive method due to GitHub error...');

            const zipBlob = await createZipArchive(extractedFiles);
            logger.info(`Created ZIP archive: ${zipBlob.size} bytes`);
            archiveUrl = await uploadArchiveToNetlify(zipBlob, netlifyToken!);
            logger.info(`Fallback archive uploaded: ${archiveUrl}`);
          }
        } else {
          // Fallback to Netlify method
          logger.info('GitHub token not provided, falling back to Netlify archive method...');

          const zipBlob = await createZipArchive(extractedFiles);
          logger.info(`Created ZIP archive: ${zipBlob.size} bytes`);

          // Upload archive to temporary Netlify site
          logger.info('Uploading archive to temporary site...');
          archiveUrl = await uploadArchiveToNetlify(zipBlob, netlifyToken!);
          logger.info(`Archive uploaded: ${archiveUrl}`);
        }

        // Ensure we have a site ID
        let buildSiteId = siteId;

        if (!buildSiteId) {
          // Create the target site first
          const siteName = `bolt-diy-${chatId}-${Date.now()}`;
          const createSiteResponse = await fetch('https://api.netlify.com/api/v1/sites', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${netlifyToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: siteName,
              custom_domain: null,
            }),
          });

          if (!createSiteResponse.ok) {
            throw new Error('Failed to create target site');
          }

          const newSite = (await createSiteResponse.json()) as NetlifyResponse;
          buildSiteId = newSite.id;
        }

        // Submit to cloud build service
        logger.info(`Submitting to cloud build service with site ID: ${buildSiteId} and archive URL: ${archiveUrl}`);

        const buildResult = await buildProjectWithCloudService({
          siteId: buildSiteId!,
          archiveUrl,
          buildCommand: detectedFramework === 'nextjs' ? 'npm run build' : undefined,
        });

        logger.info(`Cloud build result: success=${buildResult.success}, error=${buildResult.error}`);

        if (buildResult.success && buildResult.deployUrl) {
          logger.info(`Cloud build succeeded with deploy URL: ${buildResult.deployUrl}`);
          deploymentResult = {
            success: true,
            url: buildResult.deployUrl,
          };
        } else {
          logger.warn(`Cloud build failed: ${buildResult.error || 'Unknown error'}`);
          logger.warn('Falling back to direct deployment');

          // Fall back to direct deployment
        }
      } catch (error) {
        logger.error('Cloud build service error:', error);
        logger.warn('Falling back to direct deployment of source files');
      }
    }

    // 9. Deploy to Netlify (if not already deployed via cloud build)
    if (!netlifyToken) {
      return new Response(
        JSON.stringify({
          error: 'Netlify token is required for deployment',
          generatedContent: fullContent,
          files: Object.keys(extractedFiles),
          framework: detectedFramework,
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    // If cloud build succeeded, return that result
    if (deploymentResult?.success) {
      logger.info('Deployment successful via cloud build service');

      return new Response(
        JSON.stringify({
          success: true,
          generatedContent: fullContent,
          files: Object.keys(extractedFiles),
          template: selectedTemplate,
          framework: detectedFramework,
          deployment: {
            success: true,
            deploy: {
              url: deploymentResult.url!,
              state: 'ready',
            },
          },
          buildMethod: 'cloud',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    // Otherwise, do direct deployment
    try {
      const deployResult = await deployToNetlify({
        files: filesToDeploy,
        token: netlifyToken,
        siteId,
        chatId,
      });

      logger.info('Direct deployment successful');

      return new Response(
        JSON.stringify({
          success: true,
          generatedContent: fullContent,
          files: Object.keys(extractedFiles),
          builtFiles: Object.keys(filesToDeploy),
          template: selectedTemplate,
          framework: detectedFramework,
          deployment: deployResult,
          buildMethod: 'direct',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    } catch (deployError) {
      logger.error('Deployment failed:', deployError);

      return new Response(
        JSON.stringify({
          success: false,
          generatedContent: fullContent,
          files: Object.keys(extractedFiles),
          template: selectedTemplate,
          framework: detectedFramework,
          error: `Deployment failed: ${deployError instanceof Error ? deployError.message : 'Unknown error'}`,
        }),
        {
          status: 200, // Still return 200 since generation succeeded
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
