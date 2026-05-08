import { useEffect, useMemo, useState } from 'react'
import ErrorModal from '../components/ErrorModal'
import { supabase } from '../lib/supabaseClient'

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const METRIC_OPTIONS = [
  { key: 'visits', label: 'Patient Visits' },
  { key: 'registrations', label: 'New Registrations' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'services', label: 'Services' },
]
const VIEW_OPTIONS = [
  { key: 'month', label: 'Month View' },
  { key: 'year', label: 'Year View' },
  { key: 'compare', label: 'Year Comparison' },
]

const startOfDay = (date) => {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

const startOfWeek = (date) => {
  const next = startOfDay(date)
  next.setDate(next.getDate() - next.getDay())
  return next
}

const startOfMonth = (date) => {
  const next = startOfDay(date)
  next.setDate(1)
  return next
}

const addDays = (date, amount) => {
  const next = new Date(date)
  next.setDate(next.getDate() + amount)
  return next
}

const addMonths = (date, amount) => {
  const next = new Date(date)
  next.setMonth(next.getMonth() + amount)
  return next
}

const getDaysInMonth = (year, monthIndex) => new Date(year, monthIndex + 1, 0).getDate()
const formatFullDateLabel = (date) => `${MONTH_ABBR[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`
const formatMonthYearLabel = (date) => `${MONTH_ABBR[date.getMonth()]} ${date.getFullYear()}`
const formatCompactNumber = (value) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Number(value || 0))
const formatCompactCurrency = (value) => new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  maximumFractionDigits: 0,
}).format(Number(value || 0))

const formatMetricValue = (metricKey, value) => (
  metricKey === 'revenue' ? formatCompactCurrency(value) : formatCompactNumber(value)
)

const PIE_SLICE_COLORS = ['#123f6b', '#1f6da0', '#2c90c5', '#57b9d9', '#8fd6e8', '#d8ecf3']

const getMetricChartTitle = (metricKey) => {
  if (metricKey === 'registrations') return 'New Registrations Chart'
  if (metricKey === 'revenue') return 'Revenue Chart'
  if (metricKey === 'services') return 'Services Chart'
  return 'Patient Visits Chart'
}

const getStaffFullName = (profile) => (
  [
    `${profile?.first_name || ''}`.trim(),
    `${profile?.middle_name || ''}`.trim(),
    `${profile?.last_name || ''}`.trim(),
    `${profile?.suffix || ''}`.trim(),
  ].filter(Boolean).join(' ') || `${profile?.full_name || ''}`.trim() || 'Staff'
)

const getUniqueVisitCount = (rows) => new Set(rows.map((row) => `${row.patientId}-${startOfDay(new Date(row.visitAt)).toISOString()}`)).size
const getUniquePatientCount = (rows) => new Set(rows.map((row) => row.patientId)).size
const sumRevenue = (rows) => rows.reduce((total, row) => total + Number(row.amount || 0), 0)

