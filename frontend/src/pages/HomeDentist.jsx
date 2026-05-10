import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import ErrorModal from '../components/ErrorModal'
import { supabase } from '../lib/supabaseClient'

const MANILA_TIME_ZONE = 'Asia/Manila'
const MANILA_UTC_OFFSET = '+08:00'

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

const getManilaWeekStart = () => {
  const now = new Date()
  const manilaDateStr = now.toLocaleDateString('en-CA', { timeZone: MANILA_TIME_ZONE })
  const dayOfWeek = new Date(manilaDateStr).getDay()
  const weekStartDate = new Date(`${manilaDateStr}T00:00:00.000${MANILA_UTC_OFFSET}`)
  weekStartDate.setDate(weekStartDate.getDate() - dayOfWeek)
  return weekStartDate.toISOString()
}

const getStaffDisplayName = (profile) =>
  [
    `${profile?.first_name || ''}`.trim(),
    `${profile?.last_name || ''}`.trim(),
  ].filter(Boolean).join(' ') || `${profile?.full_name || ''}`.trim() || 'Staff'

function HomeDentist({ currentProfile, queueEnabled = true }) {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [myAcceptedToday, setMyAcceptedToday] = useState(0)
  const [myAcceptedThisWeek, setMyAcceptedThisWeek] = useState(0)
  const [pendingCount, setPendingCount] = useState(0)
  const [totalPatients, setTotalPatients] = useState(0)

  const loadStats = async () => {
    setError('')
    try {
      const { data: authData } = await supabase.auth.getUser()
      const userId = authData?.user?.id

      const todayRange = getManilaDayRange()
      const weekStart = getManilaWeekStart()

      const [myTodayResult, myWeekResult, pendingResult, totalResult] = await Promise.all([
        supabase
          .from('patient_queue_entries')
          .select('id', { count: 'exact', head: true })
          .eq('queue_status', 'accepted')
          .eq('accepted_by', userId)
          .gte('accepted_at', todayRange.startIso)
          .lte('accepted_at', todayRange.endIso),
        supabase
          .from('patient_queue_entries')
          .select('id', { count: 'exact', head: true })
          .eq('queue_status', 'accepted')
          .eq('accepted_by', userId)
          .gte('accepted_at', weekStart),
        supabase
          .from('patient_queue_entries')
          .select('id', { count: 'exact', head: true })
          .eq('queue_status', 'pending'),
        supabase
          .from('patients')
          .select('id', { count: 'exact', head: true })
          .is('archived_at', null),
      ])

      if (myTodayResult.error) throw myTodayResult.error
      if (myWeekResult.error) throw myWeekResult.error
      if (pendingResult.error) throw pendingResult.error
      if (totalResult.error) throw totalResult.error

      setMyAcceptedToday(myTodayResult.count || 0)
      setMyAcceptedThisWeek(myWeekResult.count || 0)
      setPendingCount(pendingResult.count || 0)
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
      .channel('dentist-home-queue')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'patient_queue_entries' }, () => {
        void loadStats()
      })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [])

  const stats = [
    ...(queueEnabled ? [
      {
        key: 'my-today',
        title: 'My Patients Today',
        value: myAcceptedToday,
        delta: 'Patients you accepted today',
      },
      {
        key: 'my-week',
        title: 'My Patients This Week',
        value: myAcceptedThisWeek,
        delta: 'Patients accepted this week',
      },
      {
        key: 'pending',
        title: 'Pending in Queue',
        value: pendingCount,
        delta: 'Patients waiting to be accepted',
      },
    ] : []),
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
      description: 'Accept queued patients',
      primary: true,
      onClick: () => navigate('/records'),
    }] : []),
    {
      key: 'records',
      icon: '👥',
      label: 'Patient Records',
      description: 'View and update patient files',
      onClick: () => navigate('/records'),
    },
    {
      key: 'procedure',
      icon: '🦷',
      label: 'Procedures',
      description: 'Browse dental procedures',
      onClick: () => navigate('/procedure'),
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
            <p>Dentist Dashboard</p>
            <h1>{getStaffDisplayName(currentProfile)}</h1>
            <span className="analytics-subtitle">Track your patient load and manage today's consultations.</span>
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

export default HomeDentist
