"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { hasError: boolean };

export class MapErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };
  static getDerivedStateFromError(): State { return { hasError: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Map workspace failed to render", error, info); }
  render() {
    if (this.state.hasError) return <div className="map-status" role="alert">The map workspace could not be displayed. Reload the page to try again.</div>;
    return this.props.children;
  }
}
