import { MainContentPanel } from '../components/MainContentPanel'

const assetGroups = [
  {
    title: 'Brand Vocabulary',
    description: 'Proper nouns, approved terms, and language rules for captions and hooks.'
  },
  {
    title: 'Censored Words',
    description: 'Words and replacement rules used across generated captions.'
  },
  {
    title: 'Fonts',
    description: 'Reusable type choices for your brand template.'
  },
  {
    title: 'Media',
    description: 'Logos, overlays, music, and reusable media assets.'
  }
]

export function AssetLibraryPage() {
  return (
    <MainContentPanel>
      <div className="h-full overflow-y-auto p-8">
        <div className="max-w-6xl space-y-8">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-text-muted">Asset Library</div>
            <h1 className="mt-2 text-3xl font-semibold text-text-primary">Reusable Brand Assets</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-secondary">
              Centralize the assets and language rules used by every generated clip instead of uploading or styling them one by one.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-5">
            {assetGroups.map((group) => (
              <div
                key={group.title}
                className="rounded-2xl border border-border-default bg-bg-secondary/60 p-6"
              >
                <div className="text-xl font-semibold text-text-primary">{group.title}</div>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary">{group.description}</p>
                <div className="mt-6 h-32 rounded-xl border border-dashed border-border-default bg-bg-primary/50 flex items-center justify-center text-sm text-text-muted">
                  Add or manage assets here
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </MainContentPanel>
  )
}
