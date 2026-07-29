import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'

type DockerContainer = Awaited<ReturnType<Window['api']['docker']['listRunningContainers']>>[number]

type LoadStatus = 'idle' | 'loading' | 'success' | 'error'

type ContainerGroupType = 'compose' | 'network'

type ContainerGroup = {
  id: string
  name: string
  type: ContainerGroupType
  network: string
  containers: DockerContainer[]
  firstIndex: number
}

type ContainerListItem =
  | {
      type: 'container'
      container: DockerContainer
      firstIndex: number
    }
  | {
      type: 'group'
      group: ContainerGroup
      firstIndex: number
    }

const durationUnits = {
  second: ['segundo', 'segundos'],
  minute: ['minuto', 'minutos'],
  hour: ['hora', 'horas'],
  day: ['dia', 'dias'],
  week: ['semana', 'semanas'],
  month: ['mês', 'meses'],
  year: ['ano', 'anos']
} as const

type DurationUnit = keyof typeof durationUnits

function getDurationUnitLabel(unit: DurationUnit, amount: number): string {
  const [singular, plural] = durationUnits[unit]
  return amount === 1 ? singular : plural
}

function translateDuration(value: string): string {
  if (!value) return ''

  const hasAgoSuffix = /\sago\b/i.test(value)
  let translated = value.trim().replace(/\sago\b/i, '')

  translated = translated.replace(/\bless than a second\b/gi, 'menos de um segundo')

  translated = translated.replace(
    /\babout\s+an?\s+(second|minute|hour|day|week|month|year)s?\b/gi,
    (_, unit: DurationUnit) => `cerca de 1 ${getDurationUnitLabel(unit, 1)}`
  )

  translated = translated.replace(
    /\ban?\s+(second|minute|hour|day|week|month|year)s?\b/gi,
    (_, unit: DurationUnit) => `1 ${getDurationUnitLabel(unit, 1)}`
  )

  translated = translated.replace(
    /(\d+)\s+(second|minute|hour|day|week|month|year)s?\b/gi,
    (_, amount: string, unit: DurationUnit) => {
      const numericAmount = Number(amount)
      return `${amount} ${getDurationUnitLabel(unit, numericAmount)}`
    }
  )

  if (hasAgoSuffix || /^\d+|^cerca de|^menos de/i.test(translated)) {
    return `há ${translated}`
  }

  return translated
}

function translateDockerStatus(value: string): string {
  if (!value) return ''

  let translated = value.trim()
  translated = translated.replace(/\(healthy\)/gi, '(saudável)')
  translated = translated.replace(/\(unhealthy\)/gi, '(não saudável)')
  translated = translated.replace(/\(health: starting\)/gi, '(saúde: iniciando)')
  translated = translated.replace(/\(starting\)/gi, '(iniciando)')

  translated = translated.replace(/^Up\s+(.+)$/i, (_, duration: string) => {
    return `Rodando ${translateDuration(duration)}`
  })

  translated = translated.replace(
    /^Exited\s+\((\d+)\)\s+(.+)$/i,
    (_, code: string, duration: string) => {
      return `Encerrado (código ${code}) ${translateDuration(duration)}`
    }
  )

  translated = translated.replace(/^Created$/i, 'Criado')
  translated = translated.replace(/^Restarting\s+(.+)$/i, (_, duration: string) => {
    return `Reiniciando ${translateDuration(duration)}`
  })
  translated = translated.replace(/^Paused\s+(.+)$/i, (_, duration: string) => {
    return `Pausado ${translateDuration(duration)}`
  })
  translated = translated.replace(/^Dead$/i, 'Inativo')
  translated = translated.replace(/^Removal In Progress$/i, 'Remoção em andamento')

  return translated
}

function getPrimaryNetwork(networks: string): string {
  return (
    networks
      .split(',')
      .map((network) => network.trim())
      .find(Boolean) ?? ''
  )
}

function getGroupTypeLabel(type: ContainerGroupType): string {
  return type === 'compose' ? 'Compose' : 'Rede'
}

