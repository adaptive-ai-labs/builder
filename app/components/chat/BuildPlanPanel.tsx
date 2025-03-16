import React, { useEffect, useRef } from 'react';
import { useStore } from '@nanostores/react';
import { buildPlanStore } from '~/lib/stores/buildPlan';
import { DynamicChecklist } from './DynamicChecklist';
import type { Message } from 'ai';
import { analyzeMessages, updateTaskStatuses, processStreamingData } from '~/lib/processors/buildPlanProcessor';

interface BuildPlanPanelProps {
  messages: Message[];
  isStreaming: boolean;
  data?: any[];
}

export const BuildPlanPanel: React.FC<BuildPlanPanelProps> = ({ 
  messages, 
  isStreaming,
  data
}) => {
  const buildPlan = useStore(buildPlanStore.currentBuildPlan);
  const showBuildPlan = useStore(buildPlanStore.showBuildPlan);

  useEffect(() => {
    // Initialize build plan if it doesn't exist and we have user messages
    if (!buildPlan && messages.length > 0) {
      const userMessage = messages.find(m => m.role === 'user');
      if (userMessage) {
        buildPlanStore.createBuildPlan(userMessage.id);
      }
    }
    
    // Only run task extraction on new messages
    if (messages.length > 0) {
      // Analyze messages to extract tasks
      analyzeMessages(messages);
      
      // Check the latest assistant message for task status updates
      const latestAssistantMessage = [...messages]
        .reverse()
        .find(m => m.role === 'assistant');
        
      if (latestAssistantMessage) {
        updateTaskStatuses(latestAssistantMessage);
      }
    }
  }, [messages]);
  
  // Separate effect to initialize the first task without creating an infinite loop
  useEffect(() => {
    if (buildPlan && buildPlan.items.length > 0 && !buildPlan.currentStep) {
      // Only set first task as in-progress if no current step is set
      // and we haven't already done this initialization
      const firstTask = buildPlan.items[0];
      if (firstTask && firstTask.status === 'pending') {
        // Use a timeout to avoid React state update conflicts
        setTimeout(() => {
          buildPlanStore.updateItemStatus(firstTask.id, 'in-progress');
        }, 50);
      }
    }
  }, []);
  
  // Process streaming data for progress updates, using a ref to track previous data
  const prevDataLengthRef = useRef(0);
  
  useEffect(() => {
    // Only process data if it's new
    if (data && data.length > prevDataLengthRef.current) {
      processStreamingData(data);
      prevDataLengthRef.current = data.length;
    }
  }, [data]);
  
  // Handle streaming state changes to avoid infinite loops
  const hasMarkedTaskInProgress = useRef(false);
  
  useEffect(() => {
    // Only update task status on streaming state change, not on every buildPlan change
    if (isStreaming && buildPlan && buildPlan.items.length > 0 && !hasMarkedTaskInProgress.current) {
      // Find the first pending task
      const pendingTask = buildPlan.items.find(item => item.status === 'pending');
      
      if (pendingTask) {
        // Set the flag to prevent further automatic updates
        hasMarkedTaskInProgress.current = true;
        
        // Use setTimeout to break the potential update cycle
        setTimeout(() => {
          buildPlanStore.updateItemStatus(pendingTask.id, 'in-progress');
        }, 100);
      }
    } else if (!isStreaming) {
      // Reset the flag when streaming stops
      hasMarkedTaskInProgress.current = false;
    }
  }, [isStreaming]);

  // Even if showBuildPlan is false, we'll still render the panel in a hidden state
  // This ensures that it stays in the DOM and can be visible when needed
  if (!buildPlan) {
    return null;
  }
  
  // Use the showBuildPlan store value to determine visibility
  // This ensures the panel responds to the toggle button
  const isVisible = showBuildPlan;

  return (
    <div 
      className="relative mb-4 transition-opacity duration-300" 
      style={{ 
        opacity: isVisible ? 1 : 0,
        height: isVisible ? 'auto' : '0',
        overflow: isVisible ? 'visible' : 'hidden',
        marginBottom: isVisible ? '1rem' : '0'
      }}
    >
      <div className="absolute top-1 right-1 z-10 flex">
        <button 
          onClick={() => buildPlanStore.toggleBuildPlan()}
          className="p-1 text-white/70 hover:text-white rounded-md hover:bg-gray-700"
          title="Hide build plan"
        >
          <div className="i-ph:x-bold text-sm" />
        </button>
      </div>
      {buildPlan.items.length > 0 ? (
        <DynamicChecklist 
          items={buildPlan.items} 
          currentStep={buildPlan.currentStep}
        />
      ) : (
        <div className="flex flex-col gap-2 mb-4 border border-bolt-border-subtle rounded-md p-4 bg-bolt-background overflow-hidden">
          <h3 className="text-sm font-semibold mb-2 text-bolt-foreground">Build Plan</h3>
          <div className="flex flex-col items-center justify-center py-4 text-center">
            <div className="i-ph:list-bullets text-bolt-foreground-muted w-8 h-8 mb-2"></div>
            <div className="text-sm text-bolt-foreground-muted">
              No tasks found in the build plan.
            </div>
            <div className="text-xs text-bolt-foreground-muted mt-1">
              Try generating a new build plan.
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
