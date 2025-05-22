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
    let modelName: string = 'anthropic/claude-3.7-sonnet:thinking'; // Default to GPT-4.1
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
          role: 'system',
          content:
            "When generating web applications, you MUST use Tailwind CSS for styling and you MUST use Anime.js for animations. These libraries are already included via CDN in the generated HTML file.\n\n==== CRITICAL STYLING REQUIREMENTS ====\n\nFor Tailwind CSS:\n- You MUST ONLY use Tailwind utility classes for ALL styling\n- You are STRICTLY FORBIDDEN from using inline styles (style=\"...\") anywhere in your HTML\n- You are STRICTLY FORBIDDEN from using custom CSS in <style> tags\n- NEVER write CSS properties directly - always use Tailwind classes\n- The Tailwind CDN is already included: <script src=\"https://cdn.tailwindcss.com\"></script>\n- Reference the official Tailwind CSS documentation for available classes\n\nEXAMPLES OF WHAT YOU MUST NEVER DO:\n❌ WRONG: <div style=\"color: red; margin: 10px;\">Text</div>\n❌ WRONG: <div style=\"background-color: #3b82f6;\">Content</div>\n❌ WRONG: <button style=\"padding: 8px 16px; border-radius: 4px;\">Click me</button>\n❌ WRONG: <style>.custom-class { color: blue; }</style>\n\nEXAMPLES OF WHAT YOU MUST DO:\n✅ CORRECT: <div class=\"text-red-500 m-2.5\">Text</div>\n✅ CORRECT: <div class=\"bg-blue-500\">Content</div>\n✅ CORRECT: <button class=\"px-4 py-2 rounded\">Click me</button>\n\nFor Anime.js:\n- You MUST use Anime.js for ALL animations and transitions\n- Adding animations is REQUIRED for all interactive elements and UI components\n- The Anime.js CDN is already included: <script src=\"https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.1/anime.min.js\"></script>\n- Access the Anime.js API via the global 'anime' function\n\n==== YOU MUST INCLUDE THE FOLLOWING ANIMATIONS IN YOUR CODE ====\n\n1. Page Load Animations:\n```javascript\ndocument.addEventListener('DOMContentLoaded', () => {\n  // Find all elements with staggered entrance animations\n  const animatedElements = document.querySelectorAll('.animate-in');\n  \n  // Create staggered animation for each element\n  anime({\n    targets: '.animate-in',\n    opacity: [0, 1],\n    translateY: [50, 0],\n    scale: [0.9, 1],\n    duration: 700,\n    delay: anime.stagger(150), // Staggered delay\n    easing: 'cubicBezier(0.25, 0.1, 0.25, 1)' // Custom easing\n  });\n  \n  // Animate the hero section separately with a different animation\n  anime({\n    targets: '.hero',\n    opacity: [0, 1],\n    scale: [0.95, 1],\n    duration: 1200,\n    easing: 'easeOutExpo'\n  });\n});\n```\n\n2. Button Hover and Click Animations:\n```javascript\nfunction setupButtonAnimations() {\n  // Find all interactive buttons\n  const buttons = document.querySelectorAll('.btn, button, .interactive');\n  \n  buttons.forEach(button => {\n    // Store initial box-shadow for reset\n    const initialShadow = window.getComputedStyle(button).boxShadow;\n    \n    // Hover animation\n    button.addEventListener('mouseenter', () => {\n      anime({\n        targets: button,\n        scale: 1.05,\n        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',\n        duration: 200,\n        easing: 'easeOutQuad'\n      });\n    });\n    \n    button.addEventListener('mouseleave', () => {\n      anime({\n        targets: button,\n        scale: 1,\n        boxShadow: initialShadow,\n        duration: 200,\n        easing: 'easeOutQuad'\n      });\n    });\n    \n    // Click animation\n    button.addEventListener('mousedown', () => {\n      anime({\n        targets: button,\n        scale: 0.95,\n        duration: 100,\n        easing: 'easeInQuad'\n      });\n    });\n    \n    button.addEventListener('mouseup', () => {\n      anime({\n        targets: button,\n        scale: 1.05,\n        duration: 100,\n        easing: 'easeOutQuad'\n      });\n    });\n  });\n}\n\n// Call this function when the page loads\ndocument.addEventListener('DOMContentLoaded', setupButtonAnimations);\n```\n\n3. Scroll-triggered Animations:\n```javascript\ndocument.addEventListener('DOMContentLoaded', () => {\n  // Set up intersection observer for scroll animations\n  const observer = new IntersectionObserver(\n    (entries) => {\n      entries.forEach(entry => {\n        // When element enters viewport\n        if (entry.isIntersecting) {\n          const element = entry.target;\n          \n          // Different animations based on data attributes\n          const animationType = element.dataset.animation || 'fade';\n          \n          if (animationType === 'fade') {\n            anime({\n              targets: element,\n              opacity: [0, 1],\n              translateY: [50, 0],\n              duration: 800,\n              easing: 'easeOutQuad'\n            });\n          } else if (animationType === 'slide') {\n            anime({\n              targets: element,\n              opacity: [0, 1],\n              translateX: [-100, 0],\n              duration: 800,\n              easing: 'easeOutQuad'\n            });\n          } else if (animationType === 'zoom') {\n            anime({\n              targets: element,\n              opacity: [0, 1],\n              scale: [0.5, 1],\n              duration: 800,\n              easing: 'cubicBezier(0.175, 0.885, 0.32, 1.275)' // Custom bounce effect\n            });\n          }\n          \n          // Unobserve after animation\n          observer.unobserve(element);\n        }\n      });\n    },\n    { threshold: 0.1 } // Trigger when 10% of the element is visible\n  );\n  \n  // Observe all elements with scroll-animate class\n  document.querySelectorAll('.scroll-animate').forEach(element => {\n    observer.observe(element);\n  });\n});\n```\n\n4. Menu/Dropdown Animations:\n```javascript\nfunction setupDropdownAnimations() {\n  const dropdownToggles = document.querySelectorAll('.dropdown-toggle');\n  \n  dropdownToggles.forEach(toggle => {\n    toggle.addEventListener('click', () => {\n      const dropdownMenu = toggle.nextElementSibling;\n      \n      if (dropdownMenu && dropdownMenu.classList.contains('dropdown-menu')) {\n        const isExpanded = dropdownMenu.classList.contains('expanded');\n        \n        if (!isExpanded) {\n          // Show animation\n          dropdownMenu.style.display = 'block';\n          dropdownMenu.style.opacity = '0';\n          dropdownMenu.style.transform = 'translateY(-10px)';\n          \n          anime({\n            targets: dropdownMenu,\n            opacity: [0, 1],\n            translateY: [-10, 0],\n            duration: 300,\n            easing: 'easeOutQuad',\n            begin: function() {\n              dropdownMenu.classList.add('expanded');\n            }\n          });\n        } else {\n          // Hide animation\n          anime({\n            targets: dropdownMenu,\n            opacity: [1, 0],\n            translateY: [0, -10],\n            duration: 200,\n            easing: 'easeInQuad',\n            complete: function() {\n              dropdownMenu.style.display = 'none';\n              dropdownMenu.classList.remove('expanded');\n            }\n          });\n        }\n      }\n    });\n  });\n}\n\ndocument.addEventListener('DOMContentLoaded', setupDropdownAnimations);\n```\n\n5. Card/Element Hover Effects:\n```javascript\ndocument.addEventListener('DOMContentLoaded', () => {\n  const cards = document.querySelectorAll('.card, .hover-card');\n  \n  cards.forEach(card => {\n    // Store initial styles for reset\n    const initialShadow = window.getComputedStyle(card).boxShadow;\n    \n    // Add a subtle lift and shadow effect on hover\n    card.addEventListener('mouseenter', () => {\n      anime({\n        targets: card,\n        translateY: -5,\n        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',\n        duration: 300,\n        easing: 'easeOutQuad'\n      });\n    });\n    \n    card.addEventListener('mouseleave', () => {\n      anime({\n        targets: card,\n        translateY: 0,\n        boxShadow: initialShadow,\n        duration: 300,\n        easing: 'easeOutQuad'\n      });\n    });\n    \n    // Optional: Add a tilt effect based on mouse position\n    card.addEventListener('mousemove', (e) => {\n      const rect = card.getBoundingClientRect();\n      const x = e.clientX - rect.left; // x position within the element\n      const y = e.clientY - rect.top;  // y position within the element\n      \n      // Calculate tilt values (maximum 5 degrees tilt)\n      const tiltX = ((y / rect.height) - 0.5) * 10;\n      const tiltY = (-(x / rect.width) + 0.5) * 10;\n      \n      anime({\n        targets: card,\n        rotateX: tiltX,\n        rotateY: tiltY,\n        duration: 200,\n        easing: 'linear'\n      });\n    });\n  });\n});\n```\n\n6. Timeline Animations (Using Anime.js Timeline):\n```javascript\nfunction createSequentialAnimation() {\n  // Create a timeline\n  const timeline = anime.timeline({\n    easing: 'easeOutExpo',\n    duration: 750\n  });\n  \n  // Add animations to the timeline sequentially\n  timeline\n    .add({\n      targets: '.sequence-element-1',\n      translateX: ['-100%', 0],\n      opacity: [0, 1]\n    })\n    .add({\n      targets: '.sequence-element-2',\n      translateY: [50, 0],\n      opacity: [0, 1]\n    }, '-=400') // Starts 400ms before the previous animation ends\n    .add({\n      targets: '.sequence-element-3',\n      scale: [0.8, 1],\n      opacity: [0, 1]\n    }, '-=200'); // Starts 200ms before the previous animation ends\n}\n\ndocument.addEventListener('DOMContentLoaded', createSequentialAnimation);\n```\n\n7. Tab Switching Animations:\n```javascript\nfunction setupTabAnimations() {\n  const tabButtons = document.querySelectorAll('[data-tab]');\n  const tabPanes = document.querySelectorAll('.tab-pane');\n  \n  tabButtons.forEach(button => {\n    button.addEventListener('click', () => {\n      const targetId = button.getAttribute('data-tab');\n      \n      // Animate out current tab\n      tabPanes.forEach(pane => {\n        if (pane.classList.contains('active')) {\n          anime({\n            targets: pane,\n            opacity: [1, 0],\n            translateX: [0, -20],\n            duration: 300,\n            easing: 'easeInQuad',\n            complete: function() {\n              pane.classList.remove('active');\n              pane.style.display = 'none';\n            }\n          });\n        }\n      });\n      \n      // Animate in new tab\n      const targetPane = document.getElementById(targetId);\n      if (targetPane) {\n        targetPane.style.display = 'block';\n        targetPane.classList.add('active');\n        \n        anime({\n          targets: targetPane,\n          opacity: [0, 1],\n          translateX: [20, 0],\n          duration: 400,\n          easing: 'easeOutQuad'\n        });\n      }\n      \n      // Update active tab button\n      tabButtons.forEach(btn => {\n        if (btn === button) {\n          btn.classList.add('active');\n        } else {\n          btn.classList.remove('active');\n        }\n      });\n    });\n  });\n}\n\ndocument.addEventListener('DOMContentLoaded', setupTabAnimations);\n```\n\n8. SVG Path Animation with Anime.js:\n```javascript\nfunction animateSVGPaths() {\n  // Animate SVG path drawing\n  anime({\n    targets: '.svg-path',\n    strokeDashoffset: [anime.setDashoffset, 0],\n    easing: 'easeInOutSine',\n    duration: 1500,\n    delay: function(el, i) { return i * 250 },\n    direction: 'alternate',\n    loop: true\n  });\n  \n  // Animate SVG shapes\n  anime({\n    targets: '.svg-shape',\n    translateX: function() { return anime.random(-10, 10); },\n    translateY: function() { return anime.random(-10, 10); },\n    scale: function() { return anime.random(0.95, 1.05); },\n    rotate: function() { return anime.random(-5, 5); },\n    duration: 1200,\n    easing: 'easeInOutSine',\n    delay: anime.stagger(100),\n    loop: true,\n    direction: 'alternate'\n  });\n}\n\ndocument.addEventListener('DOMContentLoaded', animateSVGPaths);\n```\n\nREMEMBER: You MUST implement at least 3 of these animation types in your generated code. Add the appropriate CSS classes (.animate-in, .btn, .card, .sequence-element-1, etc.) to your HTML elements to work with these animations. For SVG animations, add the .svg-path and .svg-shape classes to your SVG elements.\n\n==== FINAL CRITICAL REMINDERS ====\n\n1. STYLING: You MUST ONLY use Tailwind CSS utility classes - NEVER use inline styles (style=\"...\") or custom CSS\n2. ANIMATIONS: You MUST include Anime.js animations for a polished user experience\n3. NO EXCEPTIONS: Every single style MUST be a Tailwind class - no inline styles anywhere in your HTML\n\nIF YOU USE ANY INLINE STYLES, YOUR CODE WILL BE REJECTED. ONLY TAILWIND CLASSES ARE ALLOWED.",
        },
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
  <!-- Tailwind CSS via CDN -->
  <script src="https://cdn.tailwindcss.com"></script>
  <!-- Anime.js via CDN -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.1/anime.min.js"></script>
  <script>
    // Configure Tailwind
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            primary: '#3063e9'
          }
        }
      }
    }
  </script>
