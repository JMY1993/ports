import type { BindingItem, TemplateItem, ProcessInfo } from '@/types'

const API_BASE = '/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`)
  }

  return response.json()
}

export const api = {
  // Bindings
  async getBindings(filters?: Record<string, string>) {
    const params = new URLSearchParams(filters).toString()
    const path = `/bindings${params ? `?${params}` : ''}`
    const res = await request<{ success: boolean; data: BindingItem[] }>(path)
    return res.data
  },

  async deleteBinding(port: number) {
    return request(`/bindings/${port}`, { method: 'DELETE' })
  },

  async deleteBindingByKey(project: string, branch: string, purpose: string, name?: string) {
    return request('/bindings', {
      method: 'DELETE',
      body: JSON.stringify({ project, branch, purpose, name: name || 'default' }),
    })
  },

  // Templates
  async getTemplates(template?: string) {
    const params = template ? `?template=${encodeURIComponent(template)}` : ''
    const res = await request<{ success: boolean; data: TemplateItem[] }>(`/templates${params}`)
    return res.data
  },

  async deleteTemplate(template: string, vars: Record<string, string>) {
    return request('/templates', {
      method: 'DELETE',
      body: JSON.stringify({ template, vars }),
    })
  },

  // Process info
  async getProcessInfo(port: number) {
    const res = await request<{ success: boolean; data: ProcessInfo }>(`/process/${port}`)
    return res.data
  },

  // Health check
  async health() {
    return request<{ status: string }>('/health')
  },
}
