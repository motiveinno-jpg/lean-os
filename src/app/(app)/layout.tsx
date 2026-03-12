import AppShell from "./app-shell";
import { ErrorBoundary } from "@/components/error-boundary";
import { ToastProvider } from "@/components/toast";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AppShell>{children}</AppShell>
      </ToastProvider>
    </ErrorBoundary>
  );
}
