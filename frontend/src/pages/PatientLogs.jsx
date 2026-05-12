import { useEffect, useMemo, useState } from 'react'
import ErrorModal from '../components/ErrorModal'
import FilterDateInput from '../components/FilterDateInput'
import SortDirectionIcon from '../components/SortDirectionIcon'
import { supabase } from '../lib/supabaseClient'
import useSessionStorageState, { UI_SESSION_STORAGE_PREFIX } from '../hooks/useSessionStorageState'

const DEFAULT_PAGE_SIZE = 10
const ROWS_PER_PAGE_OPTIONS = [10, 20, 30, 40, 50, 60]
const MONTH_ABBR = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May.', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.']
const PATIENT_LOGS_UI_STORAGE_PREFIX = `${UI_SESSION_STORAGE_PREFIX}patientLogs.`
const MANILA_TIME_ZONE = 'Asia/Manila'
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const getSortDirectionLabel = (direction, isDateSort = false) => (
  isDateSort
    ? direction === 'asc'
      ? 'Oldest to newest'
      : 'Newest to oldest'
    : direction === 'asc'
      ? 'Ascending'
      : 'Descending'
)

const isFreshFileImportLog = (details) => {
  const normalized = `${details ?? ''}`.trim().toLowerCase()
  return normalized === 'imported service record migration.'
    || normalized === 'imported service record migration'
}

const getManilaDateParts = (date) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MANILA_TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date)

  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)
  const day = Number(parts.find((part) => part.type === 'day')?.value)

  if (!year || !month || !day) return null

  return { year, month, day }
}

const formatDateLabelFromParts = (parts) => `${MONTH_ABBR[parts.month - 1]} ${parts.day}, ${parts.year}`

const formatDateTime = (value, details) => {
  if (!value) return '-'

  const rawValue = `${value}`.trim()
  if (!rawValue) return '-'

  if (DATE_ONLY_PATTERN.test(rawValue)) {
    const [year, month, day] = rawValue.split('-').map(Number)
    if (!year || !month || !day) return '-'
    return formatDateLabelFromParts({ year, month, day })
  }

  const date = new Date(rawValue)
  if (Number.isNaN(date.getTime())) return '-'

  const dateParts = getManilaDateParts(date)
  if (!dateParts) return '-'

  const dateLabel = formatDateLabelFromParts(dateParts)
  if (isFreshFileImportLog(details)) return dateLabel

  const timeLabel = date.toLocaleTimeString('en-US', {
    timeZone: MANILA_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
  })
  return `${dateLabel} ${timeLabel}`
}

const formatManilaIsoDate = (value) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value ?? ''
  const month = parts.find((part) => part.type === 'month')?.value ?? ''
  const day = parts.find((part) => part.type === 'day')?.value ?? ''
  return year && month && day ? `${year}-${month}-${day}` : ''
}

const toLocalIsoDate = (value) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const formatPatientCode = (patientCode, patientId) => {
  const raw = `${patientCode || ''}`.trim()
  if (/^PT-\d{6}$/.test(raw)) return raw

  const digits = raw.replace(/\D/g, '')
  if (digits) return `PT-${digits.slice(-6).padStart(6, '0')}`

  const fallbackDigits = `${patientId || ''}`.replace(/\D/g, '').slice(-6)
  return `PT-${fallbackDigits.padStart(6, '0')}`
}

const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(`${value ?? ''}`.trim())

const getLatestEntryMap = (rows, dateField) => rows.reduce((map, row) => {
  const dayKey = formatManilaIsoDate(row?.[dateField])
  if (!row?.patient_id || !dayKey) return map

  const compositeKey = `${row.patient_id}|${dayKey}`
  const currentTime = new Date(row?.[dateField] || 0).getTime()
  const existing = map.get(compositeKey)
  const existingTime = new Date(existing?.[dateField] || 0).getTime()

  if (!existing || currentTime > existingTime) {
    map.set(compositeKey, row)
  }

  return map
}, new Map())

