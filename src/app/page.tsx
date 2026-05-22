'use client';

import Canvas from '@/components/Canvas';
import LeftToolbar from '@/components/LeftToolbar';
import PropertyPanel from '@/components/PropertyPanel';
import TopMenuBar from '@/components/TopMenuBar';
import HistoryPanel from '@/components/HistoryPanel';
import { useShortcuts } from '@/lib/useShortcuts';

export default function Home() {
  useShortcuts();

  return (
    <div className="w-screen h-screen overflow-hidden relative bg-gray-50 flex flex-col">
      <Canvas />
      <LeftToolbar />
      <PropertyPanel />
      <TopMenuBar />
      <HistoryPanel />
    </div>
  );
}
