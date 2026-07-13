import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  surface: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Keep one broken surface from taking the editor and its recovery controls with it. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`DeNote ${this.props.surface} surface failed`, error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-sm" style={{ color: 'var(--fg-muted)' }}>
        <strong style={{ color: 'var(--fg)' }}>{this.props.surface} unavailable</strong>
        <span>{this.state.error.message || 'Unexpected rendering error.'}</span>
        <button type="button" className="rounded px-2 py-1 text-xs" style={{ border: '1px solid var(--border)' }} onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}
