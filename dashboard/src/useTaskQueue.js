import { useState, useEffect, useRef, useCallback } from 'react'

const WS_URL = 'ws://localhost:3000'

export function useTaskQueue() {
  const [stats, setStats]   = useState(null)
  const [events, setEvents] = useState([])   // recent job events
  const [status, setStatus] = useState('connecting')
  const wsRef = useRef(null)

  const connect = useCallback(() => {
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      setStatus('connected')
      console.log('[ws] connected')
    }

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)

      if (msg.type === 'stats') {
        setStats(msg.data)
      }

      if (msg.type === 'job_created') {
        setEvents(prev => [
          { ...msg.data, event: 'created', ts: Date.now() },
          ...prev.slice(0, 49),   // keep last 50
        ])
      }
    }

    ws.onclose = () => {
      setStatus('disconnected')
      console.log('[ws] disconnected — retrying in 3s')
      setTimeout(connect, 3000)
    }

    ws.onerror = () => {
      setStatus('error')
      ws.close()
    }
  }, [])

  useEffect(() => {
    connect()
    return () => wsRef.current?.close()
  }, [connect])

  return { stats, events, status }
}
