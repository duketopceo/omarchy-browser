import { Monitor } from 'lucide-react'
import type { FC } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useOmarchyMonitors } from '@/modules/omarchy/omarchy.hooks'

export const OmarchySettingsPage: FC = () => {
  const { data, isLoading, error } = useOmarchyMonitors()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12 text-muted-foreground text-sm">
        Loading Omarchy displays...
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 text-destructive text-sm">
        Unable to load Omarchy displays. Make sure you are running on Hyprland.
      </div>
    )
  }

  const monitors = data?.monitors ?? []

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-4 rounded-xl border p-5">
        <Monitor className="h-8 w-8 text-muted-foreground" />
        <div>
          <h2 className="font-semibold text-lg">Omarchy</h2>
          <p className="text-muted-foreground text-sm">
            Native Omarchy desktop settings and status
          </p>
        </div>
      </div>

      {monitors.length === 0 ? (
        <div className="rounded-xl border p-5 text-muted-foreground text-sm">
          No Hyprland displays found. Open this page from a Hyprland session on
          Omarchy.
        </div>
      ) : (
        monitors.map((monitor) => (
          <Card key={monitor.name}>
            <CardHeader>
              <CardTitle>{monitor.description || monitor.name}</CardTitle>
              <CardDescription>
                {monitor.width} x {monitor.height} @{' '}
                {monitor.refreshRate.toFixed(2)} Hz
                {monitor.focused ? ' · focused' : ''}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Scale</span>
                  <p className="font-medium">{monitor.scale}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Position</span>
                  <p className="font-medium">
                    {monitor.x}, {monitor.y}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">
                    Active workspace
                  </span>
                  <p className="font-medium">{monitor.activeWorkspace?.name}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Transform</span>
                  <p className="font-medium">{monitor.transform}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}
