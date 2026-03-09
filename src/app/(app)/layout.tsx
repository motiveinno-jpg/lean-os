import AppShell from "./app-shell";
import { ErrorBoundary } from "@/components/error-boundary";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <AppShell>{children}</AppShell>
    </ErrorBoundary>
  );
}
