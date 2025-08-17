import { useParams } from 'react-router-dom'

export function ProjectPage() {
  const { id: _id } = useParams<{ id: string }>()

  return (
    <div className="flex-1 p-8">
      <h1 className="text-2xl font-bold text-text-primary mb-4">
        Project: {_id}
      </h1>
      <p className="text-text-secondary">
        Project details and management interface will be implemented here.
      </p>
    </div>
  )
}