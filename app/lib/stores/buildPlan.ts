import { atom } from 'nanostores';
import type { BuildPlan, ChecklistItem, ChecklistItemStatus } from '~/types/checklist';
import { createEmptyBuildPlan, generateId, updateChecklistItemStatus } from '~/types/checklist';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('buildPlanStore');

// Store for the current build plan
export const currentBuildPlan = atom<BuildPlan | null>(null);

// Store for showing/hiding the build plan
export const showBuildPlan = atom<boolean>(true);

// Create a new build plan
export function createBuildPlan(promptId?: string): BuildPlan {
  logger.debug('Creating new build plan', { promptId });

  const newPlan = createEmptyBuildPlan(promptId);
  currentBuildPlan.set(newPlan);

  return newPlan;
}

// Clear the current build plan
export function clearBuildPlan(): void {
  logger.debug('Clearing build plan');
  currentBuildPlan.set(null);
}

// Add a new item to the build plan
export function addBuildPlanItem(item: Omit<ChecklistItem, 'id'>): string | null {
  const plan = currentBuildPlan.get();

  if (!plan) {
    logger.warn('Attempted to add item to non-existent build plan');
    return null;
  }

  const newItem: ChecklistItem = {
    id: generateId(),
    ...item,
    timestamp: new Date(),
  };

  logger.debug('Adding item to build plan', { itemId: newItem.id, label: newItem.label });

  const updatedPlan: BuildPlan = {
    ...plan,
    items: [...plan.items, newItem],
    updatedAt: new Date(),
  };

  currentBuildPlan.set(updatedPlan);

  return newItem.id;
}

// Update an item's status
export function updateItemStatus(itemId: string, status: ChecklistItemStatus): boolean {
  const plan = currentBuildPlan.get();

  if (!plan) {
    logger.warn('Attempted to update item in non-existent build plan');
    return false;
  }

  logger.debug('Updating item status', { itemId, status });

  const updatedItems = updateChecklistItemStatus(plan.items, itemId, status);

  // If this is an "in-progress" update, set it as the current step
  const updatedPlan: BuildPlan = {
    ...plan,
    items: updatedItems,
    currentStep: status === 'in-progress' ? itemId : plan.currentStep,
    updatedAt: new Date(),
  };

  currentBuildPlan.set(updatedPlan);

  return true;
}

// Add multiple items at once
export function addBuildPlanItems(items: Omit<ChecklistItem, 'id'>[]): string[] {
  const plan = currentBuildPlan.get();

  if (!plan) {
    logger.warn('Attempted to add items to non-existent build plan');
    return [];
  }

  logger.debug('Adding multiple items to build plan', { count: items.length });

  const newItems: ChecklistItem[] = items.map((item) => ({
    id: generateId(),
    ...item,
    timestamp: new Date(),
  }));

  const updatedPlan: BuildPlan = {
    ...plan,
    items: [...plan.items, ...newItems],
    updatedAt: new Date(),
  };

  currentBuildPlan.set(updatedPlan);

  return newItems.map((item) => item.id);
}

// Toggle build plan visibility
export function toggleBuildPlan(): boolean {
  const current = showBuildPlan.get();
  showBuildPlan.set(!current);

  return !current;
}

