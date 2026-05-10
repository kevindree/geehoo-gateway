import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useProjects, useCreateProject, useDeleteProject, Project } from '../hooks/useProjects'
import { useAuth } from '../hooks/useAuth'

const STATUS_COLOR: Record<Project['status'], string> = {
  PROVISIONING: 'bg-yellow-100 text-yellow-800',
  ACTIVE: 'bg-green-100 text-green-800',
  SUSPENDED: 'bg-gray-100 text-gray-600',
  DELETING: 'bg-red-100 text-red-700',
  ERROR: 'bg-red-100 text-red-800',
}

export default function ProjectsPage() {
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>()
  const { user, memberships } = useAuth()
  const { data: projects, isLoading, error } = useProjects(workspaceSlug)
  const createProject = useCreateProject(workspaceSlug)
  const deleteProject = useDeleteProject(workspaceSlug)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', slug: '', description: '' })
  const [formError, setFormError] = useState<string | null>(null)

  const myRole = memberships.find((m) => m.workspace.slug === workspaceSlug)?.role
  const canManage = user?.systemRole === 'SUPER_ADMIN' || myRole === 'OWNER' || myRole === 'ADMIN'

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    try {
      await createProject.mutateAsync(form)
      setShowForm(false)
      setForm({ name: '', slug: '', description: '' })
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      setFormError(msg ?? 'Failed to create project')
    }
  }

  if (isLoading) return <p className="px-6 py-6 text-gray-500">Loading projects…</p>
  if (error) return <p className="px-6 py-6 text-red-600">Failed to load projects</p>

  return (
    <div className="px-6 py-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Projects</h1>
          <p className="text-xs text-gray-400 mt-0.5">Workspace: <span className="font-mono">{workspaceSlug}</span></p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowForm(true)}
            className="bg-indigo-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors">
            + New Project
          </button>
        )}
      </div>

      {showForm && (
        <div className="mb-6 bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="font-medium text-gray-900 mb-4">Create Project</h2>
          <form onSubmit={handleCreate} className="flex flex-col gap-3">
            <input required placeholder="Project name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <input required placeholder="Slug (lowercase, e.g. my-project)" pattern="^[a-z0-9-]+$"
              value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono" />
            <input placeholder="Description (optional)" value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <div className="bg-gray-50 rounded-lg p-2 text-xs text-gray-500 font-mono">
              API URL: /{workspaceSlug}/api/{form.slug || '«slug»'}/«route»
            </div>
            {formError && <p className="text-sm text-red-600">{formError}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={createProject.isPending}
                className="bg-indigo-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                {createProject.isPending ? 'Creating…' : 'Create'}
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="text-sm text-gray-500 px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
        {projects?.length === 0 && (
          <p className="text-gray-400 text-sm p-6">No projects yet. Create your first one!</p>
        )}
        {projects?.map((project) => (
          <div key={project.id} className="flex items-center justify-between p-4">
            <div className="flex items-center gap-4">
              <div>
                <Link to={`/w/${workspaceSlug}/projects/${project.id}`}
                  className="font-medium text-gray-900 hover:text-indigo-600 transition-colors">
                  {project.name}
                </Link>
                <p className="text-xs text-gray-400 mt-0.5">
                  {project.ingressPrefix} · {project._count?.routes ?? 0} routes
                </p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[project.status]}`}>
                {project.status}
              </span>
            </div>
            {canManage && (
              <button
                onClick={() => { if (confirm(`Delete project "${project.name}"?`)) deleteProject.mutate(project.id) }}
                className="text-xs text-red-500 hover:text-red-700 transition-colors">
                Delete
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
