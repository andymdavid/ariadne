import { MainContentPanel } from '../components/MainContentPanel'

const settingsSections = [
  {
    group: 'Style',
    items: [
      { title: 'Clip layout settings', value: '9:16 fill fit' },
      { title: 'Caption', value: 'One-line pop' }
    ]
  },
  {
    group: 'Brand',
    items: [
      { title: 'Overlay (logo, CTA)', value: 'overlay/orange' },
      { title: 'Intro / outro', value: 'Short brand sting' },
      { title: 'Music', value: 'Low ducking bed' }
    ]
  }
]

const aiDefaults = [
  'Remove filler words',
  'Remove pauses',
  'AI keywords highlighter',
  'AI emojis',
  'Auto-generate stock B-roll'
]

const captionPresets = [
  'No captions',
  'Karaoke',
  'Beasty',
  'Deep Diver',
  'Youshaei',
  'Pod P',
  'Mozi',
  'Popline'
]

export function BrandTemplatePage() {
  return (
    <MainContentPanel>
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-border-default px-8 py-5">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold text-text-primary">Brand template</h1>
              <span className="text-sm text-text-muted">Quickly setup your video template</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button className="rounded-full border border-border-default bg-bg-secondary px-5 py-2 text-sm text-text-primary">
              Preset template 1
            </button>
            <button className="rounded-xl bg-white px-5 py-2.5 text-sm font-medium text-black">
              Save template
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden p-6 gap-5">
          <div className="w-[320px] rounded-2xl border border-border-default bg-bg-secondary/60 overflow-hidden flex-shrink-0">
            <div className="border-b border-border-default px-5 py-4">
              <div className="text-2xl font-semibold text-text-primary">Setting</div>
            </div>

            <div className="h-full overflow-y-auto px-5 py-4 space-y-6">
              {settingsSections.map((section) => (
                <div key={section.group} className="space-y-3">
                  <div className="text-sm font-medium text-text-muted">{section.group}</div>
                  {section.items.map((item) => (
                    <button
                      key={item.title}
                      type="button"
                      className="flex w-full items-center justify-between rounded-xl border border-transparent px-3 py-3 text-left hover:border-border-default hover:bg-bg-primary/50 transition-colors"
                    >
                      <div>
                        <div className="text-base font-medium text-text-primary">{item.title}</div>
                      </div>
                      <div className="text-sm text-text-muted">{item.value}</div>
                    </button>
                  ))}
                </div>
              ))}

              <div className="space-y-3 pt-2">
                <div className="text-sm font-medium text-text-muted">AI</div>
                {aiDefaults.map((item) => (
                  <div
                    key={item}
                    className="flex items-center justify-between rounded-xl px-3 py-3 hover:bg-bg-primary/40 transition-colors"
                  >
                    <span className="text-base text-text-primary">{item}</span>
                    <div className="h-6 w-11 rounded-full bg-bg-primary border border-border-default" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="w-[300px] rounded-2xl border border-border-default bg-bg-secondary/60 overflow-hidden flex-shrink-0">
            <div className="border-b border-border-default px-5 py-4">
              <div className="text-2xl font-semibold text-text-primary">Caption</div>
              <div className="mt-3 flex gap-5 text-sm text-text-muted">
                <button className="text-text-primary">Presets</button>
                <button>Font</button>
                <button>Effects</button>
              </div>
            </div>

            <div className="h-full overflow-y-auto p-4">
              <div className="grid grid-cols-2 gap-4">
                {captionPresets.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={`rounded-2xl border p-3 text-left transition-colors ${
                      preset === 'Deep Diver'
                        ? 'border-white bg-white/10'
                        : 'border-border-default bg-bg-primary/40 hover:bg-bg-primary/70'
                    }`}
                  >
                    <div className="flex h-24 items-center justify-center rounded-xl bg-white/10 text-sm font-semibold text-text-primary">
                      {preset}
                    </div>
                    <div className="mt-3 text-center text-sm text-text-secondary">{preset}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="min-w-0 flex-1 rounded-2xl border border-border-default bg-bg-secondary/35 flex items-center justify-center">
            <div className="w-[300px] aspect-[9/16] rounded-[28px] border border-border-default bg-[#e8d3b7] relative overflow-hidden">
              <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-black/10 to-transparent" />
              <div className="absolute left-4 top-4 rounded-full bg-white/70 px-2 py-1 text-[10px] uppercase tracking-wide text-black/70">
                Demo
              </div>

              <div className="absolute inset-0 flex items-center justify-center px-10 text-center">
                <div>
                  <div className="text-4xl font-semibold text-black">Preview</div>
                  <div className="mt-6 inline-flex rounded-xl bg-white/80 px-5 py-3 text-2xl font-semibold text-black">
                    One line
                  </div>
                  <div className="mt-3 text-4xl">🥳</div>
                </div>
              </div>

              <div className="absolute bottom-4 left-4 right-4 h-1 rounded-full bg-black/15">
                <div className="h-full w-10 rounded-full bg-white/90" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </MainContentPanel>
  )
}
