import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/app-icon.png?asset'

const execFileAsync = promisify(execFile)

type DockerPsRow = {
  ID?: string
  Image?: string
  Command?: string
  CreatedAt?: string
  RunningFor?: string
  Ports?: string
  State?: string
  Status?: string
  Names?: string
  Networks?: string
  Labels?: string
}

type DockerContainer = {
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

type UsedPort = {
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

type UsedPortRow = Partial<UsedPort>

function parseDockerLabels(labels: string): Record<string, string> {
  return labels.split(',').reduce<Record<string, string>>((parsedLabels, label) => {
    const separatorIndex = label.indexOf('=')

    if (separatorIndex === -1) {
      return parsedLabels
    }

    const key = label.slice(0, separatorIndex).trim()
    const value = label.slice(separatorIndex + 1).trim()

    if (key) {
      parsedLabels[key] = value
    }

    return parsedLabels
  }, {})
}

function parseDockerPsOutput(stdout: string): DockerContainer[] {
  return stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as DockerPsRow)
    .map((container) => {
      const labels = parseDockerLabels(container.Labels ?? '')

      return {
        id: container.ID ?? '',
        image: container.Image ?? '',
        command: container.Command ?? '',
        createdAt: container.CreatedAt ?? '',
        runningFor: container.RunningFor ?? '',
        ports: container.Ports ?? '',
        state: container.State ?? '',
        status: container.Status ?? '',
        name: container.Names ?? '',
        networks: container.Networks ?? '',
        labels,
        composeProject: labels['com.docker.compose.project'] ?? '',
        composeService: labels['com.docker.compose.service'] ?? ''
      }
    })
}

async function listRunningDockerContainers(): Promise<DockerContainer[]> {
  try {
    const { stdout } = await execFileAsync('docker', ['ps', '--format', '{{json .}}'], {
      windowsHide: true,
      timeout: 15000,
      maxBuffer: 1024 * 1024 * 5
    })

    return parseDockerPsOutput(stdout)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Erro desconhecido ao executar docker ps.'
    throw new Error(`Não foi possível listar os containers em execução. ${message}`)
  }
}

function parseUsedPortsOutput(stdout: string): UsedPort[] {
  if (!stdout.trim()) {
    return []
  }

  const parsedOutput = JSON.parse(stdout) as UsedPortRow | UsedPortRow[]
  const rows = Array.isArray(parsedOutput) ? parsedOutput : [parsedOutput]

  return rows.map((port) => ({
    protocol: port.protocol === 'UDP' ? 'UDP' : 'TCP',
    localAddress: port.localAddress ?? '',
    localPort: Number(port.localPort ?? 0),
    remoteAddress: port.remoteAddress ?? '',
    remotePort:
      port.remotePort === null || port.remotePort === undefined ? null : Number(port.remotePort),
    state: port.state ?? '',
    pid: Number(port.pid ?? 0),
    processName: port.processName ?? '',
    processPath: port.processPath ?? '',
    commandLine: port.commandLine ?? ''
  }))
}

async function listUsedPorts(): Promise<UsedPort[]> {
  if (process.platform !== 'win32') {
    throw new Error('A leitura detalhada de portas ainda está disponível apenas no Windows.')
  }

  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$commandLines = @{}
try {
  Get-CimInstance Win32_Process | ForEach-Object {
    $commandLines[[int]$_.ProcessId] = [string]$_.CommandLine
  }
} catch {}

function Get-ProcessInfo($processId) {
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  $path = ''
  if ($process) {
    try { $path = [string]$process.Path } catch {}
  }

  return @{
    Name = if ($process) { [string]$process.ProcessName } else { '' }
    Path = $path
    CommandLine = if ($commandLines.ContainsKey([int]$processId)) { [string]$commandLines[[int]$processId] } else { '' }
  }
}

$tcpPorts = Get-NetTCPConnection | ForEach-Object {
  $info = Get-ProcessInfo $_.OwningProcess
  [PSCustomObject]@{
    protocol = 'TCP'
    localAddress = [string]$_.LocalAddress
    localPort = [int]$_.LocalPort
    remoteAddress = [string]$_.RemoteAddress
    remotePort = [int]$_.RemotePort
    state = [string]$_.State
    pid = [int]$_.OwningProcess
    processName = $info.Name
    processPath = $info.Path
    commandLine = $info.CommandLine
  }
}

$udpPorts = Get-NetUDPEndpoint | ForEach-Object {
  $info = Get-ProcessInfo $_.OwningProcess
  [PSCustomObject]@{
    protocol = 'UDP'
    localAddress = [string]$_.LocalAddress
    localPort = [int]$_.LocalPort
    remoteAddress = ''
    remotePort = $null
    state = 'Em uso'
    pid = [int]$_.OwningProcess
    processName = $info.Name
    processPath = $info.Path
    commandLine = $info.CommandLine
  }
}

@($tcpPorts + $udpPorts) |
  Sort-Object localPort, protocol, processName |
  ConvertTo-Json -Depth 4 -Compress
`

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      {
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 1024 * 1024 * 20
      }
    )

    return parseUsedPortsOutput(stdout)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Erro desconhecido ao consultar portas em uso.'
    throw new Error(`Não foi possível listar as portas em uso. ${message}`)
  }
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    show: false,
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.devwatch.app')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))
  ipcMain.handle('docker:list-running-containers', listRunningDockerContainers)
  ipcMain.handle('system:list-used-ports', listUsedPorts)

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
