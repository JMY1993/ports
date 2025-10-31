import { Link, Outlet } from 'react-router'
import { Button } from '@/components/ui/button'

export default function Layout() {
  return (
    <div className="flex h-screen bg-slate-50">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 shadow-sm">
        <div className="p-6">
          <h1 className="text-2xl font-bold text-slate-900">Vibe Ports</h1>
          <p className="text-sm text-slate-500 mt-1">Port Management UI</p>
        </div>

        <nav className="px-3 py-6">
          <div className="space-y-2">
            <Link to="/">
              <Button variant="ghost" className="w-full justify-start">
                <span className="mr-2">📊</span>
                Dashboard
              </Button>
            </Link>
            <Link to="/ports">
              <Button variant="ghost" className="w-full justify-start">
                <span className="mr-2">🔌</span>
                Ports
              </Button>
            </Link>
            <Link to="/templates">
              <Button variant="ghost" className="w-full justify-start">
                <span className="mr-2">📋</span>
                Templates
              </Button>
            </Link>
          </div>
        </nav>

        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-slate-200 bg-slate-50">
          <p className="text-xs text-slate-500 text-center">
            Vibe Ports v0.4.1+
          </p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
