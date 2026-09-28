import { MapErrorBoundary } from "@/components/MapErrorBoundary";
import { MapWorkspace } from "@/components/MapWorkspace";
import { connection } from "next/server";

export default async function Home() {
  await connection();
  return (
    <main className="app-shell">
      <MapErrorBoundary><MapWorkspace /></MapErrorBoundary>
    </main>
  );
}
