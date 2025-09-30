import { MainContentPanel } from '../components/MainContentPanel'

export function ContentPage() {
  return (
    <MainContentPanel>
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-2xl w-full space-y-8 text-center">
          <div className="space-y-4">
            <div className="text-6xl text-text-muted">✏️</div>
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold text-text-primary">
                Content Creation
              </h1>
              <p className="text-text-muted">
                Generate titles, descriptions, and thumbnails for your clips
              </p>
            </div>
            <div className="text-sm text-text-muted mt-8">
              Coming soon - create engaging content packages for your approved clips
            </div>
          </div>
        </div>
      </div>
    </MainContentPanel>
  )
}