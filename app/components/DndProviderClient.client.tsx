import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';

interface DndProviderClientProps {
  children: React.ReactNode;
}

// Using default export for compatibility with React.lazy
function DndProviderClient({ children }: DndProviderClientProps) {
  return <DndProvider backend={HTML5Backend}>{children}</DndProvider>;
}

export default DndProviderClient;
