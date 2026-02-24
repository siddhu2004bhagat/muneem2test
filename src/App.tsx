import React from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "@/components/ErrorBoundary";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import { ReceiptView } from "@/features/reports/receipt/ReceiptView";
import { DailyReportView } from "@/features/reports/receipt/DailyReportView";

import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";

const queryClient = new QueryClient();

import { OCRTestDashboard } from "@/features/pen-input/ocr";

const AppContent = () => {
  useGlobalShortcuts();
  return (
    <Routes>
      <Route path="/" element={<Index />} />
      <Route path="/print/receipt/:id" element={<ReceiptView />} />
      <Route path="/print/daily-report" element={<DailyReportView />} />
      <Route path="/test/ocr" element={<OCRTestDashboard />} />
      {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <ErrorBoundary>
        <HashRouter>
          <AppContent />
        </HashRouter>
      </ErrorBoundary>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
