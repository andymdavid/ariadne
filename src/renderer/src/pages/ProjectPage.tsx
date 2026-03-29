import { useParams } from 'react-router-dom'
import { MainContentPanel } from '../components/MainContentPanel'

export function ProjectPage() {
  const { id: _id } = useParams<{ id: string }>()

  return (
    <MainContentPanel>
      <div className="app-page">
        <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-4 p-8">
          <h1 className="text-2xl font-bold text-text-primary">Project {_id}</h1>
          <p className="max-w-2xl text-sm leading-6 text-text-secondary">
            A dedicated project management view is not available yet. Durable workflow state for this
            project lives in the processing, review, diagnostics, and export surfaces that already exist.
          </p>
        </div>
      </div>
    </MainContentPanel>
  )
}
