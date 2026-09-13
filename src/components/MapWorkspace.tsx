"use client";

import { useMemo, useState } from "react";
import { MapCanvas, type CameraCommand } from "./MapCanvas";
import { setLayerVisibility } from "@/map/layer-registry";
import { TEST_NETWORK_LAYER_ID, testNetworkRegistry } from "@/map/test-network";

export function MapWorkspace() {
  const [networkVisible, setNetworkVisible] = useState(true);
  const [projection, setProjection] = useState<"mercator" | "globe">("mercator");
  const [cameraCommand, setCameraCommand] = useState<CameraCommand | null>(null);
  const registry = useMemo(() => setLayerVisibility(testNetworkRegistry, TEST_NETWORK_LAYER_ID, networkVisible), [networkVisible]);
  function runCameraCommand(type: CameraCommand["type"]) { setCameraCommand((current) => ({ id: (current?.id ?? 0) + 1, type })); }

  return (
    <section className="map-workspace" aria-label="Physarum map workspace">
      <MapCanvas cameraCommand={cameraCommand} projection={projection} registry={registry} />
      <aside className="map-panel" aria-label="Map controls">
        <h1>Physarum Transport Model 2.0</h1>
        <p>MapLibre foundation · Lviv test network</p>
        <div className="control-row" aria-label="Camera controls">
          <button className="control-button" type="button" aria-label="Zoom in" onClick={() => runCameraCommand("zoom-in")}>+</button>
          <button className="control-button" type="button" aria-label="Zoom out" onClick={() => runCameraCommand("zoom-out")}>−</button>
          <button className="control-button" type="button" aria-label="Reset view" onClick={() => runCameraCommand("reset")}>↺</button>
          <button className="control-button projection-button" type="button" aria-label={`Switch to ${projection === "mercator" ? "globe" : "Mercator"} projection`} onClick={() => setProjection((current) => current === "mercator" ? "globe" : "mercator")}>{projection === "mercator" ? "Globe" : "Mercator"}</button>
        </div>
        <label className="control-row layer-toggle"><span>Test network</span><input type="checkbox" checked={networkVisible} onChange={(event) => setNetworkVisible(event.target.checked)} /></label>
      </aside>
    </section>
  );
}
