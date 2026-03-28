import { MainContentPanel } from '../components/MainContentPanel'

const analyticsCards = [
  { label: 'Generated Clips', value: '128', detail: 'Across recent projects' },
  { label: 'Approved Rate', value: '64%', detail: 'Clips worth keeping' },
  { label: 'Scheduled Posts', value: '19', detail: 'Queued across platforms' },
  { label: 'Top Hook Type', value: 'Question', detail: 'Current best performer' }
]

export function AnalyticsPage() {
  return (
    <MainContentPanel>
      <div className="h-full overflow-y-auto p-8">
        <div className="max-w-6xl space-y-8">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-text-muted">Analytics</div>
            <h1 className="mt-2 text-3xl font-semibold text-text-primary">Performance</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-secondary">
              This surface should eventually close the loop between generated clips, scheduled posts, and what actually performs.
            </p>
          </div>

          <div className="grid grid-cols-4 gap-5">
            {analyticsCards.map((card) => (
              <div key={card.label} className="rounded-2xl border border-border-default bg-bg-secondary/60 p-5">
                <div className="text-sm text-text-muted">{card.label}</div>
                <div className="mt-3 text-4xl font-semibold text-text-primary">{card.value}</div>
                <div className="mt-2 text-sm text-text-secondary">{card.detail}</div>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-border-default bg-bg-secondary/40 p-6">
            <div className="text-lg font-semibold text-text-primary">Top Performing Patterns</div>
            <div className="mt-4 grid grid-cols-3 gap-4">
              <div className="rounded-xl border border-border-default bg-bg-primary/60 p-4 text-sm text-text-secondary">
                Hooks framed as questions are outperforming statements.
              </div>
              <div className="rounded-xl border border-border-default bg-bg-primary/60 p-4 text-sm text-text-secondary">
                One-line captions are outperforming dense subtitles.
              </div>
              <div className="rounded-xl border border-border-default bg-bg-primary/60 p-4 text-sm text-text-secondary">
                Clips under 45 seconds retain attention better than longer edits.
              </div>
            </div>
          </div>
        </div>
      </div>
    </MainContentPanel>
  )
}
