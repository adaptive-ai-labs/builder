# Bolt.diy API Documentation

## Overview

The Bolt.diy API allows you to generate and deploy web applications using natural language prompts. The API is powered by various LLM providers and includes automatic framework detection, cloud building, and deployment to Netlify.

**Base URL:** `https://builder-3v5.pages.dev`

## Endpoints

### POST /api/generate-external-v2

Generate and optionally deploy a web application from a natural language prompt.

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
  "githubToken": "string (optional, recommended for React/framework projects)"
}
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | ✅ | Natural language description of the application to generate |
| `model` | string | ❌ | LLM model to use (default: "openai/gpt-4.1") |
| `provider` | object | ❌ | LLM provider configuration (default: OpenRouter) |
| `apiKey` | string | ❌ | API key for the LLM provider |
| `template` | string | ❌ | Specific template to use (e.g., "react", "nextjs", "vue") |
| `autoSelectTemplate` | boolean | ❌ | Whether to auto-select the best template (default: true) |
| `deploy` | boolean | ❌ | Whether to deploy the generated application (default: false) |
| `netlifyToken` | string | ✅* | Netlify API token (*required if deploy=true) |
| `siteId` | string | ❌ | Existing Netlify site ID to deploy to |
| `chatId` | string | ❌ | Custom chat ID for site naming |
| `githubToken` | string | ❌ | GitHub personal access token (recommended for framework projects) |

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

When `deploy=true`, returns JSON with deployment information:

```json
{
  "success": true,
  "generatedContent": "string",
  "files": ["array", "of", "generated", "file", "paths"],
  "template": "string",
  "framework": "string",
  "deployment": {
    "success": true,
    "deploy": {
      "url": "https://your-app.netlify.app",
      "state": "ready"
    }
  },
  "buildMethod": "cloud|direct"
}
```

## Framework Detection & Building

The API automatically detects the framework type based on generated files and dependencies:

- **React/Vite Projects**: Uses cloud build service for proper JSX transpilation
- **Next.js**: Optimized build process with SSR support
- **Static Sites**: Direct deployment without building
- **Node.js Projects**: Cloud build with dependency installation

### Cloud Build Service

For framework projects requiring transpilation (React, Vue, etc.):

1. Creates a GitHub repository with your code
2. Submits to cloud build service for compilation
3. Deploys built assets to Netlify
4. Returns clean deployment URL

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

### 2. Generate and Deploy a React App

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

### 3. Deploy to Existing Site

```bash
curl -X POST https://builder-3v5.pages.dev/api/generate-external-v2 \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Update my app with a dark mode toggle",
    "deploy": true,
    "netlifyToken": "your-netlify-token",
    "siteId": "existing-site-id",
    "apiKey": "your-openrouter-api-key"
  }'
```

### 4. Use Specific Model and Provider

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

### 500 Internal Server Error

```json
{
  "error": "Failed to process request: [error message]"
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

### 3. GitHub Token (Recommended for Framework Projects)
- Go to GitHub → Settings → Developer settings → Personal access tokens
- Generate token with `repo` scope
- Enables proper source code management and building

## Best Practices

1. **Use GitHub Token**: Always provide a GitHub token for React/framework projects to ensure proper building and deployment.

2. **Specific Prompts**: Be specific in your prompts. Instead of "make a website", try "create a React todo app with local storage and dark mode".

3. **Template Selection**: Use appropriate templates for better results:
   - `react` for interactive UIs
   - `nextjs` for full-stack applications
   - `astro` for content-focused sites

4. **Error Handling**: Always check the response status and handle errors appropriately.

5. **Rate Limiting**: Be mindful of API rate limits from LLM providers.

## Supported File Types

The API can generate and deploy:

- **Frontend**: React, Vue, Svelte, Angular applications
- **Static Sites**: HTML, CSS, JavaScript
- **Full-Stack**: Next.js, Remix applications
- **Configuration**: package.json, vite.config.js, etc.
- **Styles**: CSS, SCSS, Tailwind CSS
- **Assets**: Images, fonts (via CDN links)

## Build Process

### Cloud Build (Recommended)
1. Code is pushed to GitHub repository
2. Cloud build service downloads and builds the project
3. Built assets are deployed to Netlify
4. Returns clean deployment URL

### Direct Deployment (Fallback)
1. Source files are uploaded directly to Netlify
2. No transpilation or building
3. Suitable for static HTML/CSS/JS files

## Limitations

- **File Size**: Large file uploads may timeout
- **Build Time**: Cloud builds have a 15-minute timeout
- **Dependencies**: Some complex dependencies may not install correctly
- **Private Repositories**: GitHub repositories are created as public for archive access

## Support

For issues or questions:
- Check the response error messages for details
- Ensure all required tokens are valid
- Verify prompt clarity and specificity
- For React apps, always include a GitHub token

## Changelog

### v2 Features
- ✅ Cloud build service integration
- ✅ GitHub repository creation
- ✅ Improved React/framework support
- ✅ Better error handling
- ✅ Clean deployment URLs
- ✅ Automatic framework detection
- ✅ 15-minute build timeout
- ✅ Proper Vite configuration for React projects