const resolveAssignedDentists = async (logRows) => {
  const patientIds = [...new Set((logRows ?? []).map((row) => row.patient_id).filter(Boolean))]
  if (patientIds.length === 0) return logRows ?? []

  const [{ data: dentalRows, error: dentalError }, { data: serviceRows, error: serviceError }] = await Promise.all([
    supabase
      .from('dental_records')
      .select('patient_id, recorded_at, chart_data, updated_by, created_by')
      .in('patient_id', patientIds)
      .is('archived_at', null),
    supabase
      .from('service_records')
      .select('patient_id, visit_at, performed_by')
      .in('patient_id', patientIds)
      .is('archived_at', null),
  ])

  if (dentalError) throw dentalError
  if (serviceError) throw serviceError

  const dentalByPatientDay = getLatestEntryMap(dentalRows ?? [], 'recorded_at')
  const serviceByPatientDay = getLatestEntryMap(serviceRows ?? [], 'visit_at')

  const staffIds = [...new Set(
    [
      ...(dentalRows ?? []).flatMap((row) => [
        row?.chart_data?.dentist_user_id,
        row?.updated_by,
        row?.created_by,
      ]),
      ...(serviceRows ?? []).map((row) => row?.performed_by),
    ].filter((value) => isUuid(value)),
  )]

  let staffNames = {}
  if (staffIds.length > 0) {
    const { data: staffRows, error: staffError } = await supabase.rpc('lookup_staff_names', { p_user_ids: staffIds })
    if (staffError) throw staffError
    staffNames = Object.fromEntries((staffRows ?? []).map((row) => [row.user_id, row.full_name]))
  }

  return (logRows ?? []).map((row) => {
    const dayKey = formatManilaIsoDate(row.logged_at)
    const compositeKey = `${row.patient_id}|${dayKey}`
    const dentalRow = dentalByPatientDay.get(compositeKey)
    const serviceRow = serviceByPatientDay.get(compositeKey)
    const dentistUserId = dentalRow?.chart_data?.dentist_user_id
    const dentistName = `${dentalRow?.chart_data?.dentist ?? ''}`.trim()
    const auditUserId = dentalRow?.updated_by || dentalRow?.created_by || ''
    const performerUserId = serviceRow?.performed_by || ''

    return {
      ...row,
      actor_name: staffNames[dentistUserId]
        || dentistName
        || staffNames[performerUserId]
        || staffNames[auditUserId]
        || row.actor_name,
    }
  })
}

