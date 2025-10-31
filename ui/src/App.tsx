import { BrowserRouter, Routes, Route } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import queryClient from './lib/queryClient'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import PortsPage from './pages/PortsPage'
import TemplatesPage from './pages/TemplatesPage'
import './App.css'

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/ports" element={<PortsPage />} />
            <Route path="/templates" element={<TemplatesPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App
