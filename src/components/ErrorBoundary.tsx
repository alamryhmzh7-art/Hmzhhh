import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

export interface ErrorBoundaryProps {
  children: ReactNode;
  onReset?: () => void;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

// @ts-ignore
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  // @ts-ignore
  state: ErrorBoundaryState = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error caught by ErrorBoundary:', error, errorInfo);
    // @ts-ignore
    this.setState({ errorInfo });
  }

  handleReset = () => {
    // @ts-ignore
    this.setState({ hasError: false, error: null, errorInfo: null });
    // @ts-ignore
    if (this.props.onReset) {
      // @ts-ignore
      this.props.onReset();
    }
  };

  render() {
    // @ts-ignore
    if (this.state.hasError) {
      return (
        <div className="p-6 max-w-2xl mx-auto my-8 bg-slate-900 border border-rose-500/40 rounded-2xl shadow-2xl text-slate-100 font-sans">
          <div className="flex items-center gap-3 mb-4 text-rose-400">
            <AlertTriangle className="h-8 w-8 shrink-0 animate-bounce" />
            <div>
              <h2 className="text-lg font-bold">
                حدث خطأ غير متوقع في هذه الشاشة
              </h2>
              <p className="text-xs text-slate-400">
                An unexpected error occurred while rendering this page.
              </p>
            </div>
          </div>

          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs font-mono text-rose-300 mb-6 overflow-x-auto max-h-48 custom-scrollbar">
            {/* @ts-ignore */}
            <p className="font-bold">{this.state.error?.toString()}</p>
            {/* @ts-ignore */}
            {this.state.errorInfo?.componentStack && (
              <pre className="mt-2 text-[10px] text-slate-500 whitespace-pre-wrap">
                {/* @ts-ignore */}
                {this.state.errorInfo.componentStack}
              </pre>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={this.handleReset}
              className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg transition-all"
            >
              <Home className="h-4 w-4" />
              <span>العودة للوحة الرئيسية / Back to Dashboard</span>
            </button>

            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs flex items-center gap-2 border border-slate-700 transition-all"
            >
              <RefreshCw className="h-4 w-4" />
              <span>إعادة تحميل التطبيق / Reload App</span>
            </button>
          </div>
        </div>
      );
    }

    // @ts-ignore
    return this.props.children;
  }
}
