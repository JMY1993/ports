import { Hono } from 'hono'
import { service } from './service.js'
import type { ApiResponse, BindingItem, TemplateItem } from './types.js'

export const routes = new Hono()

// Bindings routes
routes.get('/api/bindings', async (c) => {
  try {
    const filters = {
      project: c.req.query('project'),
      branch: c.req.query('branch'),
      purpose: c.req.query('purpose'),
      name: c.req.query('name'),
    }
    const bindings = await service.listBindings(filters)
    return c.json({ success: true, data: bindings } as ApiResponse<BindingItem[]>)
  } catch (error: any) {
    return c.json({ success: false, error: error.message } as ApiResponse<null>, 500)
  }
})

routes.delete('/api/bindings/:port', async (c) => {
  try {
    const port = parseInt(c.req.param('port'), 10)
    if (isNaN(port)) {
      return c.json({ success: false, error: 'Invalid port number' } as ApiResponse<null>, 400)
    }
    const deleted = await service.deleteBinding(port)
    return c.json({ success: deleted, data: { deleted } } as ApiResponse<{ deleted: boolean }>)
  } catch (error: any) {
    return c.json({ success: false, error: error.message } as ApiResponse<null>, 500)
  }
})

routes.delete('/api/bindings', async (c) => {
  try {
    const { project, branch, purpose, name = 'default' } = await c.req.json()
    if (!project || !branch || !purpose) {
      return c.json({ success: false, error: 'Missing required fields' } as ApiResponse<null>, 400)
    }
    const deleted = await service.deleteBindingByKey(project, branch, purpose, name)
    return c.json({ success: deleted, data: { deleted } } as ApiResponse<{ deleted: boolean }>)
  } catch (error: any) {
    return c.json({ success: false, error: error.message } as ApiResponse<null>, 500)
  }
})

// Templates routes
routes.get('/api/templates', async (c) => {
  try {
    const template = c.req.query('template')
    const templates = await service.listTemplates(template)
    return c.json({ success: true, data: templates } as ApiResponse<TemplateItem[]>)
  } catch (error: any) {
    return c.json({ success: false, error: error.message } as ApiResponse<null>, 500)
  }
})

routes.delete('/api/templates', async (c) => {
  try {
    const { template, vars } = await c.req.json()
    if (!template || !vars) {
      return c.json({ success: false, error: 'Missing template or vars' } as ApiResponse<null>, 400)
    }
    const deleted = await service.deleteTemplate(template, vars)
    return c.json({ success: deleted, data: { deleted } } as ApiResponse<{ deleted: boolean }>)
  } catch (error: any) {
    return c.json({ success: false, error: error.message } as ApiResponse<null>, 500)
  }
})

// Process info route
routes.get('/api/process/:port', async (c) => {
  try {
    const port = parseInt(c.req.param('port'), 10)
    if (isNaN(port)) {
      return c.json({ success: false, error: 'Invalid port number' } as ApiResponse<null>, 400)
    }
    const info = await service.getProcessInfo(port)
    return c.json({ success: true, data: info })
  } catch (error: any) {
    return c.json({ success: false, error: error.message } as ApiResponse<null>, 500)
  }
})

// Health check
routes.get('/api/health', (c) => {
  return c.json({ status: 'ok' })
})