</head>
<body class="bg-gray-50 font-sans">
  <div class="max-w-4xl mx-auto p-6">
    <header class="mb-8">
      <h1 class="text-3xl font-bold text-gray-800 mb-4">Generated Code</h1>
      <p class="text-gray-600">There was an issue with template loading. Here's the generated content:</p>
    </header>
    <div id="content" class="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
      <pre class="bg-gray-100 p-4 rounded-md overflow-x-auto text-sm text-gray-800">${result.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
    </div>
    <footer class="mt-8 text-center text-gray-500 text-sm">
      <p>Generated with AI assistance</p>
    </footer>
  </div>

  <script>
    // Add a simple entrance animation using Anime.js
    document.addEventListener('DOMContentLoaded', () => {
      const content = document.getElementById('content');
      anime({
        targets: content,
        opacity: [0, 1],
        translateY: [20, 0],
        duration: 500,
        easing: 'easeOutQuad'
      });
    });
  </script>
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
  <!-- Tailwind CSS via CDN -->
  <script src="https://cdn.tailwindcss.com"></script>
  <!-- Anime.js via CDN -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.1/anime.min.js"></script>
  <!-- Highlight.js for code syntax highlighting -->
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
  <script>
    // Configure Tailwind
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            primary: '#3063e9',
            secondary: '#0e1437',
            accent: '#24cec1',
            background: '#f6f8fa',
            codebg: '#282c34'
          },
          borderRadius: {
            custom: '12px'
          }
        }
      }
    }
  </script>
  <style type="text/tailwindcss">
    @layer components {
      .nav-tab {
        @apply px-4 py-2 mr-2 rounded-t-lg font-medium transition-colors duration-200;
      }
      .nav-tab-active {
        @apply bg-primary text-white;
      }
      .nav-tab-inactive {
        @apply text-secondary hover:bg-gray-100;
      }
      .code-container {
        @apply relative rounded-xl overflow-hidden mt-2;
      }
      .filename-badge {
        @apply absolute top-0 right-0 bg-black/30 text-white text-xs py-1 px-2 rounded-bl-lg;
      }
    }
  </style>
