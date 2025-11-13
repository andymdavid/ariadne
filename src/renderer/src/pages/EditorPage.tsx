import { MainContentPanel } from '../components/MainContentPanel'

export function ContentPage() {
  return (
    <MainContentPanel>
      <div className="flex-1 flex items-center justify-center p-12">
        <div className="w-full max-w-2xl text-center space-y-6">
          <div className="space-y-3">
            <div className="text-6xl">🧩</div>
            <h1 className="text-2xl font-semibold text-text-primary">Content workspace</h1>
            <p className="text-text-secondary">
              This area will soon house the upcoming content tools. For now it&rsquo;s intentionally empty so
              we can build the next feature on a clean canvas.
            </p>
          </div>

          <div className="border border-dashed border-border-default rounded-xl p-10 bg-bg-tertiary/30">
            <p className="text-sm text-text-muted">
              Nothing to do here just yet. Head back to Review or the Edit Clip modal to keep working while we
              prepare this panel for the next release.
            </p>
          </div>
        </div>
      </div>
    </MainContentPanel>
  )
}
