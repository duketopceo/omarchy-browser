import type { HyprlandMonitor } from '@browseros/omarchy'
import { useQuery } from '@tanstack/react-query'
import { getAgentServerUrl } from '@/lib/browseros/helpers'

interface OmarchyMonitorsResponse {
  monitors: HyprlandMonitor[]
}

const OMARCHY_MONITORS_QUERY_KEY = ['omarchy', 'monitors']

async function fetchOmarchyMonitors(): Promise<OmarchyMonitorsResponse> {
  const baseUrl = await getAgentServerUrl()
  const response = await fetch(`${baseUrl}/omarchy/monitors`)
  if (!response.ok) {
    throw new Error(`Failed to fetch Omarchy displays: ${response.status}`)
  }
  return response.json()
}

export function useOmarchyMonitors() {
  return useQuery<OmarchyMonitorsResponse>({
    queryKey: OMARCHY_MONITORS_QUERY_KEY,
    queryFn: fetchOmarchyMonitors,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
    retry: 1,
  })
}
