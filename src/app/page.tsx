import { MapErrorBoundary } from "@/components/MapErrorBoundary";
import { MapWorkspace } from "@/components/MapWorkspace";

export default function Home() {
  return (
    <main className="app-shell">
      <MapErrorBoundary><MapWorkspace /></MapErrorBoundary>
    </main>
  );
}
