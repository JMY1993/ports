import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export default function TemplatesPage() {
  const queryClient = useQueryClient()

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: () => api.getTemplates(),
    refetchInterval: 5000,
  })

  const deleteMutation = useMutation({
    mutationFn: (item: { template: string; vars: Record<string, string> }) =>
      api.deleteTemplate(item.template, item.vars),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
    },
  })

  if (isLoading) {
    return <div className="p-8">Loading...</div>
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8">Template Strings</h1>

      {templates.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-slate-600">No template instances found</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Template</TableHead>
                <TableHead>Variables</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-20 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((tmpl, idx) => (
                <TableRow key={idx}>
                  <TableCell className="font-mono text-sm">{tmpl.template}</TableCell>
                  <TableCell className="text-sm text-slate-600">
                    <div className="space-y-1">
                      {Object.entries(tmpl.vars).map(([key, value]) => (
                        <div key={key}>
                          <span className="font-semibold">{key}</span>: {value}
                        </div>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm bg-slate-50 p-2">
                    {tmpl.value}
                  </TableCell>
                  <TableCell className="text-sm text-slate-600">
                    {new Date(tmpl.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() =>
                        deleteMutation.mutate({
                          template: tmpl.template,
                          vars: tmpl.vars,
                        })
                      }
                      disabled={deleteMutation.isPending}
                    >
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  )
}
