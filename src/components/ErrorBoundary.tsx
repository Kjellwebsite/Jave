import { Component, type ReactNode } from 'react';
import { Button, Label } from './ui';

interface State {
  error: Error | null;
}

/** Catches render and lazy-loading failures (e.g. a chunk that could not be fetched). */
export class ErrorBoundary extends Component<{ children: ReactNode; compact?: boolean }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override render() {
    if (!this.state.error) return this.props.children;
    const chunk = /dynamically imported module|Failed to fetch|Loading chunk/i.test(this.state.error.message);
    return (
      <div className={`error-box ${this.props.compact ? 'is-compact' : ''}`} role="alert">
        <Label>Something went wrong</Label>
        <p>
          {chunk
            ? 'Part of the application could not be loaded. Check your connection and reload. Your progress is saved.'
            : 'This part of the page failed. Your progress is saved; reloading replaces the open item with a new one.'}
        </p>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    );
  }
}
