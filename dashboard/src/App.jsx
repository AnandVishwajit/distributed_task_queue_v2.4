import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { useTaskQueue } from './useTaskQueue'
import styles from './App.module.css'

const STATUS_COLORS = {
  pending:    '#f59e0b',
  processing: '#3b82f6',
  done:       '#10b981',
  failed:     '#ef4444',
}

const TIER_COLORS = {
  high:    '#818cf8',
  normal:  '#64748b',
  delayed: '#f59e0b',
  dead:    '#ef4444',
}

function StatusDot({ status }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8, height: 8,
        borderRadius: '50%',
        background: STATUS_COLORS[status] || '#64748b',
        marginRight: 6,
      }}
    />
  )
}

function StatCard({ label, value, color }) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statValue} style={{ color }}>{value ?? '—'}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  )
}

function ConnectionBadge({ status }) {
  const colors = { connected: '#10b981', disconnected: '#ef4444', connecting: '#f59e0b', error: '#ef4444' }
  return (
    <span className={styles.badge} style={{ background: colors[status] + '22', color: colors[status], border: `1px solid ${colors[status]}44` }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: colors[status], display: 'inline-block', marginRight: 5 }} />
      {status}
    </span>
  )
}

export default function App() {
  const { stats, events, status } = useTaskQueue()
  const [enqueueForm, setEnqueueForm] = useState({ type: 'send_email', tier: 'free', payload: '{"to":"test@example.com","subject":"Hello"}' })
  const [enqueueStatus, setEnqueueStatus] = useState('')

  const jobs   = stats?.jobs   || {}
  const queues = stats?.queues || {}

  const statusChartData = Object.entries(STATUS_COLORS).map(([s, color]) => ({
    name: s, value: jobs[s] || 0, color,
  }))

  const queueChartData = [
    { name: 'paid (high)',   value: queues.high    || 0, color: TIER_COLORS.high },
    { name: 'free (normal)', value: queues.normal  || 0, color: TIER_COLORS.normal },
    { name: 'delayed',       value: queues.delayed || 0, color: TIER_COLORS.delayed },
    { name: 'dead letter',   value: queues.dead    || 0, color: TIER_COLORS.dead },
  ]

  async function handleEnqueue(e) {
    e.preventDefault()
    setEnqueueStatus('sending...')
    try {
      let payload
      try { payload = JSON.parse(enqueueForm.payload) } catch { payload = {} }
      const res = await fetch('http://localhost:3000/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: enqueueForm.type, tier: enqueueForm.tier, payload }),
      })
      const job = await res.json()
      setEnqueueStatus(`✓ created ${job.id.slice(0, 8)}...`)
      setTimeout(() => setEnqueueStatus(''), 3000)
    } catch {
      setEnqueueStatus('✗ failed — is the API running?')
    }
  }

  return (
    <div className={styles.app}>
      {/* Header */}
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Task Queue</h1>
          <p className={styles.subtitle}>Live dashboard</p>
        </div>
        <ConnectionBadge status={status} />
      </header>

      <main className={styles.main}>
        {/* Top stat cards */}
        <section className={styles.statsRow}>
          <StatCard label="pending"    value={jobs.pending}    color={STATUS_COLORS.pending} />
          <StatCard label="processing" value={jobs.processing} color={STATUS_COLORS.processing} />
          <StatCard label="done"       value={jobs.done}       color={STATUS_COLORS.done} />
          <StatCard label="failed"     value={jobs.failed}     color={STATUS_COLORS.failed} />
        </section>

        {/* Charts row */}
        <section className={styles.chartsRow}>
          <div className={styles.chartCard}>
            <h2 className={styles.cardTitle}>Queue depth</h2>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={queueChartData} barSize={32}>
                <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} width={30} />
                <Tooltip
                  contentStyle={{ background: '#1e2330', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0' }}
                  cursor={{ fill: '#ffffff08' }}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {queueChartData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className={styles.chartCard}>
            <h2 className={styles.cardTitle}>Jobs by status</h2>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={statusChartData} barSize={32}>
                <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} width={30} />
                <Tooltip
                  contentStyle={{ background: '#1e2330', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0' }}
                  cursor={{ fill: '#ffffff08' }}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {statusChartData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Bottom row — enqueue form + event feed */}
        <section className={styles.bottomRow}>
          {/* Enqueue a job */}
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Enqueue a job</h2>
            <form onSubmit={handleEnqueue} className={styles.form}>
              <label className={styles.label}>Job type</label>
              <select
                className={styles.input}
                value={enqueueForm.type}
                onChange={e => setEnqueueForm(f => ({ ...f, type: e.target.value }))}
              >
                <option value="send_email">send_email</option>
                <option value="resize_image">resize_image</option>
                <option value="generate_report">generate_report</option>
              </select>

              <label className={styles.label}>Tier</label>
              <div className={styles.tierToggle}>
                {['free', 'paid'].map(t => (
                  <button
                    key={t} type="button"
                    className={`${styles.tierBtn} ${enqueueForm.tier === t ? styles.tierBtnActive : ''}`}
                    onClick={() => setEnqueueForm(f => ({ ...f, tier: t }))}
                  >
                    {t === 'paid' ? '⚡ paid' : '🆓 free'}
                  </button>
                ))}
              </div>

              <label className={styles.label}>Payload (JSON)</label>
              <textarea
                className={styles.input}
                rows={3}
                value={enqueueForm.payload}
                onChange={e => setEnqueueForm(f => ({ ...f, payload: e.target.value }))}
              />

              <button className={styles.submitBtn} type="submit">
                Enqueue job
              </button>
              {enqueueStatus && <p className={styles.enqueueStatus}>{enqueueStatus}</p>}
            </form>
          </div>

          {/* Live event feed */}
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Live events</h2>
            {events.length === 0 ? (
              <p className={styles.empty}>Waiting for jobs...</p>
            ) : (
              <ul className={styles.eventList}>
                {events.map((ev, i) => (
                  <li key={i} className={styles.eventItem}>
                    <StatusDot status={ev.status} />
                    <span className={styles.eventType}>{ev.type}</span>
                    <span className={styles.eventTier} style={{ color: ev.tier === 'paid' ? '#818cf8' : '#64748b' }}>
                      {ev.tier}
                    </span>
                    <span className={styles.eventId}>{ev.id?.slice(0, 8)}...</span>
                    <span className={styles.eventTime}>{new Date(ev.ts).toLocaleTimeString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
