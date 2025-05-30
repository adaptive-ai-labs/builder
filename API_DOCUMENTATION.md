# Bolt.diy API Documentation

## Overview

The Bolt.diy API allows you to generate and deploy web applications using natural language prompts. The API is powered by various LLM providers and includes automatic framework detection, cloud building with real-time monitoring, and deployment to Netlify.

**Base URL:** `https://builder-3v5.pages.dev`

## Endpoints

### POST /api/generate-external-v2

Generate and optionally deploy a web application from a natural language prompt with support for real-time build monitoring.

#### Request Body

```json
{
  "prompt": "string (required)",
  "model": "string (optional)",
  "provider": {
    "name": "string (optional)",
    "staticModels": []
  },
  "apiKey": "string (optional)",
  "template": "string (optional)",
  "autoSelectTemplate": "boolean (optional, default: true)",
  "deploy": "boolean (optional, default: false)",
  "netlifyToken": "string (required for deployment)",
  "siteId": "string (optional)",
  "chatId": "string (optional)",
  "githubToken": "string (REQUIRED for framework projects)"
}
```

#### Parameters

| Parameter            | Type    | Required | Description                                                        |
| -------------------- | ------- | -------- | ------------------------------------------------------------------ |
| `prompt`             | string  | ✅       | Natural language description of the application to generate        |
| `model`              | string  | ❌       | LLM model to use (default: "openai/gpt-4.1")                       |
| `provider`           | object  | ❌       | LLM provider configuration (default: OpenRouter)                   |
| `apiKey`             | string  | ❌       | API key for the LLM provider                                       |
| `template`           | string  | ❌       | Specific template to use (e.g., "react", "nextjs", "vue")          |
| `autoSelectTemplate` | boolean | ❌       | Whether to auto-select the best template (default: true)           |
| `deploy`             | boolean | ❌       | Whether to deploy the generated application (default: false)       |
| `netlifyToken`       | string  | ✅\*     | Netlify API token (\*required if deploy=true)                      |
| `siteId`             | string  | ❌       | Existing Netlify site ID to deploy to                              |
| `chatId`             | string  | ❌       | Custom chat ID for site naming                                     |
| `githubToken`        | string  | ✅\*\*   | GitHub personal access token (\*\*REQUIRED for framework projects) |

#### Supported Templates

- `react` - React with Vite
- `nextjs` - Next.js application
- `vue` - Vue.js application
- `svelte` - Svelte application
- `angular` - Angular application
- `astro` - Astro static site
- `remix` - Remix full-stack framework
- `blank` - No template (generate from scratch)

#### Supported LLM Providers

- **OpenRouter** (default) - Access to multiple models
- **OpenAI** - GPT models
- **Anthropic** - Claude models
- **Google** - Gemini models
- **Groq** - Fast inference
- **Mistral** - Mistral models
- **And many more...**

#### Response (Generation Only)

When `deploy=false`, returns a text stream with the generated content:

```
Content-Type: text/event-stream
```

#### Response (With Deployment)

When `deploy=true`, the response depends on the build method:

**Cloud Build Response (Framework Projects):**

```json
{
  "success": true,
  "generatedContent": "string",
  "files": ["array", "of", "generated", "file", "paths"],
  "template": "string",
  "framework": "string",
  "deployment": {
    "type": "cloud-build",
    "jobId": "unique-build-job-id",
    "siteId": "netlify-site-id",
    "status": "BUILDING",
    "monitorUrl": "/api/build-status/job-id",
    "streamUrl": "/api/build-stream/job-id",
    "buildServiceMonitorUrl": "https://build-api-829111227941.asia-southeast1.run.app/api/v1/build/job-id",
    "buildServiceStreamUrl": "https://build-api-829111227941.asia-southeast1.run.app/api/v1/build/job-id/sse"
  },
  "buildMethod": "cloud"
}
```

**Direct Deploy Response (Static Sites):**

