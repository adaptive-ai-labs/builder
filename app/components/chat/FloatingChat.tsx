import { useState, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Rnd } from 'react-rnd';
import { useStore } from '@nanostores/react';
import { chatStore } from '~/lib/stores/chat';
import { classNames } from '~/utils/classNames';
import { IconButton } from '~/components/ui/IconButton';
import { TooltipProvider } from '@radix-ui/react-tooltip';

// Default size and position for the floating chat - using percentages for responsiveness
const DEFAULT_CHAT_SIZE = { 
  width: typeof window !== 'undefined' ? Math.min(500, window.innerWidth * 0.4) : 500, 
  height: typeof window !== 'undefined' ? Math.min(650, window.innerHeight * 0.65) : 650 
};

// Bottom right position
const BOTTOM_RIGHT_POSITION = { 
  x: typeof window !== 'undefined' ? window.innerWidth - DEFAULT_CHAT_SIZE.width - 30 : 800, 
  y: typeof window !== 'undefined' ? window.innerHeight - DEFAULT_CHAT_SIZE.height - 30 : 80 
};

// Default position as fallback
const DEFAULT_POSITION = { x: 20, y: 80 };

// Min/Max size constraints to prevent breaking layout
const MIN_CHAT_SIZE = { width: 350, height: 450 };
const MAX_CHAT_SIZE = { width: '75%', height: '75%' };

// Cookie names for persisting chat window state
const CHAT_SIZE_COOKIE = 'bolt_chat_size';
const CHAT_POS_COOKIE = 'bolt_chat_position';
const CHAT_MINIMIZED_COOKIE = 'bolt_chat_minimized';
const CHAT_POSITIONED_COOKIE = 'bolt_chat_positioned';

// Custom resize handle styles
const resizeHandleStyles = {
  right: {
    width: 8,
    height: '100%',
    top: 0,
    right: 0,
    cursor: 'e-resize',
    position: 'absolute' as const,
    backgroundColor: 'transparent',
  },
  bottom: {
    height: 8, 
    width: '100%',
    bottom: 0,
    left: 0,
    cursor: 's-resize',
    position: 'absolute' as const,
    backgroundColor: 'transparent',
  },
  bottomRight: {
    width: 20,
    height: 20,
    bottom: 0,
    right: 0,
    cursor: 'se-resize',
    position: 'absolute' as const,
    backgroundColor: 'transparent',
  }
};

interface FloatingChatProps {
  children: ReactNode;
  chatStarted: boolean;
}

// Define explicit type for size to handle both string and number
interface SizeState {
  width: number | string;
  height: number | string;
}

// Define position type
interface PositionState {
  x: number;
  y: number;
}

