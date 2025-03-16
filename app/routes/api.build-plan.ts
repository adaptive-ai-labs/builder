import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { generateText } from 'ai';
import type { ProviderInfo } from '~/types/model';
import type { ModelInfo } from '~/lib/modules/llm/types';
import { createScopedLogger } from '~/utils/logger';
import { getApiKeysFromCookie, getProviderSettingsFromCookie } from '~/lib/api/cookies';
import type { ChecklistItem } from '~/types/checklist';
import { PROVIDER_LIST } from '~/utils/constants';
import { LLMManager } from '~/lib/modules/llm/manager';
import { MAX_TOKENS } from '~/lib/.server/llm/constants';

const logger = createScopedLogger('api.build-plan');

export async function action(args: ActionFunctionArgs) {
  return buildPlanAction(args);
}

async function buildPlanAction({ context, request }: ActionFunctionArgs) {
  const { prompt, model, provider } = await request.json<{
    prompt: string;
    model: string;
    provider: ProviderInfo;
  }>();

  const { name: providerName } = provider;

  // Validate 'model' and 'provider' fields
  if (!model || typeof model !== 'string') {
    throw new Response('Invalid or missing model', {
      status: 400,
      statusText: 'Bad Request',
    });
  }

  if (!providerName || typeof providerName !== 'string') {
    throw new Response('Invalid or missing provider', {
      status: 400,
      statusText: 'Bad Request',
    });
  }

  // Get API keys and provider settings from cookies
  const cookieHeader = request.headers.get('Cookie');
  const apiKeys = getApiKeysFromCookie(cookieHeader);
  const providerSettings = getProviderSettingsFromCookie(cookieHeader);

  // System prompt for build plan generation
  const systemPrompt = `You are a build plan generator for a coding assistant.
Your task is to create a detailed and comprehensive checklist of tasks required to complete the user's project. Think carefully about each step needed for successful implementation.

You MUST output ONLY a valid JSON array without any explanation, preamble, or additional text. The JSON array should follow EXACTLY this structure:

[
  {
    "label": "Task name (max 50 chars)",
    "description": "Detailed explanation of what needs to be done",
    "category": "frontend",
    "status": "pending"
  },
  {
    "label": "Another task name",
    "description": "More details about implementation",
    "category": "backend",
    "status": "pending"
  },
  {
    "label": "Additional task",
    "description": "Further implementation details",
    "category": "other",
    "status": "pending"
  }
]

IMPORTANT RULES:
1. CREATE AT LEAST 10-15 specific, actionable tasks.
2. Each "category" field MUST BE EXACTLY one of: "frontend", "backend", or "other" (all lowercase)
3. Each "status" field MUST BE EXACTLY "pending" (all lowercase)
4. Include ALL essential aspects of development:
   - Project setup and configuration
   - UI components and layout
   - API endpoints and services
   - Data management
   - Core functionality
   - User experience elements
   - Testing and QA
   - Deployment and documentation
5. DO NOT include placeholder tasks - every task must be specific to the user's project
6. DO NOT wrap your response in code blocks or add any explanation - ONLY output the raw JSON array
7. ENSURE all field names are in lowercase (label, description, category, status)
8. ENSURE all JSON is properly formatted with double quotes around property names and values

Failure to follow these instructions exactly will result in processing errors.

IMPORTANT: ONLY respond with valid JSON. DO NOT include any explanation text before or after the JSON array.`;

  try {
    // Get models list
    const llmManager = LLMManager.getInstance(context.cloudflare?.env as any);
    const models = await llmManager.updateModelList({
      apiKeys,
      providerSettings,
      serverEnv: context.cloudflare?.env as any,
    });
    const modelDetails = models.find((m: ModelInfo) => m.name === model);

    if (!modelDetails) {
      logger.error('Model not found', { model, provider: providerName });
      return new Response(
        JSON.stringify({
          success: false,
          fallback: true,
          message: 'Model not found',
        }),
        {
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    const dynamicMaxTokens = modelDetails.maxTokenAllowed || MAX_TOKENS;
    const providerInfo = PROVIDER_LIST.find((p) => p.name === providerName);

    if (!providerInfo) {
      logger.error('Provider not found', { provider: providerName });
      return new Response(
        JSON.stringify({
          success: false,
          fallback: true,
          message: 'Provider not found',
        }),
        {
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    logger.debug('Generating build plan', { model, provider: providerName });

    const { text } = await generateText({
      model: providerInfo.getModelInstance({
        model: modelDetails.name,
        serverEnv: context.cloudflare?.env as any,
        apiKeys,
        providerSettings,
      }),
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: dynamicMaxTokens,
    });

    // Parse the JSON response
    try {
      logger.debug('LLM response received', { textLength: text.length, textPreview: text.substring(0, 100) + '...' });

      // Clean up the text to ensure it's valid JSON
      let cleanedText = text.trim();

      // Log the raw response for debugging
      logger.debug('Raw LLM response', { rawResponse: cleanedText.substring(0, 200) + '...' });

      // If the response starts with ``` or ends with ```, remove the code block markers
      if (cleanedText.startsWith('```json')) {
        cleanedText = cleanedText.slice(7).trim();
      } else if (cleanedText.startsWith('```')) {
        cleanedText = cleanedText.slice(3).trim();
      }

      if (cleanedText.endsWith('```')) {
        cleanedText = cleanedText.slice(0, -3).trim();
      }

      // Remove any leading/trailing non-JSON characters (like text explanations)
      cleanedText = cleanedText.replace(/^[^\[]*/, '').replace(/[^\]]*$/, '');

      /*
       * Advanced handling to recover malformed JSON
       * Look for array-like structure even if wrapped in other text
       */
      const arrayMatch = cleanedText.match(/\[\s*\{.*\}\s*\]/s);

      if (arrayMatch && arrayMatch[0]) {
        cleanedText = arrayMatch[0];
      }

      // Remove any non-JSON text before the array start or after the array end
      const firstBracket = cleanedText.indexOf('[');
      const lastBracket = cleanedText.lastIndexOf(']');

      if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
        cleanedText = cleanedText.substring(firstBracket, lastBracket + 1);
      }

      // Fix common JSON issues (unquoted properties, single quotes)
      cleanedText = cleanedText
        // Replace single quotes with double quotes, but only around valid JSON property names/values
        .replace(/([{,]\s*)'([\w-]+)'\s*:/g, '$1"$2":')
        .replace(/:\s*'([^']*)'\s*([,}])/g, ':"$1"$2')
        // Fix unquoted property names (common in some LLM outputs)
        .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":')
        // Ensure status is always "pending" as required
        .replace(/"status"\s*:\s*"[^"]*"/g, '"status":"pending"');

      logger.debug('Cleaned JSON', { cleanedText: cleanedText.substring(0, 200) + '...' });

      // Attempt to parse the JSON response
      let parsedTasks;

      try {
        logger.debug('Attempting to parse JSON', { jsonText: cleanedText.substring(0, 150) + '...' });
        parsedTasks = JSON.parse(cleanedText) as ChecklistItem[];
        logger.debug('Successfully parsed JSON', {
          taskCount: Array.isArray(parsedTasks) ? parsedTasks.length : 'not an array',
        });
      } catch (parseError) {
        logger.error('JSON parse error', {
          error: (parseError as Error).message,
          textStart: cleanedText.substring(0, 50),
        });

        // If parsing fails, try to recover by wrapping in array if it looks like a single object
        if (cleanedText.trim().startsWith('{') && cleanedText.trim().endsWith('}')) {
          try {
            logger.debug('Attempting to parse as single object');

            const singleObject = JSON.parse(cleanedText.trim());
            parsedTasks = [singleObject];
            logger.debug('Successfully parsed as single object');
          } catch (secondError) {
            logger.error('Second parse attempt failed', { error: (secondError as Error).message });
            throw parseError; // Re-throw if recovery attempt fails
          }
        } else {
          throw parseError;
        }
      }

      // Check if parsedTasks is actually an array
      if (!Array.isArray(parsedTasks)) {
        // Use type assertion to handle potential properties
        const tasksObj = parsedTasks as Record<string, unknown>;

        // If it's not an array but has a 'tasks' or 'items' property that is an array, use that
        if (tasksObj.tasks && Array.isArray(tasksObj.tasks)) {
          parsedTasks = tasksObj.tasks as ChecklistItem[];
        } else if (tasksObj.items && Array.isArray(tasksObj.items)) {
          parsedTasks = tasksObj.items as ChecklistItem[];
        } else {
          // If it's an object but not an array and doesn't have tasks/items, convert to array with one item
          parsedTasks = [parsedTasks] as ChecklistItem[];
        }
      }

      // Log the parsed tasks for debugging
      if (Array.isArray(parsedTasks)) {
        logger.debug('Parsed tasks array', {
          length: parsedTasks.length,
          firstItem: parsedTasks.length > 0 ? JSON.stringify(parsedTasks[0]) : 'none',
        });
      } else {
        logger.debug('Parsed tasks not an array', { type: typeof parsedTasks });
      }

      // Generate default tasks based on the prompt to use as fallback
      const defaultTasks = [
        {
          label: 'Setup project structure',
          description: 'Create the basic directory structure and initialize the project.',
          category: 'other',
          status: 'pending',
        },
        {
          label: 'Create UI layout',
          description: 'Design and implement the user interface layout.',
          category: 'frontend',
          status: 'pending',
        },
        {
          label: 'Implement core functionality',
          description: 'Build the core application functionality.',
          category: 'backend',
          status: 'pending',
        },
        {
          label: 'Add styling',
          description: 'Apply CSS styling to improve the visual appearance.',
          category: 'frontend',
          status: 'pending',
        },
        {
          label: 'Test and debug',
          description: 'Test the application and fix any bugs.',
          category: 'other',
          status: 'pending',
        },
      ];

      // Validate the structure of the response
      const validTasks = parsedTasks
        .filter(
          (task: any) =>
            task &&
            typeof task === 'object' &&
            task.label &&
            typeof task.label === 'string' &&
            task.description &&
            typeof task.description === 'string' &&
            (!task.category || ['frontend', 'backend', 'other'].includes(task.category as string)),
        )
        .map((task: any) => ({
          // Normalize and truncate labels/descriptions
          label:
            typeof task.label === 'string'
              ? task.label.length > 100
                ? task.label.substring(0, 100) + '...'
                : task.label
              : 'Untitled Task',
          description: typeof task.description === 'string' ? task.description : 'No description provided',

          // Default to 'other' if category is missing or invalid
          category: ['frontend', 'backend', 'other'].includes(task.category as string)
            ? (task.category as string)
            : 'other',
          status: 'pending', // Ensure status is set to pending
        })) as ChecklistItem[];

      logger.debug('Validated tasks', {
        validTasksCount: validTasks.length,
        invalidTasksCount: parsedTasks.length - validTasks.length,
        firstTask: validTasks.length > 0 ? JSON.stringify(validTasks[0]) : 'none',
      });

      // Minimum threshold for valid tasks - if fewer than 5 valid tasks, use default tasks
      if (validTasks.length < 5) {
        // Use default tasks if too few valid tasks were generated
        logger.warn(`Insufficient valid tasks in LLM response (${validTasks.length}), using default tasks`);

        const response = {
          success: true,
          tasks: defaultTasks,
          fallback: true,
          message: 'Using default tasks as fallback - insufficient valid tasks generated',
        };

        logger.debug('Returning fallback response', { taskCount: defaultTasks.length });

        return new Response(JSON.stringify(response), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Log the valid final tasks
      logger.debug('Returning valid tasks', {
        taskCount: validTasks.length,
        sample: validTasks.slice(0, 2).map((t) => ({ label: t.label, category: t.category })),
      });

      const response = {
        success: true,
        tasks: validTasks,
      };

      return new Response(JSON.stringify(response), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.error('Error parsing LLM response', { error });

      // Generate default tasks as fallback
      const defaultTasks = [
        {
          label: 'Setup project structure',
          description: 'Create the basic directory structure and initialize the project.',
          category: 'other',
          status: 'pending',
        },
        {
          label: 'Create UI layout',
          description: 'Design and implement the user interface layout.',
          category: 'frontend',
          status: 'pending',
        },
        {
          label: 'Implement core functionality',
          description: 'Build the core application functionality.',
          category: 'backend',
          status: 'pending',
        },
        {
          label: 'Add styling',
          description: 'Apply CSS styling to improve the visual appearance.',
          category: 'frontend',
          status: 'pending',
        },
        {
          label: 'Test and debug',
          description: 'Test the application and fix any bugs.',
          category: 'other',
          status: 'pending',
        },
      ];

      return new Response(
        JSON.stringify({
          success: true,
          tasks: defaultTasks,
          fallback: true,
          message: 'Using default tasks due to parsing error',
        }),
        {
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
  } catch (error) {
    logger.error('Error generating build plan', { error });
    return new Response(
      JSON.stringify({
        success: false,
        fallback: true,
        message: 'Error generating build plan',
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}
