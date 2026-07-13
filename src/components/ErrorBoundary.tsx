// Root error boundary. Class component because only class components can catch
// render/lifecycle errors in their subtree via getDerivedStateFromError /
// componentDidCatch. It wraps the router AND the store, so it must NOT import or
// use either (a crashing provider would otherwise take the boundary down too).
//
// Note: React error boundaries do NOT catch errors thrown in event handlers or
// async callbacks — those never bubble through render. The reducer guards cover
// the dispatch path; this screen is the last-resort net for render-time crashes.
//
// Recovery is strictly user-triggered: nothing here clears data automatically.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { exportRawData, clearData } from '../store/storage';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Nieprzechwycony błąd renderowania:', error, info);
  }

  // Download the raw persisted JSON as a file. User-triggered only.
  private handleExport = (): void => {
    const raw = exportRawData();
    if (raw === null) return;
    const blob = new Blob([raw], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'n2hub-dane.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  private handleReload = (): void => {
    window.location.reload();
  };

  // Reset only behind an explicit confirm — never automatic.
  private handleReset = (): void => {
    if (
      window.confirm(
        'Na pewno usunąć wszystkie lokalne dane aplikacji? Tej operacji nie można cofnąć.',
      )
    ) {
      clearData();
      window.location.reload();
    }
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const canExport = exportRawData() !== null;

    return (
      <div className="crash-screen">
        <div className="crash-card">
          <h1 className="crash-title">Coś poszło nie tak</h1>
          <p className="crash-body">
            Aplikacja napotkała nieoczekiwany błąd. Możesz pobrać kopię danych
            zapisanych w przeglądarce, odświeżyć aplikację albo wyzerować dane,
            jeśli błąd się powtarza.
          </p>
          <div className="crash-actions">
            {canExport && (
              <button type="button" className="btn soft" onClick={this.handleExport}>
                Pobierz kopię danych (JSON)
              </button>
            )}
            <button type="button" className="btn primary" onClick={this.handleReload}>
              Odśwież aplikację
            </button>
            <button type="button" className="btn danger-ghost" onClick={this.handleReset}>
              Wyzeruj dane i zacznij od nowa
            </button>
          </div>
          <details className="crash-details">
            <summary>Szczegóły techniczne</summary>
            <pre>{error.message}</pre>
          </details>
        </div>
      </div>
    );
  }
}
