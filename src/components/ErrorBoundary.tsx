import React from 'react';

interface State { error: Error | null }

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error('ErrorBoundary:', error, info);
    }

    render() {
        if (!this.state.error) return this.props.children;
        return (
            <div style={{ padding: 24, fontFamily: 'system-ui', maxWidth: 720, margin: '40px auto' }}>
                <h2 style={{ color: '#dc2626' }}>Algo quebrou nesta tela</h2>
                <p>Mande este texto para o suporte:</p>
                <pre style={{ background: '#f3f4f6', padding: 12, borderRadius: 8, overflow: 'auto', fontSize: 12 }}>
{String(this.state.error?.message || this.state.error)}
{'\n\n'}
{this.state.error?.stack}
                </pre>
                <button
                    onClick={() => { this.setState({ error: null }); location.reload(); }}
                    style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #d1d5db', cursor: 'pointer' }}
                >
                    Recarregar
                </button>
            </div>
        );
    }
}
