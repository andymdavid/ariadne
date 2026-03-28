import { MainContentPanel } from '../components/MainContentPanel'

const templateSections = [
  {
    title: 'Clip layout settings',
    description: 'Default aspect ratio, framing, and clip presentation for generated reels.'
  },
  {
    title: 'Caption',
    description: 'Shared subtitle style, highlight behavior, sizing, and placement.'
  },
  {
    title: 'Overlay',
    description: 'Logo, CTA, and brand treatment applied automatically across clips.'
  },
  {
    title: 'Intro / outro',
    description: 'Reusable start and end treatments managed at the template level.'
  },
  {
    title: 'Music',
    description: 'Background track defaults, ducking, and transition behavior.'
  }
]

const aiDefaults = [
  'Remove filler words',
  'Remove pauses',
  'AI keywords highlighter',
  'AI emojis',
  'Auto-generate stock B-roll'
]

export function BrandTemplatePage() {
  return (
    <MainContentPanel>
      <div className="flex h-full overflow-hidden">
        <div className="w-[360px] border-r border-border-default p-6 overflow-y-auto flex-shrink-0">
          <div className="space-y-6">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-text-muted">Brand Template</div>
              <h1 className="mt-2 text-3xl font-semibold text-text-primary">Template Defaults</h1>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                Set the shared look and behavior for generated reels so clip-level editing becomes the exception.
              </p>
            </div>

            <div className="space-y-3">
              {templateSections.map((section) => (
                <button
                  key={section.title}
                  type="button"
                  className="w-full rounded-2xl border border-border-default bg-bg-secondary/70 p-4 text-left hover:bg-bg-secondary transition-colors"
                >
                  <div className="text-base font-medium text-text-primary">{section.title}</div>
                  <div className="mt-1 text-sm text-text-muted">{section.description}</div>
                </button>
              ))}
            </div>

            <div className="rounded-2xl border border-border-default bg-bg-secondary/50 p-4">
              <div className="text-sm font-semibold text-text-primary">AI Defaults</div>
              <div className="mt-3 space-y-2">
                {aiDefaults.map((item) => (
                  <div key={item} className="flex items-center justify-between rounded-xl border border-border-default bg-bg-primary/70 px-3 py-2">
                    <span className="text-sm text-text-primary">{item}</span>
                    <div className="h-6 w-11 rounded-full bg-bg-tertiary" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 p-8 flex items-center justify-center">
          <div className="w-full max-w-4xl h-full rounded-[32px] border border-border-default bg-bg-secondary/40 flex items-center justify-center">
            <div className="w-[280px] aspect-[9/16] rounded-[28px] border border-border-default bg-black flex items-center justify-center">
              <div className="text-center px-6">
                <div className="text-sm uppercase tracking-[0.2em] text-text-muted">Preview</div>
                <div className="mt-3 text-2xl font-semibold text-text-primary">Branded Reel</div>
                <div className="mt-2 text-sm leading-relaxed text-text-secondary">
                  This preview becomes the destination for standardized caption, frame, overlay, and music defaults.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </MainContentPanel>
  )
}
