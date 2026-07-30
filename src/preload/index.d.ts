import { ElectronAPI } from '@electron-toolkit/preload'

export type DockerContainer = {
  id: string
  image: string
  command: string
  createdAt: string
  runningFor: string
  ports: string
  state: string
  status: string
  name: string
  networks: string
  labels: Record<string, string>
  composeProject: string
  composeService: string
}

export type UsedPort = {
  protocol: 'TCP' | 'UDP'
  localAddress: string
  localPort: number
  remoteAddress: string
  remotePort: number | null
  state: string
  pid: number
  processName: string
  processPath: string
  commandLine: string
}

export type AppAPI = {
  docker: {
    listRunningContainers: () => Promise<DockerContainer[]>
  }
  system: {
    listUsedPorts: () => Promise<UsedPort[]>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: AppAPI
  }
}