```json
{
  "success": true,
  "generatedContent": "string",
  "files": ["array", "of", "generated", "file", "paths"],
  "builtFiles": ["array", "of", "deployed", "file", "paths"],
  "template": "string",
  "framework": "string",
  "deployment": {
    "success": true,
    "deploy": {
      "id": "deploy-id",
      "state": "ready",
      "url": "https://your-app.netlify.app"
    },
    "site": {
      "id": "site-id",
      "name": "site-name",
      "url": "https://your-app.netlify.app",
      "chatId": "chat-id"
    }
  },
  "buildMethod": "direct"
}
```

### GET /api/build-status/$jobId

Monitor the status of a cloud build job.

#### Parameters

- `jobId`: The build job ID returned from the deployment response

#### Response

```json
{
  "jobId": "unique-build-job-id",
  "status": "BUILDING|SUCCESS|FAILED",
  "progress": "descriptive status message",
  "deployUrl": "https://your-app.netlify.app" // (only when status is SUCCESS)
}
```

### GET /api/build-stream/$jobId

Stream real-time build logs via Server-Sent Events (SSE).

#### Parameters

- `jobId`: The build job ID returned from the deployment response

#### Response

```
Content-Type: text/event-stream

data: {"type": "log", "message": "Starting build process..."}
data: {"type": "log", "message": "Installing dependencies..."}
data: {"type": "progress", "status": "BUILDING"}
data: {"type": "success", "deployUrl": "https://your-app.netlify.app"}
```

## Framework Detection & Building

The API automatically detects the framework type based on generated files and dependencies:

- **React/Vite Projects**: Uses cloud build service for proper JSX transpilation
- **Next.js**: Optimized build process with SSR support
- **Vue.js Projects**: Cloud build with Vue CLI or Vite
- **Svelte Projects**: Cloud build with SvelteKit
- **Angular Projects**: Cloud build with Angular CLI
- **Static Sites**: Direct deployment without building
- **Node.js Projects**: Cloud build with dependency installation

### Cloud Build Service (v2 Enhanced)

For framework projects requiring transpilation (React, Vue, etc.):

1. **GitHub Repository Creation**: Creates a temporary public GitHub repository with your code
2. **Cloud Build Submission**: Submits build job to dedicated cloud build service
3. **Real-time Monitoring**: Returns job ID for immediate monitoring via `/api/build-status/$jobId`
4. **Live Build Logs**: Stream build progress via `/api/build-stream/$jobId`
5. **Automatic Deployment**: Deploys built assets to Netlify upon successful build
6. **Clean URLs**: Returns final deployment URL

## Examples

### 1. Generate Only (No Deployment)

```bash
curl -X POST https://builder-3v5.pages.dev/api/generate-external-v2 \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Create a React todo app with add, delete, and mark complete functionality",
    "apiKey": "your-openrouter-api-key"
  }'
```

### 2. Generate and Deploy a React App (Cloud Build)

```bash
curl -X POST https://builder-3v5.pages.dev/api/generate-external-v2 \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Create a React weather app that shows current weather for a city",
    "deploy": true,
    "netlifyToken": "your-netlify-token",
    "githubToken": "your-github-token",
    "apiKey": "your-openrouter-api-key",
    "template": "react"
  }'
```

**Response:** Returns immediately with build job ID for monitoring:

```json
{
  "success": true,
  "deployment": {
    "type": "cloud-build",
    "jobId": "build-1748573307973-abc123",
    "status": "BUILDING",
    "monitorUrl": "/api/build-status/build-1748573307973-abc123",
    "streamUrl": "/api/build-stream/build-1748573307973-abc123"
  },
  "buildMethod": "cloud"
}
```

### 3. Monitor Build Progress

```bash
# Monitor build status
curl https://builder-3v5.pages.dev/api/build-status/build-1748573307973-abc123

# Stream build logs in real-time
curl -N https://builder-3v5.pages.dev/api/build-stream/build-1748573307973-abc123
```

### 4. Deploy to Existing Site

