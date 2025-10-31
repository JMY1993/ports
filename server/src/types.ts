// API Response types
export interface BindingItem {
  project: string
  branch: string
  purpose: string
  name: string
  port: number
  created_at: string
  updated_at: string
}

export interface TemplateItem {
  template: string
  vars: Record<string, string>
  value: string
  created_at: string
}

export interface ProcessInfo {
  pid?: number
  command?: string
  status?: string
  memory?: string
  cpu?: string
}

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}
