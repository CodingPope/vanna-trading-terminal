import { Component, type ReactNode } from 'react';
export class PanelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div role="alert" className="p-4 text-sm"><p>This panel could not render. Other panels remain available.</p><button className="desk-button mt-3" onClick={() => this.setState({ failed: false })}>Retry panel</button></div>;
    return this.props.children;
  }
}