```bash
curl -X POST https://builder-3v5.pages.dev/api/generate-external-v2 \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Update my app with a dark mode toggle",
    "deploy": true,
    "netlifyToken": "your-netlify-token",
    "githubToken": "your-github-token",
    "siteId": "existing-site-id",
    "apiKey": "your-openrouter-api-key"
  }'
```

### 5. Use Specific Model and Provider

```bash
curl -X POST https://builder-3v5.pages.dev/api/generate-external-v2 \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Create a Vue.js dashboard with charts",
    "model": "anthropic/claude-3-sonnet",
    "provider": {
      "name": "OpenRouter",
      "staticModels": []
    },
    "deploy": true,
    "netlifyToken": "your-netlify-token",
    "githubToken": "your-github-token",
    "apiKey": "your-openrouter-api-key"
  }'
```

## Error Responses

### 400 Bad Request

```json
{
  "error": "Missing or invalid \"prompt\" in request body"
}
```

### 400 GitHub Token Required

```json
{
  "error": "GitHub token is required for cloud builds. Please provide githubToken parameter or set GITHUB_TOKEN environment variable."
}
```

### 400 Netlify Token Required

```json
{
  "error": "Netlify token is required for deployment",
  "generatedContent": "string",
  "files": ["array", "of", "generated", "file", "paths"],
  "framework": "string"
}
```

### 500 Internal Server Error

```json
{
  "error": "Failed to process request: [error message]"
}
```

### Build Job Status Responses

**Building:**

```json
{
  "jobId": "build-12345",
  "status": "BUILDING",
  "progress": "Installing dependencies..."
}
```

**Success:**

```json
{
  "jobId": "build-12345",
  "status": "SUCCESS",
  "progress": "Build completed successfully",
  "deployUrl": "https://your-app.netlify.app"
}
```

**Failed:**

```json
{
  "jobId": "build-12345",
  "status": "FAILED",
  "progress": "Build failed: npm install error",
  "error": "Detailed error message"
}
```

## Getting API Keys

### 1. OpenRouter API Key (Recommended)