</head>
<body class="bg-background text-secondary font-sans pt-5 pb-16">
  <div class="container mx-auto px-4 max-w-6xl">
    <div class="mb-8 pb-4 border-b border-gray-200">
      <h1 class="text-4xl font-bold mb-2">Generated Code</h1>
      <p class="text-lg text-gray-600">This page displays the code generated based on your prompt.</p>
    </div>

    <div class="mb-8">
      <div class="border-b border-gray-200">
        <nav class="flex -mb-px" role="tablist">
          <button class="nav-tab nav-tab-active" id="files-tab" data-tab="files" role="tab" aria-controls="files" aria-selected="true">Files</button>
          <button class="nav-tab nav-tab-inactive" id="response-tab" data-tab="response" role="tab" aria-controls="response" aria-selected="false">Full Response</button>
        </nav>
      </div>

      <div class="tab-content mt-6">
        <div id="files" class="tab-pane block" role="tabpanel" aria-labelledby="files-tab">
`;

            // Add each code file with syntax highlighting
            for (const { filename, content, language } of codeFiles) {
              showcaseHTML += `
        <div class="mb-8">
          <h2 class="text-xl font-semibold mb-2">${filename}</h2>
          <div class="code-container bg-codebg">
            <span class="filename-badge">${filename}</span>
            <pre><code class="language-${language}">${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>
          </div>
        </div>
`;
            }

            showcaseHTML += `
        </div>
        <div id="response" class="tab-pane hidden" role="tabpanel" aria-labelledby="response-tab">
          <div class="mb-8">
            <pre class="overflow-auto rounded-xl bg-codebg p-5 text-white whitespace-pre-wrap max-h-[70vh]">${result.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
          </div>
        </div>
      </div>
    </div>

    <div class="text-center text-gray-500 text-sm mt-12 pt-4 border-t border-gray-200">
      <p>Generated with AI assistance</p>
    </div>
  </div>

  <script>
    // Syntax highlighting
    document.addEventListener('DOMContentLoaded', () => {
      document.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block);
      });
    });

    // Tab switching with Framer Motion animation
    const tabButtons = document.querySelectorAll('[data-tab]');
    const tabPanes = document.querySelectorAll('.tab-pane');
    
    tabButtons.forEach(button => {
      button.addEventListener('click', () => {
        const tabId = button.getAttribute('data-tab');
        
        // Update active tab
        tabButtons.forEach(btn => {
          if (btn.getAttribute('data-tab') === tabId) {
            btn.classList.remove('nav-tab-inactive');
            btn.classList.add('nav-tab-active');
            btn.setAttribute('aria-selected', 'true');
          } else {
            btn.classList.remove('nav-tab-active');
            btn.classList.add('nav-tab-inactive');
            btn.setAttribute('aria-selected', 'false');
          }
        });
        
        // Show active tab content
        tabPanes.forEach(pane => {
          if (pane.id === tabId) {
            pane.classList.remove('hidden');
            pane.classList.add('block');
            
            // Add a simple fade-in animation using Anime.js
            anime({
              targets: pane,
              opacity: [0, 1],
              translateY: [10, 0],
              duration: 300,
              easing: 'easeOutQuad'
            });
          } else {
            pane.classList.add('hidden');
            pane.classList.remove('block');
          }
        });
      });
    });
  </script>
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