// Utility function to analyze prompt and generate initial build plan
export const analyzeBuildPrompt = async (
  prompt: string,
  promptId: string,
  model?: string,
  provider?: { name: string; [key: string]: any },
): Promise<BuildPlan> => {
  logger.debug('Analyzing prompt to generate build plan', { promptId });

  let plan = createEmptyBuildPlan(promptId);

  try {
    // Default initial checklist if we can't analyze the prompt
    const defaultItems: Omit<ChecklistItem, 'id'>[] = [
      {
        label: 'Analyze requirements',
        description: 'Understanding the project requirements from the prompt',
        status: 'pending',
        category: 'other',
      },
      {
        label: 'Plan project structure',
        description: 'Planning the overall project structure and architecture',
        status: 'pending',
        category: 'other',
      },
      {
        label: 'Create frontend components',
        description: 'Building the user interface components',
        status: 'pending',
        category: 'frontend',
      },
      {
        label: 'Setup backend services',
        description: 'Implementing backend logic and services',
        status: 'pending',
        category: 'backend',
      },
    ];

    // Only make the API call if we have a model and provider
    if (model && provider) {
      logger.debug('Generating build plan from LLM', { model, provider: provider.name });

      try {
        const requestBody = {
          prompt,
          model,
          provider,
        };

        logger.debug('Sending build plan request', {
          requestBodyPreview: JSON.stringify(requestBody).substring(0, 100) + '...',
        });

        const response = await fetch('/api/build-plan', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        logger.debug('Received build plan response', { status: response.status });

        if (response.ok) {
          const responseText = await response.text();
          logger.debug('Raw response text', { preview: responseText.substring(0, 100) + '...' });

          let data;

          try {
            data = JSON.parse(responseText) as {
              success: boolean;
              tasks?: Omit<ChecklistItem, 'id'>[];
              fallback?: boolean;
              message?: string;
            };

            logger.debug('Parsed API response', {
              success: data.success,
              hasTasks: Boolean(data.tasks),
              taskCount: Array.isArray(data.tasks) ? data.tasks.length : 0,
              fallback: data.fallback,
              message: data.message,
            });
          } catch (parseError) {
            logger.error('Failed to parse JSON from API response', {
              error: (parseError as Error).message,
              responsePreview: responseText.substring(0, 200),
            });
            throw parseError;
          }

          if (data.success && Array.isArray(data.tasks) && data.tasks.length > 0) {
            // Log each task to inspect their structure
            data.tasks.forEach((task, index) => {
              logger.debug(`Task ${index + 1} structure:`, {
                type: typeof task,
                keys: Object.keys(task),
                label: task.label,
                labelType: typeof task.label,
                raw: JSON.stringify(task),
              });
            });

            logger.debug('Successfully generated build plan', {
              taskCount: data.tasks.length,
              firstTask: data.tasks[0] ? JSON.stringify(data.tasks[0]) : 'none',
            });

            // Convert the tasks to checklist items with IDs
            const newItems: ChecklistItem[] = data.tasks.map((item, index) => {
              /*
               * Handle potentially malformed data by ensuring proper types
               * If the item was double-stringified JSON, try to parse it
               */
              let processedItem = item;

              if (typeof item === 'string') {
                logger.warn(`Task ${index} is a string, attempting to parse`, { raw: item });

                try {
                  processedItem = JSON.parse(item);
                } catch (e) {
                  logger.error(`Failed to parse string task ${index}`, { error: e });

                  // Create a minimal valid item
                  processedItem = {
                    label: `Task ${index + 1}`,
                    description: `Generated task ${index + 1}`,
                    category: 'other',
                    status: 'pending',
                  };
                }
              } else if (typeof item !== 'object' || item === null) {
                logger.warn(`Task ${index} is not an object`, { type: typeof item, value: item });

                // Create a minimal valid item
                processedItem = {
                  label: `Task ${index + 1}`,
                  description: `Generated task ${index + 1}`,
                  category: 'other',
                  status: 'pending',
                };
              }

              // For object items, ensure all properties have the correct type
              if (typeof processedItem === 'object' && processedItem !== null) {
                const labelValue = processedItem.label;

                // Handle special case where label might be an object instead of a string
                if (typeof labelValue === 'object' && labelValue !== null) {
                  logger.warn(`Task ${index} has object as label`, { label: labelValue });

                  // Try to extract a string from the object if possible
                  const objectLabel = labelValue as Record<string, unknown>;

                  if ('title' in objectLabel && typeof objectLabel.title === 'string') {
                    processedItem.label = objectLabel.title;
                  } else if ('name' in objectLabel && typeof objectLabel.name === 'string') {
                    processedItem.label = objectLabel.name;
                  } else if ('text' in objectLabel && typeof objectLabel.text === 'string') {
                    processedItem.label = objectLabel.text;
                  } else {
                    processedItem.label = `Task ${index + 1}`;
                  }
                }
              }

              // Start with a clean object and override specific fields to ensure validity
              const itemWithDefaults = {
                // Ensure all required fields exist with proper values
                label: typeof processedItem.label === 'string' ? processedItem.label : `Task ${index + 1}`,
                description:
                  typeof processedItem.description === 'string'
                    ? processedItem.description
                    : typeof processedItem.label === 'string'
                      ? processedItem.label
                      : `Task ${index + 1}`,
                category: ['frontend', 'backend', 'other'].includes(processedItem.category as string)
                  ? processedItem.category
                  : 'other',

                // Force status to be pending regardless of what came from API
                status: 'pending' as const,
              };

              // Log the processed item for inspection
              logger.debug(`Processed task ${index}`, {
                original: typeof item === 'object' ? JSON.stringify(item) : String(item),
                processed: itemWithDefaults,
              });

              return {
                id: generateId(),
                ...itemWithDefaults,
                timestamp: new Date(),
              };
            });

            plan = {
              ...plan,
              items: newItems,
            };

            // Log the final plan items for debugging
            logger.debug('Final build plan items', {
              itemCount: newItems.length,
              sampleItems: newItems.slice(0, 3).map((item) => ({
                id: item.id,
                label: item.label,
                category: item.category,
              })),
            });

            // Ensure showBuildPlan is set to true when we have valid items
            if (newItems.length > 0) {
              logger.debug('Setting showBuildPlan to true');
              showBuildPlan.set(true);
            }

            // Set the current build plan
            currentBuildPlan.set(plan);

            logger.info('Build plan created with', { itemCount: newItems.length });

            return plan;
          } else {
            logger.warn('API returned success=false or empty tasks, using default items', {
              success: data.success,
              taskCount: Array.isArray(data.tasks) ? data.tasks.length : 0,
              message: data.message || 'No message provided',
            });
          }
        } else {
          const errorText = await response.text();
          logger.warn('Failed to generate build plan from API', {
            status: response.status,
            statusText: response.statusText,
            errorPreview: errorText.substring(0, 100),
          });
        }
      } catch (error) {
        logger.error('Error calling build plan API', { error });
      }
    } else {
      logger.debug('No model or provider specified, using default build plan');
    }

    // Fallback to default items if API call fails or wasn't attempted
    logger.info('Using default build plan items', { itemCount: defaultItems.length });

    const newItems: ChecklistItem[] = defaultItems.map((item) => ({
      id: generateId(),
      ...item,
      timestamp: new Date(),
    }));

    plan = {
      ...plan,
      items: newItems,
    };

    logger.debug('Default build plan created', { plan: JSON.stringify(plan) });

    return plan;
  } catch (error) {
    logger.error('Error analyzing prompt', { error });
    return plan;
  }
};

// Format the build plan as a string for inclusion in AI messages
export function formatBuildPlanForAI(): string {
  const plan = currentBuildPlan.get();

  if (!plan || plan.items.length === 0) {
    return '';
  }

  // Group items by category
  const categorizedItems = plan.items.reduce(
    (acc, item) => {
      if (!acc[item.category]) {
        acc[item.category] = [];
      }

      acc[item.category].push(item);

      return acc;
    },
    {} as Record<string, ChecklistItem[]>,
  );

  let buildPlanText = '\n[Build Plan]\n';

  // Add each category and its items
  Object.entries(categorizedItems).forEach(([category, items]) => {
    buildPlanText += `\n## ${category.toUpperCase()}\n`;

    items.forEach((item) => {
      const statusMarker =
        item.status === 'complete'
          ? '✅'
          : item.status === 'in-progress'
            ? '🔄'
            : item.status === 'error'
              ? '❌'
              : '⏳';

      buildPlanText += `${statusMarker} ${item.label}\n`;
    });
  });

  buildPlanText += '\n[End Build Plan]\n';

  return buildPlanText;
}

// Export the store
export const buildPlanStore = {
  currentBuildPlan,
  showBuildPlan,
  createBuildPlan,
  clearBuildPlan,
  addBuildPlanItem,
  updateItemStatus,
  addBuildPlanItems,
  toggleBuildPlan,
  analyzeBuildPrompt,
  formatBuildPlanForAI,
};