- Visit [OpenRouter](https://openrouter.ai/)
- Sign up and get API key
- Provides access to multiple LLM models

### 2. Netlify Token (Required for Deployment)

- Go to [Netlify](https://app.netlify.com/) → User Settings → Applications
- Generate new access token
- Scope: Full access

### 3. GitHub Token (REQUIRED for Framework Projects)

- Go to GitHub → Settings → Developer settings → Personal access tokens
- Generate token with `repo` scope
- **REQUIRED** for all framework projects (React, Vue, Angular, etc.)
- Enables reliable archive URLs for cloud builds

## Best Practices

1. **GitHub Token is MANDATORY**: Always provide a GitHub token for framework projects. Cloud builds will fail without it due to unreliable Netlify archive URLs.

2. **Monitor Build Progress**: For framework projects, use the monitoring endpoints:

   - Poll `/api/build-status/$jobId` for status updates
   - Stream `/api/build-stream/$jobId` for real-time logs

3. **Specific Prompts**: Be specific in your prompts. Instead of "make a website", try "create a React todo app with local storage and dark mode".

4. **Template Selection**: Use appropriate templates for better results:

   - `react` for interactive UIs with modern tooling
   - `nextjs` for full-stack applications with SSR
   - `vue` for Vue.js applications
   - `astro` for content-focused static sites
   - `blank` for vanilla HTML/CSS/JS

5. **Error Handling**: Always check the response status and handle errors appropriately:

   - Handle 400 errors for missing tokens
   - Monitor build job status for cloud builds
   - Implement retry logic for network failures

6. **Real-time Integration**: For the best user experience:

   - Show build progress using the streaming endpoint
   - Display build logs to users
   - Handle build failures gracefully

7. **Rate Limiting**: Be mindful of API rate limits from LLM providers and GitHub API.

## Supported File Types

The API can generate and deploy:

- **Frontend**: React, Vue, Svelte, Angular applications
- **Static Sites**: HTML, CSS, JavaScript
- **Full-Stack**: Next.js, Remix applications
- **Configuration**: package.json, vite.config.js, etc.
- **Styles**: CSS, SCSS, Tailwind CSS
- **Assets**: Images, fonts (via CDN links)

## Build Process

### Cloud Build (Enhanced v2)

1. **GitHub Repository**: Code is uploaded to a temporary public GitHub repository
2. **Archive URL**: GitHub archive URL is generated for reliable access
3. **Build Submission**: Build job is submitted to cloud build service
4. **Real-time Monitoring**: Job ID returned immediately for progress tracking
5. **Live Logs**: Build progress streamed via Server-Sent Events
6. **Automatic Deployment**: Built assets deployed to Netlify upon success
7. **Status Updates**: Final deployment URL provided when complete

### Direct Deployment (Static Sites Only)

1. Source files are uploaded directly to Netlify
2. No transpilation or building
3. Suitable for static HTML/CSS/JS files
4. Immediate deployment without build process

## Limitations

- **GitHub Token Required**: Framework projects MUST provide a GitHub token
- **Public Repositories**: GitHub repositories are created as public for archive access
- **Build Time**: Cloud builds have a 15-minute timeout
- **Dependencies**: Some complex dependencies may not install correctly
- **File Size**: Individual files limited to reasonable sizes for GitHub upload
- **Archive Reliability**: Only GitHub archives supported (Netlify archives disabled due to reliability issues)

## Support

For issues or questions:

- Check the response error messages for details
- Monitor build status using `/api/build-status/$jobId` for cloud builds
- Stream build logs via `/api/build-stream/$jobId` for detailed debugging
- Ensure all required tokens are valid (GitHub token is MANDATORY for frameworks)
- Verify prompt clarity and specificity
- For framework projects, always include a GitHub token

## Advanced Usage

### Custom Build Monitoring Integration

```javascript
async function deployAndMonitor(prompt, tokens) {
  // 1. Submit deployment
  const response = await fetch('/api/generate-external-v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      deploy: true,
      netlifyToken: tokens.netlify,
      githubToken: tokens.github,
      apiKey: tokens.llm,
    }),
  });

  const result = await response.json();

  if (result.deployment?.type === 'cloud-build') {
    const jobId = result.deployment.jobId;

    // 2. Stream build logs
    const eventSource = new EventSource(`/api/build-stream/${jobId}`);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log(`Build: ${data.message}`);

      if (data.type === 'success') {
        console.log(`Deployed to: ${data.deployUrl}`);
        eventSource.close();
      }
    };

    // 3. Poll status (alternative to streaming)
    const pollStatus = async () => {
      const statusResponse = await fetch(`/api/build-status/${jobId}`);
      const status = await statusResponse.json();

      if (status.status === 'SUCCESS') {
        console.log(`Build complete: ${status.deployUrl}`);
      } else if (status.status === 'FAILED') {
        console.error(`Build failed: ${status.error}`);
      } else {
        setTimeout(pollStatus, 2000); // Poll every 2 seconds
      }
    };
  }
}
```

## Changelog

### v2.1 Features (Latest)

- 🆕 **Real-time Build Monitoring**: `/api/build-status/$jobId` and `/api/build-stream/$jobId` endpoints
- 🆕 **GitHub Archive Requirement**: GitHub token now REQUIRED for framework projects
- 🆕 **Enhanced Error Handling**: Detailed error responses for missing tokens
- 🆕 **Improved Reliability**: Removed unreliable Netlify archive fallback
- ✅ **Build Job Management**: Immediate job ID return for async monitoring
- ✅ **Server-Sent Events**: Real-time build log streaming
- ✅ **Better Framework Detection**: Enhanced React/Vue/Angular project handling

### v2.0 Features

- ✅ Cloud build service integration
- ✅ GitHub repository creation
- ✅ Improved React/framework support
- ✅ Better error handling
- ✅ Clean deployment URLs
- ✅ Automatic framework detection
- ✅ 15-minute build timeout
- ✅ Proper Vite configuration for React projects