function PatientLogs() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [dateFromFilter, setDateFromFilter] = useState('')
  const [dateToFilter, setDateToFilter] = useState('')
  const [sortOrder, setSortOrder] = useState('desc')
  const [currentPage, setCurrentPage] = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_PAGE_SIZE)
  const [pageInput, setPageInput] = useState('1')
  const [showFilters, setShowFilters] = useSessionStorageState(`${PATIENT_LOGS_UI_STORAGE_PREFIX}filtersOpen`, false)

  const loadLogs = async () => {
    setLoading(true)
    setError('')

    const { data, error: fetchError } = await supabase.rpc('list_patient_logs')
    if (fetchError) {
      setError(fetchError.message)
      setLogs([])
      setLoading(false)
      return
    }

    try {
      const resolvedLogs = await resolveAssignedDentists(data ?? [])
      setLogs(resolvedLogs)
      setLoading(false)
    } catch (resolveError) {
      setLogs(data ?? [])
      setError(resolveError.message || 'Unable to resolve assigned dentist names.')
      setLoading(false)
    }
  }

  useEffect(() => {
    const bootstrapTimer = setTimeout(() => {
      void loadLogs()
    }, 0)

    return () => clearTimeout(bootstrapTimer)
  }, [])

  const filteredLogs = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()

    const attendanceRows = (logs ?? []).filter((row) => `${row.action ?? ''}`.trim().toLowerCase() === 'service_update')

    const rows = attendanceRows.filter((row) => {
      if (query && !`${row.patient_name}`.toLowerCase().includes(query)) return false

      const rowDate = new Date(row.logged_at)
      if (Number.isNaN(rowDate.getTime())) return !(dateFromFilter || dateToFilter)

      const normalized = toLocalIsoDate(rowDate)
      if (dateFromFilter && normalized < dateFromFilter) return false
      if (dateToFilter && normalized > dateToFilter) return false

      return true
    })

    return rows.sort((a, b) => {
      const aTime = new Date(a.logged_at).getTime()
      const bTime = new Date(b.logged_at).getTime()
      return sortOrder === 'asc' ? aTime - bTime : bTime - aTime
    })
  }, [dateFromFilter, dateToFilter, logs, searchTerm, sortOrder])

  const handlePageJump = (totalPages) => {
    const parsedPage = Number.parseInt(pageInput, 10)
    if (!Number.isFinite(parsedPage)) {
      setPageInput(`${currentPage}`)
      return
    }

    const nextPage = Math.min(Math.max(parsedPage, 1), totalPages)
    setCurrentPage(nextPage)
    setPageInput(`${nextPage}`)
  }

  const getVisiblePageItems = (safePage, totalPages) => {
    if (totalPages <= 3) return Array.from({ length: totalPages }, (_, index) => index + 1)

    const startPage = Math.max(1, Math.min(safePage - 1, totalPages - 2))
    return Array.from({ length: 3 }, (_, index) => startPage + index)
  }

  const clearFilters = () => {
    setDateFromFilter('')
    setDateToFilter('')
    setCurrentPage(1)
    setPageInput('1')
  }

  return (
    <>
      <header className="page-header">
        <h1>Patient Logs</h1>
      </header>

      <section className="records fixed-table-page patient-logs-page">
        <div className="records-header patient-logs-header">
          <div>
            <div className="records-toolbar">
              <div className="search-box">
                <span className="search-icon" aria-hidden />
                <input
                  type="text"
                  placeholder="Search by Name"
                  value={searchTerm}
                  onChange={(event) => {
                    setSearchTerm(event.target.value)
                    setCurrentPage(1)
                    setPageInput('1')
                  }}
                />
              </div>
            </div>
          </div>
          <div className="records-actions">
            <button
              type="button"
              className={`ghost records-filter-toggle ${showFilters ? 'is-open' : ''}`}
              onClick={() => setShowFilters(true)}
            >
              Filters
            </button>
            <div className="sorter">
              <label htmlFor="logs-sort">Sort by:</label>
              <select id="logs-sort" value="date" onChange={() => {}}>
                <option value="date">Date</option>
              </select>
              <button
                type="button"
                className="ghost sort-direction-btn"
                aria-label={getSortDirectionLabel(sortOrder, true)}
                title={getSortDirectionLabel(sortOrder, true)}
                onClick={() => {
                  setSortOrder((previous) => (previous === 'asc' ? 'desc' : 'asc'))
                  setCurrentPage(1)
                  setPageInput('1')
                }}
              >
                <SortDirectionIcon direction={sortOrder} />
              </button>
            </div>
          </div>
        </div>

        <ErrorModal message={error} onClose={() => setError('')} />
        {loading ? <p>Loading patient logs...</p> : null}

        {(() => {
          const totalPages = Math.max(1, Math.ceil(filteredLogs.length / rowsPerPage))
          const safePage = Math.min(currentPage, totalPages)
          const pageStart = (safePage - 1) * rowsPerPage
          const pagedLogs = filteredLogs.slice(pageStart, pageStart + rowsPerPage)
          const pageItems = getVisiblePageItems(safePage, totalPages)
          const visibleStart = filteredLogs.length === 0 ? 0 : pageStart + 1
          const visibleEnd = filteredLogs.length === 0 ? 0 : Math.min(pageStart + rowsPerPage, filteredLogs.length)

          return (
            <>
              <div className="records-table logs-table">
                <div className="table-head">
                  <span>Patient ID</span>
                  <span>Patient Name</span>
                  <span>Date &amp; time</span>
                  <span>Assigned dentist</span>
                </div>
                <div className="table-body">
                  {pagedLogs.map((row) => (
                    <div key={row.id} className="table-row">
                      <span>{formatPatientCode(row.patient_code, row.patient_id)}</span>
                      <span>{row.patient_name}</span>
                      <span>{formatDateTime(row.logged_at, row.details)}</span>
                      <span>{row.actor_name}</span>
                    </div>
                  ))}
                  {!loading && filteredLogs.length === 0 ? <p>No logs found.</p> : null}
                </div>
              </div>

              <div className="records-footer">
                <span>Showing {visibleStart}-{visibleEnd} of {filteredLogs.length} entries</span>
                <div className="pagination">
                  <div className="pagination-group pagination-size-group">
                    <label className="page-size-control">
                      Rows
                      <select
                        value={rowsPerPage}
                        onChange={(event) => {
                          const nextPageSize = Number(event.target.value)
                          setRowsPerPage(nextPageSize)
                          setCurrentPage(1)
                          setPageInput('1')
                        }}
                      >
                        {ROWS_PER_PAGE_OPTIONS.map((size) => (
                          <option key={size} value={size}>{size}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="pagination-group pagination-nav-group">
                    <button type="button" aria-label="Previous page" disabled={safePage <= 1} onClick={() => { const nextPage = Math.max(1, safePage - 1); setCurrentPage(nextPage); setPageInput(`${nextPage}`) }}>&#10094;</button>
                    {pageItems.map((item) => (
                      typeof item === 'number'
                        ? (
                          <button key={item} type="button" className={item === safePage ? 'active' : ''} onClick={() => { setCurrentPage(item); setPageInput(`${item}`) }}>
                            {item}
                          </button>
                        )
                        : <span key={item} className="pagination-ellipsis">...</span>
                    ))}
                    <button type="button" aria-label="Next page" disabled={safePage >= totalPages} onClick={() => { const nextPage = Math.min(totalPages, safePage + 1); setCurrentPage(nextPage); setPageInput(`${nextPage}`) }}>&#10095;</button>
                  </div>
                  <div className="pagination-group pagination-jump-group">
                    <form
                      className="page-jump-form"
                      onSubmit={(event) => {
                        event.preventDefault()
                        handlePageJump(totalPages)
                      }}
                    >
                      <label>
                        Page
                        <input
                          type="number"
                          min="1"
                          max={totalPages}
                          value={pageInput}
                          onChange={(event) => setPageInput(event.target.value)}
                        />
                      </label>
                      <button type="submit">Go</button>
                    </form>
                  </div>
                </div>
              </div>
            </>
          )
        })()}
      </section>

      {showFilters ? <div className="modal-backdrop" onClick={() => setShowFilters(false)} /> : null}
      {showFilters ? (
        <div className="pr-modal procedures-modal patient-logs-filter-modal">
          <div className="pr-modal-head">
            <h2>Filters</h2>
            <button type="button" onClick={() => setShowFilters(false)}>X</button>
          </div>
          <div className="pr-modal-body">
            <div className="records-filter-panel patient-logs-filter-panel">
              <label className="inline-field" htmlFor="logs-filter-date-from">
                Date From:
                <FilterDateInput
                  id="logs-filter-date-from"
                  value={dateFromFilter}
                  onChange={(nextValue) => {
                    setDateFromFilter(nextValue)
                    setCurrentPage(1)
                    setPageInput('1')
                  }}
                />
              </label>
              <label className="inline-field" htmlFor="logs-filter-date-to">
                Date To:
                <FilterDateInput
                  id="logs-filter-date-to"
                  value={dateToFilter}
                  onChange={(nextValue) => {
                    setDateToFilter(nextValue)
                    setCurrentPage(1)
                    setPageInput('1')
                  }}
                />
              </label>
            </div>
            <div className="modal-actions patient-logs-filter-actions">
              <button type="button" className="ghost records-filter-clear" onClick={clearFilters} disabled={!dateFromFilter && !dateToFilter}>
                Clear Filters
              </button>
              <button type="button" className="success-btn" onClick={() => setShowFilters(false)}>
                Apply
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

export default PatientLogs
