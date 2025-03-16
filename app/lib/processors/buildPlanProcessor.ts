import type { Message } from 'ai';
import { createScopedLogger } from '~/utils/logger';
import type { ChecklistItem, ChecklistItemCategory } from '~/types/checklist';
import { buildPlanStore } from '~/lib/stores/buildPlan';

const logger = createScopedLogger('buildPlanProcessor');

const FRONTEND_PATTERNS = [
  /create\s+(\w+)\s+component/i,
  /build(ing)?\s+(\w+)\s+page/i,
  /implement(ing)?\s+(frontend|ui|interface|page|component)/i,
  /design(ing)?\s+(ui|user interface|page|component)/i,
  /add(ing)?\s+(styles|css|styling|layout)/i,
  /setup\s+(react|vue|angular|svelte|frontend)/i,
  /create\s+(html|jsx|tsx|template)/i
];

const BACKEND_PATTERNS = [
  /create\s+(\w+)\s+(api|endpoint|service|controller)/i,
  /setup\s+(api|backend|server|database|auth)/i,
  /implement(ing)?\s+(api|endpoint|route|backend|server)/i,
  /configure\s+(database|server|middleware|authentication)/i,
  /add(ing)?\s+(authentication|authorization|validation)/i,
  /create\s+(model|schema|migration)/i
];

export interface FileReferences {
  [filePath: string]: {
    type: 'frontend' | 'backend' | 'other';
    description: string;
  }
}

/**
 * Analyzes assistant messages to extract tasks and build plan items
 */
export const analyzeMessages = (messages: Message[]) => {
  // Only process assistant messages
  const assistantMessages = messages.filter(m => m.role === 'assistant');
  
  if (assistantMessages.length === 0) return;
  
  // Process the latest message
  const latestMessage = assistantMessages[assistantMessages.length - 1];
  
  // Extract tasks from the message
  const items = extractTasksFromMessage(latestMessage.content);
  
  // Add items to the build plan
  if (items.length > 0) {
    if (!buildPlanStore.currentBuildPlan.get()) {
      buildPlanStore.createBuildPlan();
    }
    
    buildPlanStore.addBuildPlanItems(items);
  }
  
  return items;
};

/**
 * Extracts file references from assistant message
 */
export const extractFileReferences = (content: string): FileReferences => {
  const fileReferences: FileReferences = {};
  
  // Match file paths patterns like: filename.ext, /path/to/file.ext, or ./path/to/file.ext
  const filePathRegex = /(\/[\w\-.\/]+\.\w+|\.\/?[\w\-.\/]+\.\w+|\b[\w\-]+\.\w+)\b/g;
  const matches = content.match(filePathRegex) || [];
  
  matches.forEach(filePath => {
    // Determine if it's likely frontend or backend
    let type: 'frontend' | 'backend' | 'other' = 'other';
    
    if (/\.(jsx|tsx|css|scss|html|vue|svelte|js|ts)$/.test(filePath)) {
      type = 'frontend';
    } else if (/\.(py|rb|go|java|php|cs|rs|c|cpp|h|hpp)$/.test(filePath)) {
      type = 'backend';
    }
    
    // Extract description from surrounding context - in a real implementation
    // we would analyze the content more deeply
    fileReferences[filePath] = {
      type,
      description: `File referenced in assistant's message`
    };
  });
  
  return fileReferences;
};

/**
 * Extracts tasks from a message content
 */
export const extractTasksFromMessage = (content: string): Omit<ChecklistItem, 'id'>[] => {
  const tasks: Omit<ChecklistItem, 'id'>[] = [];
  
  // Extract markdown list items
  const listItemRegex = /(?:^|\n)[\s]*[-*+][\s]+(.*)/g;
  const listMatches = [...content.matchAll(listItemRegex)];
  
  listMatches.forEach(match => {
    const taskText = match[1].trim();
    
    // Determine the category
    let category: ChecklistItemCategory = 'other';
    
    if (FRONTEND_PATTERNS.some(pattern => pattern.test(taskText))) {
      category = 'frontend';
    } else if (BACKEND_PATTERNS.some(pattern => pattern.test(taskText))) {
      category = 'backend';
    }
    
    tasks.push({
      label: taskText,
      description: taskText,
      status: 'pending',
      category
    });
  });
  
  // Look for numbered lists too
  const numberedListRegex = /(?:^|\n)[\s]*\d+\.[\s]+(.*)/g;
  const numberedMatches = [...content.matchAll(numberedListRegex)];
  
  numberedMatches.forEach(match => {
    const taskText = match[1].trim();
    
    // Determine the category
    let category: ChecklistItemCategory = 'other';
    
    if (FRONTEND_PATTERNS.some(pattern => pattern.test(taskText))) {
      category = 'frontend';
    } else if (BACKEND_PATTERNS.some(pattern => pattern.test(taskText))) {
      category = 'backend';
    }
    
    tasks.push({
      label: taskText,
      description: taskText,
      status: 'pending',
      category
    });
  });
  
  return tasks;
};

/**
 * Updates task statuses based on the AI's responses
 */
export const updateTaskStatuses = (message: Message) => {
  const plan = buildPlanStore.currentBuildPlan.get();
  if (!plan) return;
  
  // Check each task to see if it's been completed in the message
  plan.items.forEach(item => {
    if (item.status === 'complete') return;
    
    // Simple heuristic: if the task name appears with words like "completed", "done", "created", "implemented"
    const completionRegex = new RegExp(`(completed|done|created|implemented|added|built).*${item.label}`, 'i');
    const isCompleted = completionRegex.test(message.content);
    
    // Or if it's being worked on
    const progressRegex = new RegExp(`(creating|implementing|setting up|building|working on).*${item.label}`, 'i');
    const isInProgress = progressRegex.test(message.content);
    
    if (isCompleted) {
      buildPlanStore.updateItemStatus(item.id, 'complete');
    } else if (isInProgress && item.status === 'pending') {
      buildPlanStore.updateItemStatus(item.id, 'in-progress');
    }
  });
};

/**
 * Processes data from streaming API responses
 */
export const processStreamingData = (data: any[]) => {
  if (!data || data.length === 0) return;
  
  // Find progress annotations 
  const progressItems = data.filter(item => 
    typeof item === 'object' && item.type === 'progress'
  );
  
  // Update build plan based on progress items
  progressItems.forEach(item => {
    const { label, status, message } = item;
    
    // Find if we already have this item in our build plan
    const plan = buildPlanStore.currentBuildPlan.get();
    if (!plan) return;
    
    const existingItem = plan.items.find(i => i.label === label);
    
    if (existingItem) {
      // Update the status
      buildPlanStore.updateItemStatus(existingItem.id, status);
    } else {
      // Add a new item
      buildPlanStore.addBuildPlanItem({
        label,
        description: message || label,
        status,
        category: 'other' // We can't determine the category from just the progress item
      });
    }
  });
};
