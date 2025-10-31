import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export default function PortsPage() {
  const queryClient = useQueryClient()
  const [selectedPort, setSelectedPort] = useState<number | null>(null)

  const { data: bindings = [], isLoading } = useQuery({
    queryKey: ['bindings'],
    queryFn: () => api.getBindings(),
    refetchInterval: 5000, // Refetch every 5 seconds
  })

  const { data: processInfo } = useQuery({
    queryKey: ['process', selectedPort],
    queryFn: () => (selectedPort ? api.getProcessInfo(selectedPort) : null),
    enabled: !!selectedPort,
  })

  const deleteMutation = useMutation({
    mutationFn: (port: number) => api.deleteBinding(port),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bindings'] })
      setSelectedPort(null)
    },
  })

  if (isLoading) {
    return <div className="p-8">Loading...</div>
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8">Port Bindings</h1>

      {bindings.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-slate-600">No port bindings found</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Port</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Purpose</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bindings.map((binding) => (
                <TableRow key={`${binding.project}-${binding.branch}-${binding.purpose}-${binding.name}`}>
                  <TableCell className="font-mono font-semibold">{binding.port}</TableCell>
                  <TableCell>{binding.project}</TableCell>
                  <TableCell className="text-sm text-slate-600">{binding.branch}</TableCell>
                  <TableCell>
                    <span className="inline-block px-2 py-1 rounded text-xs font-semibold bg-blue-100 text-blue-800">
                      {binding.purpose}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-slate-600">{binding.name}</TableCell>
                  <TableCell>
                    <button
                      onClick={() => setSelectedPort(binding.port)}
                      className="text-sm text-blue-600 hover:underline"
                    >
                      Check
                    </button>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => deleteMutation.mutate(binding.port)}
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

      {/* Process Info Dialog */}
      <Dialog open={!!selectedPort} onOpenChange={(open) => !open && setSelectedPort(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Process Information</DialogTitle>
            <DialogDescription>
              Details for port {selectedPort}
            </DialogDescription>
          </DialogHeader>

          {processInfo && (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-semibold text-slate-600">Status</p>
                <p className="text-lg font-mono">
                  {processInfo.status}
                  {processInfo.status === 'running' && ' ✓'}
                </p>
              </div>

              {processInfo.pid && (
                <div>
                  <p className="text-sm font-semibold text-slate-600">PID</p>
                  <p className="text-lg font-mono">{processInfo.pid}</p>
                </div>
              )}

              {processInfo.command && (
                <div>
                  <p className="text-sm font-semibold text-slate-600">Command</p>
                  <p className="text-sm font-mono bg-slate-100 p-2 rounded break-all">
                    {processInfo.command}
                  </p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
