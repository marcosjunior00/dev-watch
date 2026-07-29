import { useCallback, useEffect, useMemo, useState } from 'react'

type DockerContainer = Awaited<ReturnType<Window['api']['docker']['listRunningContainers']>>[number]

type LoadStatus = 'idle' | 'loading' | 'success' | 'error'

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

function App(): React.JSX.Element {
  const [containers, setContainers] = useState<DockerContainer[]>([])
  const [status, setStatus] = useState<LoadStatus>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  const isLoading = status === 'loading'

  const containerCountLabel = useMemo(() => {
    const count = containers.length
    return count === 1 ? '1 container rodando' : `${count} containers rodando`
  }, [containers.length])

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
              {containers.map((container) => (
                <tr key={container.id}>
                  <td className="id-cell" title={container.id}>
                    <code>{container.id}</code>
                  </td>
                  <td className="strong-cell" title={container.name}>
                    {container.name || '-'}
                  </td>
                  <td className="image-cell" title={container.image}>
                    {container.image || '-'}
                  </td>
                  <td className="command-cell" title={container.command}>
                    {container.command || '-'}
                  </td>
                  <td className="created-cell">
                    {translateDuration(container.runningFor) || container.createdAt || '-'}
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
              ))}
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