function Home({ currentProfile }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [serviceRecords, setServiceRecords] = useState([])
  const [patientRows, setPatientRows] = useState([])
  const [totalPatients, setTotalPatients] = useState(0)
  const [hoveredKey, setHoveredKey] = useState(null)
  const [activeMetric, setActiveMetric] = useState('visits')
  const [viewMode, setViewMode] = useState('month')
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth())

  useEffect(() => {
    if (activeMetric === 'services' && viewMode === 'compare') {
      setViewMode('year')
    }
  }, [activeMetric, viewMode])

  useEffect(() => {
    let isMounted = true

    const loadDashboard = async () => {
      setLoading(true)
      setError('')

      const lookbackStart = startOfDay(addMonths(new Date(), -36))

      const [servicesResult, patientsResult, totalPatientsResult] = await Promise.all([
        supabase
          .from('service_records')
          .select('patient_id, visit_at, amount, services(service_name), patients(sex)')
          .gte('visit_at', lookbackStart.toISOString())
          .is('archived_at', null),
        supabase
          .from('patients')
          .select('id, created_at, sex')
          .gte('created_at', lookbackStart.toISOString())
          .is('archived_at', null),
        supabase
          .from('patients')
          .select('id', { count: 'exact', head: true })
          .is('archived_at', null),
      ])

      if (!isMounted) return

      const fetchError = servicesResult.error || patientsResult.error || totalPatientsResult.error
      if (fetchError) {
        setError(fetchError.message)
        setServiceRecords([])
        setPatientRows([])
        setTotalPatients(0)
        setLoading(false)
        return
      }

      const normalizedServices = (servicesResult.data ?? [])
        .filter((row) => row?.patient_id && row?.visit_at)
        .map((row) => {
          const patientData = Array.isArray(row.patients) ? row.patients[0] : row.patients
          const serviceData = Array.isArray(row.services) ? row.services[0] : row.services
          return {
            patientId: row.patient_id,
            visitAt: row.visit_at,
            amount: Number(row.amount || 0),
            sex: patientData?.sex ?? '',
            serviceName: `${serviceData?.service_name || ''}`.trim() || 'Unspecified Service',
          }
        })

      const normalizedPatients = (patientsResult.data ?? [])
        .filter((row) => row?.id && row?.created_at)
        .map((row) => ({
          id: row.id,
          createdAt: row.created_at,
          sex: row.sex ?? '',
        }))

      const yearCandidates = [
        ...normalizedServices.map((row) => new Date(row.visitAt).getFullYear()),
        ...normalizedPatients.map((row) => new Date(row.createdAt).getFullYear()),
      ].filter((value) => Number.isInteger(value))

      if (yearCandidates.length > 0) {
        setSelectedYear(Math.max(...yearCandidates))
      }

      setServiceRecords(normalizedServices)
      setPatientRows(normalizedPatients)
      setTotalPatients(totalPatientsResult.count || 0)
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
    const tomorrowStart = addDays(todayStart, 1)
    const yesterdayStart = addDays(todayStart, -1)
    const weekStart = startOfWeek(now)
    const prevWeekStart = addDays(weekStart, -7)
    const monthStart = startOfMonth(now)
    const prevMonthStart = addMonths(monthStart, -1)
    const nextMonthStart = addMonths(monthStart, 1)

    const servicesToday = serviceRecords.filter((row) => {
      const visitAt = new Date(row.visitAt)
      return visitAt >= todayStart && visitAt < tomorrowStart
    })
    const servicesYesterday = serviceRecords.filter((row) => {
      const visitAt = new Date(row.visitAt)
      return visitAt >= yesterdayStart && visitAt < todayStart
    })
    const servicesThisWeek = serviceRecords.filter((row) => new Date(row.visitAt) >= weekStart)
    const servicesPrevWeek = serviceRecords.filter((row) => {
      const visitAt = new Date(row.visitAt)
      return visitAt >= prevWeekStart && visitAt < weekStart
    })
    const servicesThisMonth = serviceRecords.filter((row) => {
      const visitAt = new Date(row.visitAt)
      return visitAt >= monthStart && visitAt < nextMonthStart
    })
    const servicesPrevMonth = serviceRecords.filter((row) => {
      const visitAt = new Date(row.visitAt)
      return visitAt >= prevMonthStart && visitAt < monthStart
    })
    const registrationsThisMonth = patientRows.filter((row) => {
      const createdAt = new Date(row.createdAt)
      return createdAt >= monthStart && createdAt < nextMonthStart
    })
    const registrationsPrevMonth = patientRows.filter((row) => {
      const createdAt = new Date(row.createdAt)
      return createdAt >= prevMonthStart && createdAt < monthStart
    })

    const availableYearsSet = new Set([
      ...serviceRecords.map((row) => new Date(row.visitAt).getFullYear()),
      ...patientRows.map((row) => new Date(row.createdAt).getFullYear()),
      selectedYear,
    ])
    const availableYears = [...availableYearsSet]
      .filter((value) => Number.isInteger(value))
      .sort((a, b) => a - b)

    const buildBucketPayload = (serviceBucketRows, patientBucketRows, label, dateLabel, key) => {
      const uniquePatients = new Map()
      serviceBucketRows.forEach((row) => {
        if (!uniquePatients.has(row.patientId)) {
          uniquePatients.set(row.patientId, row.sex)
        }
      })

      const male = [...uniquePatients.values()].filter((sex) => sex === 'Male').length
      const female = [...uniquePatients.values()].filter((sex) => sex === 'Female').length

      return {
        key,
        label,
        dateLabel,
        visits: getUniqueVisitCount(serviceBucketRows),
        uniquePatients: getUniquePatientCount(serviceBucketRows),
        registrations: patientBucketRows.length,
        revenue: sumRevenue(serviceBucketRows),
        serviceCount: serviceBucketRows.length,
        male,
        female,
      }
    }

    let chartBars = []
    let chartTitle = getMetricChartTitle(activeMetric)
    let chartSubtitle = ''
    let chartXAxisLabel = ''
    let currentViewServiceRows = []

    if (viewMode === 'month') {
      const totalDays = getDaysInMonth(selectedYear, selectedMonth)
      chartBars = Array.from({ length: totalDays }, (_, index) => {
        const bucketStart = new Date(selectedYear, selectedMonth, index + 1)
        const bucketEnd = addDays(bucketStart, 1)
        const serviceBucketRows = serviceRecords.filter((row) => {
          const visitAt = new Date(row.visitAt)
          return visitAt >= bucketStart && visitAt < bucketEnd
        })
        const patientBucketRows = patientRows.filter((row) => {
          const createdAt = new Date(row.createdAt)
          return createdAt >= bucketStart && createdAt < bucketEnd
        })
        return buildBucketPayload(
          serviceBucketRows,
          patientBucketRows,
          String(index + 1),
          formatFullDateLabel(bucketStart),
          `day-${selectedYear}-${selectedMonth + 1}-${index + 1}`,
        )
      })
      currentViewServiceRows = serviceRecords.filter((row) => {
        const visitAt = new Date(row.visitAt)
        return visitAt.getFullYear() === selectedYear && visitAt.getMonth() === selectedMonth
      })
      chartSubtitle = `${MONTH_ABBR[selectedMonth]} ${selectedYear} daily breakdown`
      chartXAxisLabel = 'Days of Month'
    } else if (viewMode === 'year') {
      chartBars = Array.from({ length: 12 }, (_, index) => {
        const bucketStart = new Date(selectedYear, index, 1)
        const bucketEnd = new Date(selectedYear, index + 1, 1)
        const serviceBucketRows = serviceRecords.filter((row) => {
          const visitAt = new Date(row.visitAt)
          return visitAt >= bucketStart && visitAt < bucketEnd
        })
        const patientBucketRows = patientRows.filter((row) => {
          const createdAt = new Date(row.createdAt)
          return createdAt >= bucketStart && createdAt < bucketEnd
        })
        return buildBucketPayload(
          serviceBucketRows,
          patientBucketRows,
          MONTH_ABBR[index],
          formatMonthYearLabel(bucketStart),
          `month-${selectedYear}-${index + 1}`,
        )
      })
      currentViewServiceRows = serviceRecords.filter((row) => new Date(row.visitAt).getFullYear() === selectedYear)
      chartSubtitle = `${selectedYear} monthly breakdown`
      chartXAxisLabel = 'Months'
    } else {
      chartBars = availableYears.map((year) => {
        const bucketStart = new Date(year, 0, 1)
        const bucketEnd = new Date(year + 1, 0, 1)
        const serviceBucketRows = serviceRecords.filter((row) => {
          const visitAt = new Date(row.visitAt)
          return visitAt >= bucketStart && visitAt < bucketEnd
        })
        const patientBucketRows = patientRows.filter((row) => {
          const createdAt = new Date(row.createdAt)
          return createdAt >= bucketStart && createdAt < bucketEnd
        })
        return buildBucketPayload(
          serviceBucketRows,
          patientBucketRows,
          String(year),
          String(year),
          `year-${year}`,
        )
      })
      currentViewServiceRows = [...serviceRecords]
      chartSubtitle = 'Compare historical performance across available years'
      chartXAxisLabel = 'Years'
    }

    const chartMax = Math.max(
      ...chartBars.map((item) => {
        if (activeMetric === 'registrations') return item.registrations
        if (activeMetric === 'revenue') return item.revenue
        return item.visits
      }),
      1,
    )

    const topServices = Object.values(
      currentViewServiceRows.reduce((accumulator, row) => {
        const key = row.serviceName
        if (!accumulator[key]) {
          accumulator[key] = { label: key, count: 0 }
        }
        accumulator[key].count += 1
        return accumulator
      }, {}),
    )
      .sort((a, b) => b.count - a.count)
    const topFiveServices = topServices.slice(0, 5)
    const otherServicesCount = topServices.slice(5).reduce((total, item) => total + item.count, 0)
    const serviceSlices = [
      ...topFiveServices,
      ...(otherServicesCount > 0 ? [{ label: 'Others', count: otherServicesCount }] : []),
    ].map((item, index) => ({
      ...item,
      color: PIE_SLICE_COLORS[index % PIE_SLICE_COLORS.length],
    }))
    const totalServiceSliceCount = serviceSlices.reduce((total, item) => total + item.count, 0)
    let pieGradient = 'conic-gradient(#dceaf0 0deg 360deg)'
    if (serviceSlices.length > 0 && totalServiceSliceCount > 0) {
      let currentAngle = 0
      const gradientStops = serviceSlices.map((item) => {
        const startAngle = currentAngle
        const sweepAngle = (item.count / totalServiceSliceCount) * 360
        currentAngle += sweepAngle
        return `${item.color} ${startAngle}deg ${currentAngle}deg`
      })
      pieGradient = `conic-gradient(${gradientStops.join(', ')})`
    }

    const peakBucket = [...chartBars].sort((a, b) => {
      const aValue = activeMetric === 'registrations'
        ? a.registrations
        : activeMetric === 'revenue'
          ? a.revenue
          : activeMetric === 'services'
            ? a.serviceCount
            : a.visits
      const bValue = activeMetric === 'registrations'
        ? b.registrations
        : activeMetric === 'revenue'
          ? b.revenue
          : activeMetric === 'services'
            ? b.serviceCount
            : b.visits
      return bValue - aValue
    })[0]

    return {
      availableYears,
      stats: [
        {
          key: 'today',
          title: 'Patients Today',
          value: getUniquePatientCount(servicesToday),
          delta: `${getUniquePatientCount(servicesToday) - getUniquePatientCount(servicesYesterday) >= 0 ? '+' : ''}${formatCompactNumber(getUniquePatientCount(servicesToday) - getUniquePatientCount(servicesYesterday))} vs yesterday`,
          metricKey: 'visits',
        },
        {
          key: 'week',
          title: 'Patients This Week',
          value: getUniquePatientCount(servicesThisWeek),
          delta: `${getUniquePatientCount(servicesThisWeek) - getUniquePatientCount(servicesPrevWeek) >= 0 ? '+' : ''}${formatCompactNumber(getUniquePatientCount(servicesThisWeek) - getUniquePatientCount(servicesPrevWeek))} vs last week`,
          metricKey: 'visits',
        },
        {
          key: 'month',
          title: 'New Patients This Month',
          value: registrationsThisMonth.length,
          delta: `${registrationsThisMonth.length - registrationsPrevMonth.length >= 0 ? '+' : ''}${formatCompactNumber(registrationsThisMonth.length - registrationsPrevMonth.length)} vs last month`,
          metricKey: 'registrations',
        },
        {
          key: 'revenue',
          title: 'Revenue This Month',
          value: sumRevenue(servicesThisMonth),
          delta: `${sumRevenue(servicesThisMonth) - sumRevenue(servicesPrevMonth) >= 0 ? '+' : ''}${formatMetricValue('revenue', Math.abs(sumRevenue(servicesThisMonth) - sumRevenue(servicesPrevMonth)))} vs last month`,
          metricKey: 'revenue',
        },
        {
          key: 'total-patients',
          title: 'Total Patient Records',
          value: totalPatients,
          delta: 'All active patient records',
          metricKey: 'visits',
        },
      ],
      totalPatients,
      chart: {
        title: chartTitle,
        subtitle: chartSubtitle,
        xAxisLabel: chartXAxisLabel,
        bars: chartBars,
        maxValue: chartMax,
        serviceSlices,
        pieGradient,
        totalServiceSliceCount,
      },
      highlights: [
        `Total active patient records: ${formatCompactNumber(totalPatients)}.`,
        peakBucket
          ? `${activeMetric === 'revenue' ? 'Highest revenue' : activeMetric === 'services' ? 'Most service entries' : 'Peak activity'} in the current view is ${peakBucket.dateLabel} with ${formatMetricValue(activeMetric, activeMetric === 'registrations' ? peakBucket.registrations : activeMetric === 'revenue' ? peakBucket.revenue : activeMetric === 'services' ? peakBucket.serviceCount : peakBucket.visits)}.`
          : 'Not enough historical activity yet to determine a peak period.',
        topServices[0]
          ? `Top service for the selected scope is ${topServices[0].label} with ${formatCompactNumber(topServices[0].count)} recorded entries.`
          : 'No service records are available yet.',
      ],
    }
  }, [activeMetric, patientRows, selectedMonth, selectedYear, serviceRecords, totalPatients, viewMode])

  const availableViewOptions = activeMetric === 'services'
    ? VIEW_OPTIONS.filter((option) => option.key !== 'compare')
    : VIEW_OPTIONS

  const yAxisMax = Math.max(5, Math.ceil(dashboard.chart.maxValue / 5) * 5)
  const yTicks = Array.from({ length: 6 }, (_, index) => yAxisMax - ((yAxisMax / 5) * index))

  const getBarHeight = (value) => {
    if (!value) return '0%'
    const rawPercent = (value / yAxisMax) * 100
    return `${Math.max(rawPercent, 4)}%`
  }

  return (
    <>
      <div className="home-page analytics-home">
        <section className="top-row analytics-top-row">
          <div className="greeting-card analytics-hero">
            <p>Dashboard Overview</p>
            <h1>{getStaffFullName(currentProfile)}</h1>
            <span className="analytics-subtitle">Track patient movement, registrations, revenue, and service demand over time.</span>
          </div>

          {dashboard.stats.map((stat) => (
            <div key={stat.key} className="stat-card analytics-stat-card">
              <p>{stat.title}</p>
              <strong>{loading ? '-' : formatMetricValue(stat.metricKey, stat.value)}</strong>
              <span className="analytics-stat-delta">{loading ? 'Loading...' : stat.delta}</span>
            </div>
          ))}
        </section>

        <section className="analytics-filter-bar">
          <div className="analytics-filter-group wide">
            <span className="analytics-filter-label">Category</span>
            <div className="analytics-pill-group">
              {METRIC_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`analytics-pill ${activeMetric === option.key ? 'active' : ''}`}
                  onClick={() => {
                    setActiveMetric(option.key)
                    setHoveredKey(null)
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="analytics-filter-group">
            <span className="analytics-filter-label">View Type</span>
            <div className="analytics-pill-group">
              {availableViewOptions.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`analytics-pill ${viewMode === option.key ? 'active' : ''}`}
                  onClick={() => {
                    setViewMode(option.key)
                    setHoveredKey(null)
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="analytics-filter-group">
            <span className="analytics-filter-label">Year</span>
            <select value={selectedYear} onChange={(event) => setSelectedYear(Number(event.target.value))}>
              {dashboard.availableYears.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>

          {viewMode === 'month' ? (
            <div className="analytics-filter-group">
              <span className="analytics-filter-label">Month</span>
              <select value={selectedMonth} onChange={(event) => setSelectedMonth(Number(event.target.value))}>
                {MONTH_ABBR.map((label, index) => (
                  <option key={label} value={index}>{label}</option>
                ))}
              </select>
            </div>
          ) : null}
        </section>

        <section className="panel">
          <div className="panel-card wide analytics-trend-card">
            <div className="analytics-card-head">
              <div>
                <h2>{dashboard.chart.title}</h2>
                <p className="muted">{dashboard.chart.subtitle}</p>
              </div>
            </div>

            <ErrorModal message={error} onClose={() => setError('')} />

            <div className="legend analytics-legend">
              {activeMetric === 'services' ? (
                dashboard.chart.serviceSlices.map((item) => (
                  <span
                    key={item.label}
                    className="legend-item analytics-service-legend-item"
                    style={{ '--legend-color': item.color }}
                  >
                    {item.label}
                  </span>
                ))
              ) : activeMetric === 'visits' ? (
                <>
                  <span className="legend-item male">Male</span>
                  <span className="legend-item female">Female</span>
                </>
              ) : (
                <span className="legend-item total-services">{activeMetric === 'revenue' ? 'Revenue' : 'Total'}</span>
              )}
            </div>

            <div className="chart-placeholder analytics-chart-shell">
              {activeMetric === 'services' ? (
                <div className="analytics-pie-layout">
                  <div className="analytics-pie-panel">
                    <div
                      className="analytics-pie-chart"
                      style={{ backgroundImage: dashboard.chart.pieGradient }}
                      aria-label={`${dashboard.chart.title} pie chart`}
                      role="img"
                    >
                      <div className="analytics-pie-center">
                        <strong>{formatCompactNumber(dashboard.chart.totalServiceSliceCount)}</strong>
                        <span>Total</span>
                      </div>
                    </div>
                  </div>
                  <div className="analytics-pie-list">
                    {dashboard.chart.serviceSlices.length > 0 ? dashboard.chart.serviceSlices.map((item) => {
                      const percent = dashboard.chart.totalServiceSliceCount > 0
                        ? (item.count / dashboard.chart.totalServiceSliceCount) * 100
                        : 0

                      return (
                        <div key={item.label} className="analytics-pie-row">
                          <span className="analytics-pie-name">
                            <span className="analytics-pie-dot" style={{ backgroundColor: item.color }} aria-hidden="true" />
                            {item.label}
                          </span>
                          <span className="analytics-pie-value">{formatCompactNumber(item.count)}</span>
                          <span className="analytics-pie-percent">{percent.toFixed(1)}%</span>
                        </div>
                      )
                    }) : (
                      <p className="analytics-pie-empty">No service records are available for this selection.</p>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <div className="chart-plot">
                    <div className="chart-y-scale">
                      {yTicks.map((tick) => (
                        <span
                          key={`tick-${tick}`}
                          className={`chart-y-tick ${tick === yAxisMax ? 'top' : ''} ${tick === 0 ? 'bottom' : ''}`}
                          style={{ bottom: `${(tick / yAxisMax) * 100}%` }}
                        >
                          {activeMetric === 'revenue' ? formatCompactNumber(tick) : tick}
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
                        <div className="weekly-bars-columns analytics-bars-columns">
                          {dashboard.chart.bars.map((item) => {
                            const metricValue = activeMetric === 'registrations'
                              ? item.registrations
                              : activeMetric === 'revenue'
                                ? item.revenue
                                : item.visits

                            return (
                              <div
                                key={item.key}
                                className="weekly-bar-item"
                                onMouseEnter={() => setHoveredKey(item.key)}
                                onMouseLeave={() => setHoveredKey(null)}
                                onFocus={() => setHoveredKey(item.key)}
                                onBlur={() => setHoveredKey(null)}
                                tabIndex={0}
                              >
                                <div className="weekly-bar-stack">
                                  {activeMetric === 'visits' ? (
                                    <>
                                      <div
                                        className="weekly-bar female"
                                        style={{ height: getBarHeight(item.female) }}
                                        title={`${item.dateLabel}: ${item.female} female`}
                                      />
                                      <div
                                        className="weekly-bar male"
                                        style={{ height: getBarHeight(item.male) }}
                                        title={`${item.dateLabel}: ${item.male} male`}
                                      />
                                    </>
                                  ) : (
                                    <div
                                      className="weekly-bar total-services"
                                      style={{ height: getBarHeight(metricValue) }}
                                      title={`${item.dateLabel}: ${formatMetricValue(activeMetric, metricValue)}`}
                                    />
                                  )}
                                </div>
                                {hoveredKey === item.key ? (
                                  <div className="weekly-bar-tooltip">
                                    <strong>{item.dateLabel}</strong>
                                    <span>Patient visits: {formatCompactNumber(item.visits)}</span>
                                    <span>Unique patients: {formatCompactNumber(item.uniquePatients)}</span>
                                    <span>Registrations: {formatCompactNumber(item.registrations)}</span>
                                    <span>Revenue: {formatCompactCurrency(item.revenue)}</span>
                                    <span>Service entries: {formatCompactNumber(item.serviceCount)}</span>
                                  </div>
                                ) : null}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                      <div className="weekly-x-labels" aria-hidden="true">
                        {dashboard.chart.bars.map((item) => <span key={`xlabel-${item.key}`}>{item.label}</span>)}
                      </div>
                    </div>
                  </div>
                  <span className="chart-label-y">{activeMetric === 'revenue' ? 'Revenue' : 'Count'}</span>
                  <span className="chart-label-x">{dashboard.chart.xAxisLabel}</span>
                </>
              )}
            </div>
          </div>
        </section>
      </div>
    </>
  )
}

export default Home
