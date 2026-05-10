import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import ErrorModal from '../components/ErrorModal'
import { supabase } from '../lib/supabaseClient'

const MANILA_TIME_ZONE = 'Asia/Manila'
const MANILA_UTC_OFFSET = '+08:00'
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const getManilaDayRange = (reference = new Date()) => {
  const dateParts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: MANILA_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(reference)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
  const dateKey = `${dateParts.year}-${dateParts.month}-${dateParts.day}`
  return {
    startIso: new Date(`${dateKey}T00:00:00.000${MANILA_UTC_OFFSET}`).toISOString(),
    endIso: new Date(`${dateKey}T23:59:59.999${MANILA_UTC_OFFSET}`).toISOString(),
  }
}

const getManilaMonthStart = () => {
  const now = new Date()
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: MANILA_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
    })
      .formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
  return new Date(`${parts.year}-${parts.month}-01T00:00:00.000${MANILA_UTC_OFFSET}`).toISOString()
}

const getStaffDisplayName = (profile) =>
  [
    `${profile?.first_name || ''}`.trim(),
    `${profile?.last_name || ''}`.trim(),
  ].filter(Boolean).join(' ') || `${profile?.full_name || ''}`.trim() || 'Staff'

function HomeReceptionist({ currentProfile, queueEnabled = true }) {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pendingCount, setPendingCount] = useState(0)
  const [acceptedTodayCount, setAcceptedTodayCount] = useState(0)
  const [newPatientsThisMonth, setNewPatientsThisMonth] = useState(0)
  const [totalPatients, setTotalPatients] = useState(0)

  const loadStats = async () => {
    setError('')
    try {
      const todayRange = getManilaDayRange()
      const monthStart = getManilaMonthStart()

      const [queueResult, newPatientsResult, totalResult] = await Promise.all([
        supabase
          .from('patient_queue_entries')
          .select('id, queue_status')
          .in('queue_status', ['pending', 'accepted'])
          .gte('queued_at', todayRange.startIso)
          .lte('queued_at', todayRange.endIso),
        supabase
          .from('patients')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', monthStart)
          .is('archived_at', null),
        supabase
          .from('patients')
          .select('id', { count: 'exact', head: true })
          .is('archived_at', null),
      ])

      if (queueResult.error) throw queueResult.error
      if (newPatientsResult.error) throw newPatientsResult.error
      if (totalResult.error) throw totalResult.error

      const rows = queueResult.data ?? []
      setPendingCount(rows.filter((r) => r.queue_status === 'pending').length)
      setAcceptedTodayCount(rows.filter((r) => r.queue_status === 'accepted').length)
      setNewPatientsThisMonth(newPatientsResult.count || 0)
      setTotalPatients(totalResult.count || 0)
    } catch (err) {
      setError(err?.message || 'Unable to load dashboard data.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadStats()
  }, [])

  useEffect(() => {
    const channel = supabase
      .channel('receptionist-home-queue')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'patient_queue_entries' }, () => {
        void loadStats()
      })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [])

  const monthLabel = MONTH_ABBR[new Date().getMonth()]

  const stats = [
    ...(queueEnabled ? [
      {
        key: 'pending',
        title: 'Pending in Queue',
        value: pendingCount,
        delta: 'Patients waiting right now',
      },
      {
        key: 'accepted-today',
        title: 'Accepted Today',
        value: acceptedTodayCount,
        delta: 'Patients seen today',
      },
    ] : []),
    {
      key: 'new-month',
      title: `New Patients — ${monthLabel}`,
      value: newPatientsThisMonth,
      delta: 'Registered this month',
    },
    {
      key: 'total',
      title: 'Total Patient Records',
      value: totalPatients,
      delta: 'All active patients',
    },
  ]

  const quickActions = [
    ...(queueEnabled ? [{
      key: 'queue',
      icon: '📋',
      label: 'Patient Queue',
      description: 'View and manage today\'s queue',
      primary: true,
      onClick: () => navigate('/records'),
    }] : []),
    {
      key: 'add',
      icon: '➕',
      label: 'Add New Patient',
      description: 'Register a new patient',
      onClick: () => navigate('/add-patient'),
    },
    {
      key: 'records',
      icon: '👥',
      label: 'Patient Records',
      description: 'Search and view patient files',
      onClick: () => navigate('/records'),
    },
    {
      key: 'logs',
      icon: '📄',
      label: 'Patient Logs',
      description: 'View recent patient activity',
      onClick: () => navigate('/logs'),
    },
  ]

  return (
    <>
      <ErrorModal message={error} onClose={() => setError('')} />
      <div className="home-page analytics-home">
        <section className="role-home-top-row">
          <div className="greeting-card analytics-hero">
            <p>Receptionist Dashboard</p>
            <h1>{getStaffDisplayName(currentProfile)}</h1>
            <span className="analytics-subtitle">Manage today's patient queue and registrations.</span>
          </div>
          {stats.map((stat) => (
            <div key={stat.key} className="stat-card analytics-stat-card">
              <p>{stat.title}</p>
              <strong>{loading ? '-' : stat.value}</strong>
              <span className="analytics-stat-delta">{loading ? 'Loading...' : stat.delta}</span>
            </div>
          ))}
        </section>

        <section className="role-home-actions">
          <h2 className="role-home-actions-title">Quick Actions</h2>
          <div className="role-home-action-group">
            {quickActions.map((action) => (
              <button
                key={action.key}
                type="button"
                className={`role-home-action-btn${action.primary ? ' action-primary' : ''}`}
                onClick={action.onClick}
              >
                <span className="role-home-action-icon">{action.icon}</span>
                <span className="role-home-action-content">
                  <span className="role-home-action-label">{action.label}</span>
                  <small className="role-home-action-desc">{action.description}</small>
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </>
  )
}

export default HomeReceptionist
