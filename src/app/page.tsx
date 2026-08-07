"use client";

import React, { useState } from 'react';
import { useAgent } from "../context/AgentContext";
import { LandingPage } from "../components/landing/LandingPage";
import { InitModal } from "../components/dashboard/InitModal";
import { DashboardLayout } from "../components/dashboard/DashboardLayout";
import { DashboardOverview } from "../components/dashboard/DashboardOverview";
import { FeedView } from "../components/dashboard/FeedView";
import { MemoryEngine } from "../components/dashboard/MemoryEngine";
import { EditorialDecisions } from "../components/dashboard/EditorialDecisions";
import { DiscoveryQueue } from "../components/dashboard/DiscoveryQueue";
import { AnalyticsView } from "../components/dashboard/AnalyticsView";
import { SettingsView } from "../components/dashboard/SettingsView";

export default function Home() {
  const { isInitialized, activeTab } = useAgent();
  const [isInitModalOpen, setIsInitModalOpen] = useState(false);

  // If not initialized, show the landing page and the initialization modal
  if (!isInitialized) {
    return (
      <div className="min-h-screen w-screen bg-[#050816]">
        <LandingPage onStartInit={() => setIsInitModalOpen(true)} />
        <InitModal isOpen={isInitModalOpen} onClose={() => setIsInitModalOpen(false)} />
      </div>
    );
  }

  // If initialized, show the sidebar dashboard command center
  return (
    <DashboardLayout>
      {activeTab === 'dashboard' && <DashboardOverview />}
      {activeTab === 'feed' && <FeedView />}
      {activeTab === 'memory' && <MemoryEngine />}
      {activeTab === 'decisions' && <EditorialDecisions />}
      {activeTab === 'queue' && <DiscoveryQueue />}
      {activeTab === 'analytics' && <AnalyticsView />}
      {activeTab === 'settings' && <SettingsView />}
    </DashboardLayout>
  );
}
