import { json, type MetaFunction } from '@remix-run/cloudflare';
import { ClientOnly } from 'remix-utils/client-only';
import { BaseChat } from '~/components/chat/BaseChat';
import { Chat } from '~/components/chat/Chat.client';
import { Header } from '~/components/header/Header';
import BackgroundRays from '~/components/ui/BackgroundRays';
import { useTranslation } from 'react-i18next';
import { Workbench } from '~/components/workbench/Workbench.client';
import { useStore } from '@nanostores/react';
import { chatStore } from '~/lib/stores/chat';
import { ActionRunner } from '~/lib/runtime/action-runner';
import { useState, useEffect, useRef } from 'react';
import { streamingState } from '~/lib/stores/streaming';
import { Menu } from '~/components/sidebar/Menu.client';
import { TooltipProvider } from '@radix-ui/react-tooltip';

export const handle = {
  i18n: ['common'],
};

export const meta: MetaFunction = () => {
  /*
   * Note: We can't use the useTranslation hook here because it's outside of a component
   * In a real app, you'd use the loader data to get translations for meta
   */
  return [{ title: 'Builder - AI Agent' }, { name: 'description', content: 'An AI Agent built with Remix' }];
};

export const loader = () => json({});

/**
 * Landing page component for Bolt
 * Note: Settings functionality should ONLY be accessed through the sidebar menu.
 * Do not add settings button/panel to this landing page as it was intentionally removed
 * to keep the UI clean and consistent with the design system.
 */
export default function Index() {
  const { ready } = useTranslation('common');
  const chat = useStore(chatStore);
  const isStreaming = useStore(streamingState);
  // Using @ts-ignore to bypass the type error since we don't have access to the proper type definitions
  // @ts-ignore
  const [actionRunner] = useState(() => new ActionRunner());
  
  // ALWAYS show workbench when chat is started - default to true for visibility during streaming
  const [showWorkbench, setShowWorkbench] = useState(false);
  const streamingRef = useRef(false);
  // Tracking previous message container count at component level (not inside useEffect)
  const previousMessageContainerCount = useRef(0);
  
  // Subscribe to streaming state changes with more aggressive update mechanism
  useEffect(() => {
    // Update ref for use in the observer callback
    streamingRef.current = isStreaming;
    
    // Immediately show workbench if streaming or chat started
    if (isStreaming || chat.started) {
      setShowWorkbench(true);
    }
  }, [isStreaming, chat.started]);
  
  // Monitor for form submissions - this is an earlier indicator of streaming than waiting for the response
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    // Function to intercept chat form submissions
    const chatFormSubmitHandler = (event: Event) => {
      // This triggers before the actual streaming state changes
      setShowWorkbench(true);
    };
    
    // Add event listeners to all chat forms in the document
    const chatForms = document.querySelectorAll('form');
    chatForms.forEach(form => {
      form.addEventListener('submit', chatFormSubmitHandler);
    });
    
    return () => {
      // Cleanup the event listeners
      chatForms.forEach(form => {
        form.removeEventListener('submit', chatFormSubmitHandler);
      });
    };
  }, []);
  
  // Add a mutation observer to detect streaming indicators in the DOM
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    // Function to check for workbench elements and streaming indicators
    const checkForWorkbenchElements = () => {
      // Look for code elements or any elements that indicate generation
      const codeElements = document.querySelectorAll('pre code');
      const hasCodeGeneration = codeElements.length > 0;
      
      // Check for any streaming indicators in the UI
      const streamingIndicators = document.querySelectorAll('[data-streaming="true"]');
      
      // Check for loading indicators or typing indicators that appear during generation
      const loadingIndicators = document.querySelectorAll('.typing-indicator, .loading-indicator, .bolt-typing-indicator');
      
      // Check for message containers that might indicate a response is being generated
      const messageContainers = document.querySelectorAll('.message-container');
      const newMessageContainers = messageContainers.length > previousMessageContainerCount.current;
      previousMessageContainerCount.current = messageContainers.length;
      
      // If any indicators are found, show the workbench
      if (hasCodeGeneration || 
          streamingIndicators.length > 0 || 
          loadingIndicators.length > 0 || 
          newMessageContainers || 
          streamingRef.current) {
        setShowWorkbench(true);
      }
    };
    
    // Create a mutation observer with more aggressive detection logic
    const observer = new MutationObserver((mutations) => {
      // Check if any mutations indicate streaming is happening
      const mightBeStreaming = mutations.some(mutation => {
        // Check for text changes that might indicate streaming
        if (mutation.type === 'characterData') {
          return true;
        }
        
        // Check for added nodes
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          // Look for specific nodes that indicate streaming
          return Array.from(mutation.addedNodes).some(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as Element;
              // Look for elements that might be part of code blocks or streaming content
              return element.tagName === 'PRE' || 
                    element.tagName === 'CODE' || 
                    element.classList.contains('message') ||
                    element.classList.contains('typing-indicator') ||
                    element.getAttribute('data-streaming') === 'true';
            }
            return false;
          });
        }
        
        return false;
      });
      
      // If any mutations suggest streaming might be happening, show workbench
      if (mightBeStreaming) {
        setShowWorkbench(true);
      }
      
      // Also run the standard element check
      checkForWorkbenchElements();
    });
    
    // Observe the entire document body with all possible options for maximum sensitivity
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
      attributeFilter: ['data-streaming', 'class']
    });
    
    // Check immediately in case elements already exist
    checkForWorkbenchElements();
    
    // Set up more frequent periodic checks as a fallback (every 300ms instead of 1000ms)
    const intervalCheck = setInterval(checkForWorkbenchElements, 300);
    
    return () => {
      observer.disconnect();
      clearInterval(intervalCheck);
    };
  }, []);

  if (!ready) {
    return (
      <div className="flex flex-col h-full w-full bg-bolt-elements-background-depth-1 items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col h-full w-full bg-bolt-elements-background-depth-1">
        <BackgroundRays />
        <Header />
        
        {/* Main content area with sidebar */}
        <div className="flex flex-1 relative overflow-hidden">
          {/* Sidebar Menu */}
          <ClientOnly fallback={null}>
            {() => <Menu />}
          </ClientOnly>
          
          {/* Main content */}
          <div className="flex-1 flex flex-col relative">
            {/* Workbench - should always be rendered and visible when chat is started */}
            <ClientOnly fallback={null}>
              {() => (
                <div 
                  className="absolute inset-0" 
                  style={{ 
                    display: showWorkbench || isStreaming ? 'block' : 'none',
                    zIndex: 1
                  }}
                  data-workbench-container="true"
                >
                  <Workbench 
                    chatStarted={chat.started || isStreaming || showWorkbench} 
                    isStreaming={isStreaming} 
                    actionRunner={actionRunner}
                  />
                </div>
              )}
            </ClientOnly>
            
            {/* Chat component - will use portals for floating UI */}
            <ClientOnly fallback={<BaseChat />}>
              {() => <Chat />}
            </ClientOnly>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
