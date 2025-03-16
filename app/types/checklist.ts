export type ChecklistItemStatus = 'pending' | 'in-progress' | 'complete' | 'error';
export type ChecklistItemCategory = 'frontend' | 'backend' | 'database' | 'api' | 'deployment' | 'testing' | 'other';

export interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  status: ChecklistItemStatus;
  category: ChecklistItemCategory;
  timestamp?: Date;
  dependsOn?: string[]; // IDs of items that must be completed before this one
  artifactPath?: string; // Path to a file or resource created by this step
}

export interface BuildPlan {
  id: string;
  items: ChecklistItem[];
  currentStep?: string; // ID of the current step
  createdAt: Date;
  updatedAt: Date;
  promptId?: string; // Link to the prompt that generated this plan
}

// Helper functions for managing checklist items
export const createEmptyBuildPlan = (promptId?: string): BuildPlan => {
  return {
    id: generateId(),
    items: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    promptId
  };
};

export const generateId = (): string => {
  return Math.random().toString(36).substring(2, 11);
};

export const updateChecklistItemStatus = (
  items: ChecklistItem[],
  itemId: string,
  newStatus: ChecklistItemStatus
): ChecklistItem[] => {
  return items.map(item => 
    item.id === itemId 
      ? { ...item, status: newStatus, timestamp: new Date() } 
      : item
  );
};

export const addChecklistItem = (
  items: ChecklistItem[],
  newItem: Omit<ChecklistItem, 'id'>
): ChecklistItem[] => {
  const item: ChecklistItem = {
    id: generateId(),
    ...newItem,
    timestamp: new Date()
  };
  return [...items, item];
};