function getGroupInfo(
  container: DockerContainer
): Pick<ContainerGroup, 'id' | 'name' | 'type' | 'network'> | null {
  const primaryNetwork = getPrimaryNetwork(container.networks)

  if (container.composeProject) {
    return {
      id: `compose:${container.composeProject}`,
      name: container.composeProject,
      type: 'compose',
      network: primaryNetwork
    }
  }

  if (primaryNetwork && !['bridge', 'host', 'none'].includes(primaryNetwork)) {
    return {
      id: `network:${primaryNetwork}`,
      name: primaryNetwork,
      type: 'network',
      network: primaryNetwork
    }
  }

  return null
}

function getContainerDisplayName(container: DockerContainer): string {
  return container.composeService || container.name || '-'
}

function buildContainerList(containers: DockerContainer[]): ContainerListItem[] {
  const groups = new Map<string, ContainerGroup>()
  const standaloneItems: ContainerListItem[] = []

  containers.forEach((container, index) => {
    const groupInfo = getGroupInfo(container)

    if (!groupInfo) {
      standaloneItems.push({
        type: 'container',
        container,
        firstIndex: index
      })
      return
    }

    const group = groups.get(groupInfo.id)

    if (group) {
      group.containers.push(container)
      return
    }

    groups.set(groupInfo.id, {
      ...groupInfo,
      containers: [container],
      firstIndex: index
    })
  })

  const groupedItems = Array.from(groups.values()).flatMap<ContainerListItem>((group) => {
    if (group.type === 'network' && group.containers.length === 1) {
      return [
        {
          type: 'container',
          container: group.containers[0],
          firstIndex: group.firstIndex
        }
      ]
    }

    return [
      {
        type: 'group',
        group,
        firstIndex: group.firstIndex
      }
    ]
  })

  return [...standaloneItems, ...groupedItems].sort((a, b) => a.firstIndex - b.firstIndex)
}

