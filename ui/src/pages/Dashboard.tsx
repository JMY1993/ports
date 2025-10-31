import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Card } from '@/components/ui/card'

export default function Dashboard() {
  const { data: bindings = [], isLoading: bindingsLoading } = useQuery({
    queryKey: ['bindings'],
    queryFn: () => api.getBindings(),
  })

  const { data: templates = [], isLoading: templatesLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: () => api.getTemplates(),
  })

  const isLoading = bindingsLoading || templatesLoading

  if (isLoading) {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold mb-8">Dashboard</h1>
        <p className="text-slate-600">Loading...</p>
      </div>
    )
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8">Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Bindings Summary */}
        <Card className="p-6">
          <h2 className="text-xl font-semibold text-slate-900 mb-2">Port Bindings</h2>
          <p className="text-4xl font-bold text-blue-600 mb-2">{bindings.length}</p>
          <p className="text-sm text-slate-600">Total registered ports</p>

          {bindings.length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-200">
              <p className="text-xs font-semibold text-slate-500 mb-2 uppercase">Recent</p>
              <div className="space-y-2">
                {bindings.slice(0, 3).map((binding) => (
                  <div key={`${binding.project}-${binding.branch}-${binding.purpose}-${binding.name}`} className="text-sm text-slate-600">
                    <span className="font-mono font-semibold text-blue-600">{binding.port}</span>
                    {' '}
                    <span className="text-xs">
                      {binding.project} / {binding.branch}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* Templates Summary */}
        <Card className="p-6">
          <h2 className="text-xl font-semibold text-slate-900 mb-2">Template Strings</h2>
          <p className="text-4xl font-bold text-green-600 mb-2">{templates.length}</p>
          <p className="text-sm text-slate-600">Total template instances</p>

          {templates.length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-200">
              <p className="text-xs font-semibold text-slate-500 mb-2 uppercase">Recent</p>
              <div className="space-y-2">
                {templates.slice(0, 3).map((tmpl, idx) => (
                  <div key={idx} className="text-sm text-slate-600">
                    <span className="text-xs font-mono truncate block">{tmpl.template}</span>
                    <span className="text-xs text-slate-500">Value: <span className="font-mono">{tmpl.value}</span></span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Statistics */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="p-6">
          <p className="text-sm text-slate-600">Frontend Ports</p>
          <p className="text-3xl font-bold text-slate-900">
            {bindings.filter((b) => b.purpose === 'frontend').length}
          </p>
        </Card>
        <Card className="p-6">
          <p className="text-sm text-slate-600">Backend Ports</p>
          <p className="text-3xl font-bold text-slate-900">
            {bindings.filter((b) => b.purpose === 'backend').length}
          </p>
        </Card>
        <Card className="p-6">
          <p className="text-sm text-slate-600">Projects</p>
          <p className="text-3xl font-bold text-slate-900">
            {new Set(bindings.map((b) => b.project)).size}
          </p>
        </Card>
      </div>
    </div>
  )
}
