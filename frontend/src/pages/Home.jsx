import { useEffect, useMemo, useState } from 'react'
import ErrorModal from '../components/ErrorModal'
import { supabase } from '../lib/supabaseClient'

const formatDayLabel = (date) => date.toLocaleDateString('en-US', { weekday: 'short' })
const formatMonthLabel = (date) => date.toLocaleDateString('en-US', { month: 'short' })
const MONTH_ABBR = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May.', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.']
const formatFullDateLabel = (date) => `${MONTH_ABBR[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`
const formatMonthYearLabel = (date) => `${MONTH_ABBR[date.getMonth()]} ${date.getFullYear()}`

const startOfDay = (date) => {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

const startOfMonth = (date) => {
  const next = startOfDay(date)
  next.setDate(1)
  return next
}

const startOfWeek = (date) => {
  const next = startOfDay(date)
  const day = next.getDay()
  next.setDate(next.getDate() - day)
  return next
}

const getStaffFullName = (profile) => (
  [
    `${profile?.first_name || ''}`.trim(),
    `${profile?.middle_name || ''}`.trim(),
    `${profile?.last_name || ''}`.trim(),
    `${profile?.suffix || ''}`.trim(),
  ].filter(Boolean).join(' ') || `${profile?.full_name || ''}`.trim() || 'Staff'
)

function Home({ currentProfile }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [serviceRecords, setServiceRecords] = useState([])
  const [hoveredDay, setHoveredDay] = useState(null)
  const [chartRange, setChartRange] = useState('weekly')

  useEffect(() => {
    let isMounted = true

    const loadDashboard = async () => {
      setLoading(true)
      setError('')

      const lookbackStart = new Date()
      lookbackStart.setDate(lookbackStart.getDate() - 210)

      const { data, error: fetchError } = await supabase
        .from('service_records')
        .select('patient_id, visit_at, patients(sex)')
        .gte('visit_at', lookbackStart.toISOString())
        .is('archived_at', null)

      if (!isMounted) return

      if (fetchError) {
        setError(fetchError.message)
        setServiceRecords([])
        setLoading(false)
        return
      }

      const normalized = (data ?? [])
        .filter((row) => row?.patient_id && row?.visit_at)
        .map((row) => {
          const patientData = Array.isArray(row.patients) ? row.patients[0] : row.patients
          return {
            patientId: row.patient_id,
            visitAt: row.visit_at,
            sex: patientData?.sex ?? '',
          }
        })

      setServiceRecords(normalized)
      setLoading(false)
    }

    void loadDashboard()
    return () => {
      isMounted = false
    }
  }, [])

  const dashboard = useMemo(() => {
    const now = new Date()
    const todayStart = startOfDay(now)
    const weekStart = startOfWeek(now)

    const countUniquePatients = (rows) => new Set(rows.map((row) => row.patientId)).size
    const todayCount = countUniquePatients(serviceRecords.filter((row) => new Date(row.visitAt) >= todayStart))
    const weekCount = countUniquePatients(serviceRecords.filter((row) => new Date(row.visitAt) >= weekStart))

    const recentDays = Array.from({ length: 7 }, (_, index) => {
      const date = startOfDay(new Date(now))
      date.setDate(date.getDate() - (6 - index))
      return date
    })

    const byDay = recentDays.map((date) => {
      const dayStart = startOfDay(date)
      const dayEnd = new Date(dayStart)
      dayEnd.setDate(dayEnd.getDate() + 1)

      const dayRows = serviceRecords.filter((row) => {
        const visitAt = new Date(row.visitAt)
        return visitAt >= dayStart && visitAt < dayEnd
      })

      const uniquePatients = new Map()
      dayRows.forEach((row) => {
        if (!uniquePatients.has(row.patientId)) {
          uniquePatients.set(row.patientId, row.sex)
        }
      })

      const male = [...uniquePatients.values()].filter((sex) => sex === 'Male').length
      const female = [...uniquePatients.values()].filter((sex) => sex === 'Female').length

      return {
        label: formatDayLabel(dayStart),
        dateLabel: formatFullDateLabel(dayStart),
        male,
        female,
        total: uniquePatients.size,
      }
    })

    const maxDaily = Math.max(...byDay.map((item) => item.total), 1)

    const recentMonths = Array.from({ length: 6 }, (_, index) => {
      const date = startOfMonth(new Date(now))
      date.setMonth(date.getMonth() - (5 - index))
      return date
    })

    const byMonth = recentMonths.map((monthDate) => {
      const monthStart = startOfMonth(monthDate)
      const monthEnd = startOfMonth(new Date(monthStart))
      monthEnd.setMonth(monthEnd.getMonth() + 1)

      const monthRows = serviceRecords.filter((row) => {
        const visitAt = new Date(row.visitAt)
        return visitAt >= monthStart && visitAt < monthEnd
      })

      const uniquePatients = new Map()
      monthRows.forEach((row) => {
        if (!uniquePatients.has(row.patientId)) {
          uniquePatients.set(row.patientId, row.sex)
        }
      })

      const male = [...uniquePatients.values()].filter((sex) => sex === 'Male').length
      const female = [...uniquePatients.values()].filter((sex) => sex === 'Female').length
      return {
        key: `${monthStart.getFullYear()}-${monthStart.getMonth() + 1}`,
        label: formatMonthLabel(monthStart),
        dateLabel: formatMonthYearLabel(monthStart),
        male,
        female,
        total: uniquePatients.size,
      }
    })

    const maxMonthly = Math.max(...byMonth.map((item) => item.total), 1)

    return {
      todayCount,
      weekCount,
      weekly: {
        title: 'Patient Weekly Chart',
        subtitle: 'Latest 7 days',
        xLabel: 'Days',
        bars: byDay.map((item, index) => ({ ...item, key: `day-${index}-${item.label}` })),
        maxValue: maxDaily,
      },
      monthly: {
        title: 'Patient Monthly Chart',
        subtitle: 'Latest 6 months',
        xLabel: 'Months',
        bars: byMonth,
        maxValue: maxMonthly,
      },
    }
  }, [serviceRecords])

  const currentChart = chartRange === 'monthly' ? dashboard.monthly : dashboard.weekly
  const yAxisMax = Math.max(5, Math.ceil(currentChart.maxValue / 5) * 5)
  const yTicks = Array.from({ length: 6 }, (_, index) => yAxisMax - ((yAxisMax / 5) * index))

  const getBarHeight = (value) => {
    if (!value) return '0%'
    const rawPercent = (value / yAxisMax) * 100
    return `${Math.max(rawPercent, 5)}%`
  }

  const toggleChartRange = (direction) => {
    setHoveredDay(null)
    setChartRange((previous) => {
      if (direction === 'next') return previous === 'weekly' ? 'monthly' : 'weekly'
      return previous === 'weekly' ? 'monthly' : 'weekly'
    })
  }

  return (
    <>
      <div className="home-page">
        <section className="top-row">
          <div className="greeting-card">
            <p>Hello there,</p>
            <h1>{getStaffFullName(currentProfile)}</h1>
          </div>
          <div className="stat-card">
            <p>Patients This Week</p>
            <strong>{loading ? '-' : dashboard.weekCount}</strong>
          </div>
          <div className="stat-card">
            <p>Patients Today</p>
            <strong>{loading ? '-' : dashboard.todayCount}</strong>
          </div>
        </section>

        <section className="panel">
          <div className="panel-card wide">
            <div className="chart-filter-row">
              <h2>{currentChart.title}</h2>
            </div>
            <p className="muted">{currentChart.subtitle}</p>
            <div className="legend">
              <span className="legend-item male">Male</span>
              <span className="legend-item female">Female</span>
            </div>

            <ErrorModal message={error} onClose={() => setError('')} />

            <div className="chart-placeholder">
              <button
                type="button"
                className="chart-filter-arrow chart-filter-arrow-side left"
                onClick={() => toggleChartRange('prev')}
                aria-label="Switch to previous chart range"
              >
                &larr;
              </button>
              <div className="chart-plot">
                <div className="chart-y-scale">
                  {yTicks.map((tick) => (
                    <span
                      key={`tick-${tick}`}
                      className={`chart-y-tick ${tick === yAxisMax ? 'top' : ''} ${tick === 0 ? 'bottom' : ''}`}
                      style={{ bottom: `${(tick / yAxisMax) * 100}%` }}
                    >
                      {tick}
                    </span>
                  ))}
                </div>
                <div className="chart-main">
                  <div className="weekly-bars-area">
                    {yTicks.map((tick) => (
                      <span
                        key={`line-${tick}`}
                        className="chart-grid-line"
                        style={{ bottom: `${(tick / yAxisMax) * 100}%` }}
                        aria-hidden="true"
                      />
                    ))}
                    <div className="weekly-bars-columns">
                      {currentChart.bars.map((item) => (
                        <div
                          key={item.key}
                          className="weekly-bar-item"
                          onMouseEnter={() => setHoveredDay(item.key)}
                          onMouseLeave={() => setHoveredDay(null)}
                          onFocus={() => setHoveredDay(item.key)}
                          onBlur={() => setHoveredDay(null)}
                          tabIndex={0}
                        >
                          <div className="weekly-bar-stack">
                            <div
                              className="weekly-bar female"
                              style={{ height: getBarHeight(item.female) }}
                              title={`${item.label}: ${item.female} female`}
                            />
                            <div
                              className="weekly-bar male"
                              style={{ height: getBarHeight(item.male) }}
                              title={`${item.label}: ${item.male} male`}
                            />
                          </div>
                          {hoveredDay === item.key ? (
                            <div className="weekly-bar-tooltip">
                              <strong>{item.dateLabel || item.label}</strong>
                              <span>Female: {item.female}</span>
                              <span>Male: {item.male}</span>
                              <span>Total: {item.total}</span>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="weekly-x-labels" aria-hidden="true">
                    {currentChart.bars.map((item) => <span key={`xlabel-${item.key}`}>{item.label}</span>)}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="chart-filter-arrow chart-filter-arrow-side right"
                onClick={() => toggleChartRange('next')}
                aria-label="Switch to next chart range"
              >
                &rarr;
              </button>
              <span className="chart-label-y">Number of Patients</span>
              <span className="chart-label-x">{currentChart.xLabel}</span>
            </div>
          </div>
        </section>
      </div>
    </>
  )
}

export default Home