function App(): React.JSX.Element {
  const [containers, setContainers] = useState<DockerContainer[]>([])
  const [status, setStatus] = useState<LoadStatus>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => new Set())

  const isLoading = status === 'loading'

  const containerCountLabel = useMemo(() => {
    const count = containers.length
    return count === 1 ? '1 container rodando' : `${count} containers rodando`
  }, [containers.length])

  const containerList = useMemo(() => buildContainerList(containers), [containers])

  const toggleGroup = useCallback((groupId: string): void => {
    setCollapsedGroupIds((currentGroupIds) => {
      const nextGroupIds = new Set(currentGroupIds)

      if (nextGroupIds.has(groupId)) {
        nextGroupIds.delete(groupId)
      } else {
        nextGroupIds.add(groupId)
      }

      return nextGroupIds
    })
  }, [])

  const loadContainers = useCallback(async (): Promise<void> => {
    setStatus('loading')
    setErrorMessage('')

    try {
      if (!window.api?.docker?.listRunningContainers) {
        throw new Error('A ponte com o Docker ainda não carregou. Reinicie a aplicação.')
      }

      const runningContainers = await window.api.docker.listRunningContainers()
      setContainers(runningContainers)
      setUpdatedAt(new Date())
      setStatus('success')
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Não foi possível carregar os containers.'
      setErrorMessage(message)
      setContainers([])
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadContainers()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [loadContainers])

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Dev Watch</p>
          <h1>Containers em execução</h1>
        </div>

        <button
          className="refresh-button"
          type="button"
          disabled={isLoading}
          onClick={loadContainers}
        >
          {isLoading ? 'Atualizando...' : 'Atualizar'}
        </button>
      </header>

      <section className="summary-bar" aria-live="polite">
        <div>
          <span className="summary-label">Docker</span>
          <strong>{containerCountLabel}</strong>
        </div>

        <div className="summary-meta">
          {updatedAt
            ? `Atualizado às ${updatedAt.toLocaleTimeString('pt-BR')}`
            : 'Aguardando leitura'}
        </div>
      </section>

      {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}

      <section className="container-panel">
        <div className="table-scroller">
          <table>
            <colgroup>
              <col className="id-column" />
              <col className="name-column" />
              <col className="image-column" />
              <col className="command-column" />
              <col className="created-column" />
              <col className="state-column" />
              <col className="ports-column" />
              <col className="networks-column" />
            </colgroup>
            <thead>
              <tr>
                <th>ID do container</th>
                <th>Nome</th>
                <th>Imagem</th>
                <th>Comando</th>
                <th>Criado</th>
                <th>Estado</th>
                <th>Portas</th>
                <th>Redes</th>
              </tr>
            </thead>
            <tbody>
              {containerList.map((item) => {
                if (item.type === 'group') {
                  const isCollapsed = collapsedGroupIds.has(item.group.id)
                  const containerCount = item.group.containers.length
                  const groupCountLabel =
                    containerCount === 1
                      ? '1 container rodando'
                      : `${containerCount} containers rodando`

                  return (
                    <Fragment key={item.group.id}>
                      <tr className="group-row">
                        <td className="id-cell">
                          <span className="group-placeholder">-</span>
                        </td>
                        <td className="group-name-cell" title={item.group.name}>
                          <button
                            className="group-toggle"
                            type="button"
                            aria-label={
                              isCollapsed
                                ? `Expandir grupo ${item.group.name}`
                                : `Recolher grupo ${item.group.name}`
                            }
                            onClick={() => toggleGroup(item.group.id)}
                          >
                            <span
                              className={
                                isCollapsed ? 'group-chevron' : 'group-chevron is-expanded'
                              }
                            />
                          </button>
                          <span className="group-status-dot" />
                          <span className="group-name">{item.group.name}</span>
                          <span className="group-kind">{getGroupTypeLabel(item.group.type)}</span>
                        </td>
                        <td className="image-cell">-</td>
                        <td className="command-cell">-</td>
                        <td className="created-cell">-</td>
                        <td className="state-cell">
                          <span className="group-status-pill">{groupCountLabel}</span>
                        </td>
                        <td className="ports-cell">-</td>
                        <td className="networks-cell" title={item.group.network}>
                          {item.group.network || '-'}
                        </td>
                      </tr>

                      {!isCollapsed
                        ? item.group.containers.map((container) => (
                            <tr className="child-row" key={container.id}>
                              <td className="id-cell" title={container.id}>
                                <code>{container.id}</code>
                              </td>
                              <td className="strong-cell child-name-cell" title={container.name}>
                                {getContainerDisplayName(container)}
                              </td>
                              <td className="image-cell" title={container.image}>
                                {container.image || '-'}
                              </td>
                              <td className="command-cell" title={container.command}>
                                {container.command || '-'}
                              </td>
                              <td className="created-cell">
                                {translateDuration(container.runningFor) ||
                                  container.createdAt ||
                                  '-'}
                              </td>
                              <td className="state-cell">
                                <span className="status-pill">
                                  {translateDockerStatus(container.status) ||
                                    translateDockerStatus(container.state) ||
                                    '-'}
                                </span>
                              </td>
                              <td className="ports-cell">{container.ports || '-'}</td>
                              <td className="networks-cell" title={container.networks}>
                                {container.networks || '-'}
                              </td>
                            </tr>
                          ))
                        : null}
                    </Fragment>
                  )
                }

                return (
                  <tr key={item.container.id}>
                    <td className="id-cell" title={item.container.id}>
                      <code>{item.container.id}</code>
                    </td>
                    <td className="strong-cell" title={item.container.name}>
                      {getContainerDisplayName(item.container)}
                    </td>
                    <td className="image-cell" title={item.container.image}>
                      {item.container.image || '-'}
                    </td>
                    <td className="command-cell" title={item.container.command}>
                      {item.container.command || '-'}
                    </td>
                    <td className="created-cell">
                      {translateDuration(item.container.runningFor) ||
                        item.container.createdAt ||
                        '-'}
                    </td>
                    <td className="state-cell">
                      <span className="status-pill">
                        {translateDockerStatus(item.container.status) ||
                          translateDockerStatus(item.container.state) ||
                          '-'}
                      </span>
                    </td>
                    <td className="ports-cell">{item.container.ports || '-'}</td>
                    <td className="networks-cell" title={item.container.networks}>
                      {item.container.networks || '-'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {!isLoading && !errorMessage && containers.length === 0 ? (
          <div className="empty-state">Nenhum container em execução encontrado.</div>
        ) : null}
      </section>
    </main>
  )
}

export default App
