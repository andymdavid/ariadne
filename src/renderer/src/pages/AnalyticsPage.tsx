import { MainContentPanel } from '../components/MainContentPanel'

export function AnalyticsPage() {
  return (
    <MainContentPanel>
      <div className="app-page">
        <div className="flex h-full flex-col gap-8">
          <div className="app-page-header">
            <div className="mx-auto w-full max-w-6xl">
              <div className="app-page-header-content">
                <div className="app-page-title">Analytics</div>
                <div className="app-page-separator">|</div>
                <div className="app-page-subtitle">
                  Performance analytics are not available in the local app yet.
                </div>
              </div>
            </div>
          </div>

          <div className="mx-auto w-full max-w-4xl rounded-2xl border border-border-default bg-bg-secondary/40 p-8">
            <div className="text-lg font-semibold text-text-primary">Coming Soon</div>
            <div className="mt-3 max-w-2xl text-sm leading-6 text-text-secondary">
              Ariadne currently supports durable pipeline runs, export state, and workflow diagnostics.
              Post-performance analytics, approval trends, and scheduling outcomes are not tracked in this
              local platform yet.
            </div>
            <div className="mt-6 rounded-xl border border-border-default bg-bg-primary/60 p-4 text-sm text-text-muted">
              Use the Review page to inspect versioned pipeline runs and workflow diagnostics. This page
              will stay intentionally lightweight until real analytics data is available.
            </div>
          </div>
        </div>
      </div>
    </MainContentPanel>
  )
}
