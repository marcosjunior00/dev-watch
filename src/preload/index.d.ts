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

export type AppAPI = {
  docker: {
    listRunningContainers: () => Promise<DockerContainer[]>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: AppAPI
  }
}