export function FloatingChat({ children, chatStarted }: FloatingChatProps) {
  const chatRef = useRef<Rnd>(null);
  const [minimized, setMinimized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [size, setSize] = useState<SizeState>(DEFAULT_CHAT_SIZE);
  const [position, setPosition] = useState<PositionState>(BOTTOM_RIGHT_POSITION);
  const [userPositioned, setUserPositioned] = useState(false);
  const chat = useStore(chatStore);
  const [mounted, setMounted] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [windowDimensions, setWindowDimensions] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1000,
    height: typeof window !== 'undefined' ? window.innerHeight : 800
  });

  // Effect to set mounted state for client-side rendering with portal
  useEffect(() => {
    setMounted(true);
    
    // Calculate initial size based on viewport
    const initialWidth = Math.min(500, window.innerWidth * 0.4);
    const initialHeight = Math.min(650, window.innerHeight * 0.65);
    setSize({ width: initialWidth, height: initialHeight });
    
    // Set initial position to bottom right
    if (!userPositioned) {
      const bottomRightPos = {
        x: window.innerWidth - initialWidth - 30,
        y: window.innerHeight - initialHeight - 30
      };
      setPosition(bottomRightPos);
    }
    
    return () => setMounted(false);
  }, []);

  // Calculate bottom-right position based on current window size
  const getBottomRightPosition = () => {
    if (typeof window === 'undefined') return BOTTOM_RIGHT_POSITION;
    
    // Get chat width as a number
    const chatWidth = typeof size.width === 'string' 
      ? parseInt(size.width) / 100 * window.innerWidth 
      : size.width;
      
    // Get chat height as a number
    const chatHeight = typeof size.height === 'string'
      ? parseInt(size.height) / 100 * window.innerHeight
      : size.height;
    
    return {
      x: window.innerWidth - chatWidth - 30,
      y: window.innerHeight - chatHeight - 30
    };
  };

  // Listen for window resize events
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const handleResize = () => {
      const newWindowDimensions = {
        width: window.innerWidth,
        height: window.innerHeight
      };
      
      setWindowDimensions(newWindowDimensions);
      
      // If using percentage size, adjust the actual pixel size
      const newSize = { ...size };
      if (typeof newSize.width === 'string' && newSize.width.includes('%')) {
        const percentage = parseInt(newSize.width) / 100;
        newSize.width = Math.floor(newWindowDimensions.width * percentage);
      }
      
      if (typeof newSize.height === 'string' && newSize.height.includes('%')) {
        const percentage = parseInt(newSize.height) / 100;
        newSize.height = Math.floor(newWindowDimensions.height * percentage);
      }
      
      // If user hasn't manually positioned the chat, keep it in bottom right
      if (!userPositioned) {
        setPosition(getBottomRightPosition());
      } else {
        // Otherwise just ensure it stays within viewport
        adjustChatPosition();
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [userPositioned, size]);

  // Adjust chat position to keep it within viewport
  const adjustChatPosition = () => {
    if (!chatRef.current || minimized) return;
    
    const newPosition = { ...position };
    
    // Get current size of chat window (handling percentage values)
    const currentWidth = typeof size.width === 'string' 
      ? parseInt(size.width) / 100 * window.innerWidth 
      : size.width;
      
    const currentHeight = typeof size.height === 'string'
      ? parseInt(size.height) / 100 * window.innerHeight
      : size.height;
    
    // Ensure chat is fully visible (at least partially if window is smaller than the chat)
    const maxX = Math.max(20, window.innerWidth - currentWidth);
    const maxY = Math.max(20, window.innerHeight - currentHeight);
    
    // Adjust position if needed
    if (newPosition.x > maxX) newPosition.x = maxX;
    if (newPosition.y > maxY) newPosition.y = maxY;
    
    // If position changed, update it
    if (newPosition.x !== position.x || newPosition.y !== position.y) {
      setPosition(newPosition);
    }
  };

  // Adjust position when chat size or window dimensions change
  useEffect(() => {
    if (userPositioned) {
      adjustChatPosition();
    }
  }, [size, windowDimensions, minimized, userPositioned]);

  // Load saved position and size from cookies on first render
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const savedUserPositioned = localStorage.getItem(CHAT_POSITIONED_COOKIE);
        const savedSize = localStorage.getItem(CHAT_SIZE_COOKIE);
        const savedPosition = localStorage.getItem(CHAT_POS_COOKIE);
        const savedMinimized = localStorage.getItem(CHAT_MINIMIZED_COOKIE);

        // First check if user has manually positioned the chat before
        if (savedUserPositioned === 'true') {
          setUserPositioned(true);
        } else {
          // If not user positioned, place in bottom right
          setPosition(getBottomRightPosition());
        }

        if (savedSize) {
          const parsedSize = JSON.parse(savedSize);
          // Ensure size is within constraints
          setSize({
            width: Math.max(MIN_CHAT_SIZE.width, Math.min(typeof MAX_CHAT_SIZE.width === 'string' 
              ? parseInt(MAX_CHAT_SIZE.width) / 100 * window.innerWidth 
              : MAX_CHAT_SIZE.width, parsedSize.width)),
            height: Math.max(MIN_CHAT_SIZE.height, Math.min(typeof MAX_CHAT_SIZE.height === 'string'
              ? parseInt(MAX_CHAT_SIZE.height) / 100 * window.innerHeight
              : MAX_CHAT_SIZE.height, parsedSize.height))
          });
        }
        
        // Only use saved position if user had manually positioned it before
        if (savedPosition && savedUserPositioned === 'true') {
          const parsedPosition = JSON.parse(savedPosition);
          // Make sure position is valid for current screen size
          setPosition({
            x: Math.min(parsedPosition.x, Math.max(20, window.innerWidth - (savedSize ? JSON.parse(savedSize).width : DEFAULT_CHAT_SIZE.width))),
            y: Math.min(parsedPosition.y, Math.max(20, window.innerHeight - (savedSize ? JSON.parse(savedSize).height : DEFAULT_CHAT_SIZE.height)))
          });
        }
        
        if (savedMinimized) setMinimized(savedMinimized === 'true');
      } catch (error) {
        console.error('Error loading chat position/size from storage:', error);
      }
    }
  }, []);

  // Save position and size to cookies when changed
  useEffect(() => {
    if (typeof window !== 'undefined' && chatStarted) {
      localStorage.setItem(CHAT_SIZE_COOKIE, JSON.stringify(size));
      localStorage.setItem(CHAT_POS_COOKIE, JSON.stringify(position));
      localStorage.setItem(CHAT_MINIMIZED_COOKIE, String(minimized));
      localStorage.setItem(CHAT_POSITIONED_COOKIE, String(userPositioned));
    }
  }, [size, position, minimized, chatStarted, userPositioned]);

  // When chat first starts, position it in the bottom right
  useEffect(() => {
    if (chatStarted && !userPositioned) {
      const newPosition = getBottomRightPosition();
      setPosition(newPosition);
    }
  }, [chatStarted, size, userPositioned, windowDimensions]);

  // Reset minimized state when chat starts
  useEffect(() => {
    if (chatStarted) {
      setMinimized(false);
    }
  }, [chatStarted]);

  // If not yet mounted or chat not started, render children directly (no floating behavior)
  if (!mounted || !chatStarted) {
    return <>{children}</>;
  }

  // Create the chat content - either minimized button or full floating window
  const minimizedContent = (
    <Rnd
      position={position}
      onDragStart={() => {
        setIsDragging(true);
      }}
      onDrag={(e, d) => {
        // Update position during drag
        const newX = Math.max(0, Math.min(d.x, window.innerWidth - 240));
        const newY = Math.max(0, Math.min(d.y, window.innerHeight - 41));
        setPosition({ x: newX, y: newY });
      }}
      onDragStop={(e, d) => {
        setIsDragging(false);
        const newX = Math.max(0, Math.min(d.x, window.innerWidth - 240));
        const newY = Math.max(0, Math.min(d.y, window.innerHeight - 41));
        setPosition({ x: newX, y: newY });
      }}
      bounds="window"
      enableResizing={false}
      className="fixed z-[9999]"
    >
      <div 
        className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg flex items-center"
        style={{ minWidth: '240px' }}
      >
        <div className="drag-handle flex-1 px-4 py-2.5 flex items-center justify-between">
          <span className="truncate text-sm font-medium text-gray-700 dark:text-gray-300">
            {chat.title || 'Chat'}
          </span>
          <button 
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md ml-2 no-drag"
            onClick={(e) => {
              e.stopPropagation();
              if (!isDragging) {
                setMinimized(false);
              }
            }}
          >
            <div className="i-ph:arrows-out-simple w-4 h-4" />
          </button>
        </div>
      </div>
    </Rnd>
  );

  // Full chat window
  const fullChatContent = (
    <Rnd
      ref={chatRef}
      size={size}
      position={position}
      onDragStart={() => {
        setIsDragging(true);
        setUserPositioned(true);
      }}
      onDrag={(e, d) => {
        const currentWidth = typeof size.width === 'string' 
          ? parseInt(size.width) / 100 * window.innerWidth 
          : size.width;
        const currentHeight = typeof size.height === 'string'
          ? parseInt(size.height) / 100 * window.innerHeight
          : size.height;

        const newX = Math.max(0, Math.min(d.x, window.innerWidth - currentWidth));
        const newY = Math.max(0, Math.min(d.y, window.innerHeight - currentHeight));
        setPosition({ x: newX, y: newY });
      }}
      onDragStop={(e, d) => {
        setIsDragging(false);
        const currentWidth = typeof size.width === 'string' 
          ? parseInt(size.width) / 100 * window.innerWidth 
          : size.width;
        const currentHeight = typeof size.height === 'string'
          ? parseInt(size.height) / 100 * window.innerHeight
          : size.height;

        const newX = Math.max(0, Math.min(d.x, window.innerWidth - currentWidth));
        const newY = Math.max(0, Math.min(d.y, window.innerHeight - currentHeight));
        setPosition({ x: newX, y: newY });
      }}
      onResizeStart={() => setUserPositioned(true)}
      onResizeStop={(e, direction, ref, delta, position) => {
        const newWidth = parseInt(ref.style.width);
        const newHeight = parseInt(ref.style.height);
        
        // Enforce min/max constraints
        const constrainedSize = {
          width: Math.max(MIN_CHAT_SIZE.width, Math.min(typeof MAX_CHAT_SIZE.width === 'string' 
            ? parseInt(MAX_CHAT_SIZE.width) / 100 * window.innerWidth 
            : MAX_CHAT_SIZE.width, newWidth)),
          height: Math.max(MIN_CHAT_SIZE.height, Math.min(typeof MAX_CHAT_SIZE.height === 'string'
            ? parseInt(MAX_CHAT_SIZE.height) / 100 * window.innerHeight
            : MAX_CHAT_SIZE.height, newHeight))
        };
        
        // Adjust position if needed to keep in viewport
        const adjustedPosition = {
          x: Math.max(0, Math.min(position.x, window.innerWidth - constrainedSize.width)),
          y: Math.max(0, Math.min(position.y, window.innerHeight - constrainedSize.height))
        };
        
        setSize(constrainedSize);
        setPosition(adjustedPosition);
      }}
      minWidth={MIN_CHAT_SIZE.width}
      minHeight={MIN_CHAT_SIZE.height}
      maxWidth={typeof MAX_CHAT_SIZE.width === 'string' ? parseInt(MAX_CHAT_SIZE.width) / 100 * window.innerWidth : MAX_CHAT_SIZE.width}
      maxHeight={typeof MAX_CHAT_SIZE.height === 'string' ? parseInt(MAX_CHAT_SIZE.height) / 100 * window.innerHeight : MAX_CHAT_SIZE.height}
      bounds="window"
      style={{
        zIndex: 9999,
        position: 'fixed', // Use fixed for portal positioning
        display: 'flex', // Use flex to maintain content stability
        flexDirection: 'column',
        overflow: 'hidden', // Prevent content from overflowing during resize
        backgroundColor: 'white',
        border: '1px solid #e5e7eb', // Consistent border
        borderRadius: '0.5rem',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
      }}
      dragHandleClassName="drag-handle"
      disableDragging={false}
      enableResizing={{
        top: false,
        right: true,
        bottom: true,
        left: false,
        topRight: false,
        bottomRight: true,
        bottomLeft: false,
        topLeft: false
      }}
      resizeHandleStyles={{
        right: resizeHandleStyles.right,
        bottom: resizeHandleStyles.bottom,
        bottomRight: resizeHandleStyles.bottomRight
      }}
      resizeHandleClasses={{
        right: 'resize-handle-right hover:bg-blue-100',
        bottom: 'resize-handle-bottom hover:bg-blue-100',
        bottomRight: 'resize-handle-corner'
      }}
      resizeHandleComponent={{
        bottomRight: (
          <div className="absolute bottom-0 right-0 w-7 h-7 bg-white bg-opacity-0 hover:bg-opacity-10 flex items-end justify-end">
            <div className="w-4 h-4 border-r-2 border-b-2 border-blue-500 mr-1 mb-1" />
          </div>
        )
      }}
      lockAspectRatio={false}
      cancel=".no-drag" // Add this class to elements that shouldn't trigger drag
    >
      {/* A fixed container for chat content */}
      <div className="flex flex-col h-full w-full">
        {/* Chat Header - Drag Handle */}
        <div className="drag-handle flex items-center justify-between px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 cursor-move flex-shrink-0">
          <span className="font-medium text-gray-700 dark:text-gray-300 truncate">
            {chat.title || 'Chat'}
          </span>
          <div className="flex items-center gap-3">
            <button 
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700 rounded-md no-drag"
              onClick={() => {/* Add fullscreen logic */}}
            >
              <div className="i-ph:arrows-out-simple w-4 h-4" />
            </button>
            <button 
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700 rounded-md no-drag"
              onClick={(e) => {
                e.stopPropagation();
                if (!isDragging) {
                  setMinimized(true);
                }
              }}
            >
              <div className="i-ph:minus w-4 h-4" />
            </button>
          </div>
        </div>
        
        {/* Chat Content - with improved layout stability */}
        <div 
          ref={contentRef}
          className="flex-1 overflow-hidden relative no-drag" 
          style={{ 
            height: 'calc(100% - 40px)', // Account for header height
            width: '100%'
          }}
        >
          {/* Fix position of content element */}
          <div 
            className="absolute inset-0 overflow-auto" 
            style={{ 
              transformOrigin: 'top left', 
              contain: 'strict', // Use CSS containment for better performance
              willChange: 'transform', // Optimize for animations
            }}
          >
            {children}
          </div>
        </div>
      </div>
    </Rnd>
  );

  // Render via portal to document.body to ensure proper stacking context
  // This completely isolates the floating chat from the page hierarchy
  return createPortal(
    <TooltipProvider>
      {minimized ? minimizedContent : fullChatContent}
    </TooltipProvider>,
    document.body
  );
}
