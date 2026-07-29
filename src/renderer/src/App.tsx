import { useCallback, useEffect, useMemo, useState } from 'react'

type DockerContainer = Awaited<ReturnType<Window['api']['docker']['listRunningContainers']>>[number]

type LoadStatus = 'idle' | 'loading' | 'success' | 'error'

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
            <thead>
              <tr>
                <th>Container ID</th>
                <th>Nome</th>
                <th>Imagem</th>
                <th>Comando</th>
                <th>Criado</th>
                <th>Status</th>
                <th>Portas</th>
                <th>Redes</th>
              </tr>
            </thead>
            <tbody>
              {containers.map((container) => (
                <tr key={container.id}>
                  <td>
                    <code>{container.id}</code>
                  </td>
                  <td className="strong-cell">{container.name || '-'}</td>
                  <td>{container.image || '-'}</td>
                  <td className="command-cell">{container.command || '-'}</td>
                  <td>{container.runningFor || container.createdAt || '-'}</td>
                  <td>
                    <span className="status-pill">
                      {container.status || container.state || '-'}
                    </span>
                  </td>
                  <td className="ports-cell">{container.ports || '-'}</td>
                  <td>{container.networks || '-'}</td>
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
