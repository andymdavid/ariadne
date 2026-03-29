import { MainContentPanel } from '../components/MainContentPanel'

export function CalendarPage() {
  return (
    <MainContentPanel>
      <div className="app-page">
        <div className="flex h-full flex-col gap-6">
          <div className="app-page-header">
            <div className="mx-auto w-full max-w-6xl">
              <div className="app-page-header-content">
                <div className="app-page-title">Calendar</div>
                <div className="app-page-separator">|</div>
                <div className="app-page-subtitle">Scheduling is not available in the local app yet.</div>
              </div>
            </div>
          </div>

          <div className="mx-auto flex w-full max-w-6xl items-center justify-end gap-3">
            <button
              disabled
              className="cursor-not-allowed rounded-xl bg-white/50 px-4 py-2 text-sm font-medium text-black/60"
            >
              Schedule post
            </button>
            <button
              disabled
              className="cursor-not-allowed rounded-xl border border-border-default bg-bg-secondary/60 px-4 py-2 text-sm text-text-muted"
            >
              Upload local video
            </button>
          </div>

          <div className="mx-auto w-full max-w-4xl rounded-2xl border border-border-default bg-bg-secondary/50 p-8">
            <div className="text-lg font-semibold text-text-primary">Coming Soon</div>
            <div className="mt-3 max-w-2xl text-sm leading-6 text-text-secondary">
              Ariadne does not currently publish or schedule posts from the desktop app. This surface is
              reserved for a future scheduling workflow once real calendar-backed actions exist.
            </div>
            <div className="mt-6 rounded-xl border border-border-default bg-bg-primary/60 p-4 text-sm text-text-muted">
              The current local platform supports pipeline processing, review, content package generation,
              export, and workflow diagnostics. Scheduling controls stay disabled until they can perform
              real work.
            </div>
          </div>
        </div>
      </div>
    </MainContentPanel>
  )
}
