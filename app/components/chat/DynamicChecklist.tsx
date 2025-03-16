import React, { useState, useEffect } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { classNames } from '~/utils/classNames';
import type { ChecklistItem } from '~/types/checklist';
import { createScopedLogger } from '~/utils/logger';

interface DynamicChecklistProps {
  items: ChecklistItem[];
  currentStep?: string;
}

const logger = createScopedLogger('DynamicChecklist');

export const DynamicChecklist: React.FC<DynamicChecklistProps> = ({ items, currentStep }) => {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['frontend', 'backend']));

  // Validate the items are in the expected format
  const validItems = React.useMemo(() => {
    if (!Array.isArray(items)) {
      logger.warn('Items is not an array', { itemsType: typeof items });
      return [];
    }
    
    logger.debug('Validating checklist items', { 
      count: items.length, 
      first: items.length > 0 ? JSON.stringify(items[0]) : 'no items' 
    });
    
    return items.filter(item => {
      if (!item || typeof item !== 'object') {
        logger.warn('Invalid item in checklist', { item: JSON.stringify(item) });
        return false;
      }
      
      // Deep inspection of the item
      try {
        const itemStr = JSON.stringify(item);
        logger.debug(`Item structure: ${itemStr.substring(0, 100)}${itemStr.length > 100 ? '...' : ''}`);
      } catch (e) {
        logger.warn('Failed to stringify item', { error: e });
      }
      
      // Check for valid label - this is the most critical property
      if (!item.label) {
        logger.warn('Item has missing label', { 
          item: JSON.stringify(item), 
          itemKeys: Object.keys(item) 
        });
        return false;
      }
      
      if (typeof item.label !== 'string') {
        logger.warn('Item has non-string label', { 
          labelType: typeof item.label,
          labelValue: JSON.stringify(item.label),
          item: JSON.stringify(item)
        });
        // We don't return false here so these items can still be displayed
        // with special handling in the component
      }
      
      // Check other required properties
      const requiredProps = ['id', 'description', 'category', 'status'];
      const missingProps = requiredProps.filter(prop => !(prop in item));
      
      if (missingProps.length > 0) {
        logger.warn('Item missing required properties', { 
          itemId: item.id || 'unknown',
          label: typeof item.label === 'string' ? item.label : JSON.stringify(item.label), 
          missingProps,
          itemKeys: Object.keys(item) 
        });
      }
      
      return true; // Let all items through, we'll handle display issues in the render
    });
  }, [items]);
  
  // Group items by category (frontend/backend/etc)
  const groupedItems = validItems.reduce((acc, item) => {
    const groupKey = item.category || 'other';
    if (!acc[groupKey]) {
      acc[groupKey] = [];
    }
    acc[groupKey].push(item);
    return acc;
  }, {} as Record<string, ChecklistItem[]>);

  const toggleGroup = (group: string) => {
    const newExpandedGroups = new Set(expandedGroups);
    if (newExpandedGroups.has(group)) {
      newExpandedGroups.delete(group);
    } else {
      newExpandedGroups.add(group);
    }
    setExpandedGroups(newExpandedGroups);
  };

  // Count completed items for each group
  const getCompletedCount = (items: ChecklistItem[]) => {
    return items.filter(item => item.status === 'complete').length;
  };

  return (
    <div className="flex flex-col gap-2 mb-4 border border-bolt-border-subtle rounded-md p-4 bg-bolt-background-subtle overflow-hidden">
      <h3 className="text-sm font-semibold mb-2 text-white">Build Plan</h3>
      
      {Object.keys(groupedItems).length === 0 && (
        <div className="flex flex-col items-center justify-center py-4 text-center">
          <div className="i-ph:list-bullets text-bolt-foreground-muted w-8 h-8 mb-2"></div>
          <div className="text-sm text-white/80">
            No tasks found in the build plan.
          </div>
          <div className="text-xs text-white/70 mt-1">
            Try generating a new build plan.
          </div>
        </div>
      )}
      
      {Object.entries(groupedItems).map(([category, categoryItems]) => (
        <div key={category} className="mb-2">
          <div 
            className="flex items-center justify-between cursor-pointer py-1.5 px-2 hover:bg-bolt-background-hover rounded-md"
            onClick={() => toggleGroup(category)}
          >
            <div className="flex items-center gap-2">
              <div className={`transform transition-transform ${expandedGroups.has(category) ? 'rotate-90' : ''}`}>
                <div className="i-ph:caret-right text-white/70" />
              </div>
              <h4 className="text-sm font-medium capitalize text-white">
                {category} ({getCompletedCount(categoryItems)}/{categoryItems.length})
              </h4>
            </div>
            
            <div className="h-1.5 w-24 bg-gray-700 rounded-full overflow-hidden">
              <div 
                className="h-full bg-bolt-accent-default transition-all duration-500 ease-in-out"
                style={{ 
                  width: `${(getCompletedCount(categoryItems) / categoryItems.length) * 100}%`,
                }}
              />
            </div>
          </div>
          
          {expandedGroups.has(category) && (
            <ul className="pl-6 mt-1 flex flex-col gap-1.5 text-white">
              {categoryItems.map((item) => (
                <Tooltip.Provider key={item.id}>
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <li 
                        className={classNames(
                          "flex items-center gap-2 text-xs py-1 px-1.5 rounded-md transition-colors duration-200",
                          item.status === 'in-progress' ? "bg-blue-500/20" : "",
                          item.status === 'complete' ? "text-white/60" : "",
                          item.id === currentStep ? "bg-bolt-background-active/20" : ""
                        )}
                      >
                        {item.status === 'pending' && (
                          <div className="i-ph:circle text-white/70" />
                        )}
                        {item.status === 'in-progress' && (
                          <div className="i-svg-spinners:3-dots-fade text-bolt-accent-default w-4 h-4" />
                        )}
                        {item.status === 'complete' && (
                          <div className="i-ph:check-circle-fill text-green-400" />
                        )}
                        <span className={`${item.status === 'complete' ? 'line-through' : ''} text-white`}>
                          {(() => {
                            // Advanced label handling with fallbacks and cleaning
                            if (typeof item.label === 'string') {
                              // Handle string label that might be JSON stringified object
                              if (item.label.startsWith('{') && item.label.endsWith('}')) {
                                try {
                                  const parsed = JSON.parse(item.label);
                                  // Check if this is actually an object with useful properties
                                  if (typeof parsed === 'object' && parsed !== null) {
                                    const keys = Object.keys(parsed);
                                    if (keys.includes('label') && typeof parsed.label === 'string') {
                                      return parsed.label;
                                    } else if (keys.includes('title') && typeof parsed.title === 'string') {
                                      return parsed.title;
                                    } else if (keys.includes('name') && typeof parsed.name === 'string') {
                                      return parsed.name;
                                    } else if (keys.includes('text') && typeof parsed.text === 'string') {
                                      return parsed.text;
                                    }
                                  }
                                } catch (e) {
                                  // Not valid JSON, just use as-is
                                }
                              }
                              
                              // Clean the label if it contains parentheses at the start
                              if (item.label.trim() === '(' || item.label.trim().startsWith('(') && !item.label.includes(')')) {
                                return `Task ${item.id.substring(0, 5)}`;
                              }
                              
                              return item.label;
                            } else if (typeof item.label === 'object' && item.label !== null) {
                              // Handle object label
                              const objLabel = item.label as Record<string, unknown>;
                              if ('label' in objLabel && typeof objLabel.label === 'string') {
                                return objLabel.label;
                              } else if ('title' in objLabel && typeof objLabel.title === 'string') {
                                return objLabel.title;
                              } else if ('name' in objLabel && typeof objLabel.name === 'string') {
                                return objLabel.name;
                              } else if ('text' in objLabel && typeof objLabel.text === 'string') {
                                return objLabel.text;
                              } else {
                                return `Task ${item.id.substring(0, 5)}`;
                              }
                            } else {
                              // Handle other types or undefined/null
                              return `Task ${item.id.substring(0, 5)}`;
                            }
                          })()}
                        </span>
                      </li>
                    </Tooltip.Trigger>
                    <Tooltip.Portal>
                      <Tooltip.Content
                        className="max-w-xs bg-bolt-background-tooltip text-bolt-foreground-tooltip px-3 py-2 rounded shadow-lg text-sm z-50"
                        sideOffset={5}
                      >
                        {item.description}
                        <Tooltip.Arrow className="fill-bolt-background-tooltip" />
                      </Tooltip.Content>
                    </Tooltip.Portal>
                  </Tooltip.Root>
                </Tooltip.Provider>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
};
