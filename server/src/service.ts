import { execSync } from 'child_process'
import type { BindingItem, TemplateItem, ProcessInfo } from './types.js'

function executeCommand(cmd: string): any {
  try {
    const output = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    return JSON.parse(output)
  } catch (error: any) {
    throw new Error(`Command failed: ${error.message}`)
  }
}

export const service = {
  // Bindings API
  async listBindings(filters?: { project?: string; branch?: string; purpose?: string; name?: string }): Promise<BindingItem[]> {
    const cmd = 'npx vibe-ports@latest list --json'
    const result = executeCommand(cmd)
    let items = result.items || []

    // Apply filters
    if (filters?.project) items = items.filter((i: BindingItem) => i.project === filters.project)
    if (filters?.branch) items = items.filter((i: BindingItem) => i.branch === filters.branch)
    if (filters?.purpose) items = items.filter((i: BindingItem) => i.purpose === filters.purpose)
    if (filters?.name) items = items.filter((i: BindingItem) => i.name === filters.name)

    return items
  },

  async deleteBinding(port: number): Promise<boolean> {
    const cmd = `npx vibe-ports@latest delete --port ${port} --json`
    try {
      const result = executeCommand(cmd)
      return result.deleted || false
    } catch {
      return false
    }
  },

  async deleteBindingByKey(project: string, branch: string, purpose: string, name: string = 'default'): Promise<boolean> {
    const cmd = `npx vibe-ports@latest delete -p "${project}" -b "${branch}" -u "${purpose}" -n "${name}" --json`
    try {
      const result = executeCommand(cmd)
      return result.deleted || false
    } catch {
      return false
    }
  },

  // Templates API
  async listTemplates(template?: string): Promise<TemplateItem[]> {
    const cmd = `npx vibe-ports@latest tmpl list --json`
    const result = executeCommand(cmd)
    let items = result.items || []

    if (template) {
      items = items.filter((i: TemplateItem) => i.template === template)
    }

    return items
  },

  async deleteTemplate(template: string, vars: Record<string, string>): Promise<boolean> {
    const varArgs = Object.entries(vars)
      .map(([key, value]) => `--${key} "${value}"`)
      .join(' ')
    const cmd = `npx vibe-ports@latest tmpl delete --template "${template}" ${varArgs} --json`
    try {
      executeCommand(cmd)
      return true
    } catch {
      return false
    }
  },

  // Process info
  async getProcessInfo(port: number): Promise<ProcessInfo> {
    try {
      // Try lsof first (most common on Linux/macOS)
      const lsofOutput = execSync(`lsof -i :${port} -n -P`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
      const lines = lsofOutput.trim().split('\n')
      if (lines.length > 1) {
        const parts = lines[1].split(/\s+/)
        const pid = parseInt(parts[1], 10)
        const cmd = parts[8]

        // Get process details from ps
        const psOutput = execSync(`ps -p ${pid} -o pid,cmd=`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
        const psLine = psOutput.trim().split('\n')[1]
        const psCommand = psLine?.split(/\s+/).slice(1).join(' ') || cmd

        return {
          pid,
          command: psCommand,
          status: 'running',
        }
      }
    } catch {
      // Fall back to netstat if lsof fails
      try {
        const netstatOutput = execSync(`ss -tlnp | grep :${port}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
        if (netstatOutput.includes(`${port}`)) {
          return {
            status: 'listening',
          }
        }
      } catch {
        // Port is not listening
      }
    }

    return {
      status: 'not_listening',
    }
  },
}
