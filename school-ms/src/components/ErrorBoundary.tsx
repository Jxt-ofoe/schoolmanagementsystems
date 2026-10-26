import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './ui';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unhandled application error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="center-page" style={{ padding: 24, maxWidth: 600, margin: '40px auto' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>⚠️</div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: 8 }}>Something went wrong</h2>
          <p className="muted" style={{ marginBottom: 16 }}>
            {this.state.error?.message || 'An unexpected error occurred while loading this page.'}
          </p>
          <div style={{ display: 'flex', gap: 12 }}>
            <Button onClick={() => window.location.reload()}>Reload Page</Button>
            <Button variant="secondary" onClick={() => { this.setState({ hasError: false, error: null }); window.location.href = '/'; }}>
              Go to Home
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
