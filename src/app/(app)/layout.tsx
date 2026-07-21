import AppShell from "./app-shell";
import { ErrorBoundary } from "@/components/error-boundary";
import { ToastProvider } from "@/components/toast";
import { DocumentViewerProvider } from "@/contexts/document-viewer-context";
import { GlobalConfirmHost } from "@/components/global-confirm";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <DocumentViewerProvider>
          <AppShell>{children}</AppShell>
          <GlobalConfirmHost />
        </DocumentViewerProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
