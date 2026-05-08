import { useEffect, useMemo, useState } from 'react'
import ErrorModal from '../components/ErrorModal'
import { useNavigate } from 'react-router-dom'
import FilterDateInput from '../components/FilterDateInput'
import SortDirectionIcon from '../components/SortDirectionIcon'
import { supabase } from '../lib/supabaseClient'
import useSessionStorageState, { UI_SESSION_STORAGE_PREFIX } from '../hooks/useSessionStorageState'
import { recordSystemAudit } from '../utils/auditLog'

const DEFAULT_PAGE_SIZE = 10
const ROWS_PER_PAGE_OPTIONS = [10, 20, 30, 40, 50, 60]
const MONTH_ABBR = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May.', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.']
const PATIENT_RECORDS_UI_STORAGE_PREFIX = `${UI_SESSION_STORAGE_PREFIX}patientRecords.`

const formatDate = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return `${MONTH_ABBR[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`
}

const formatSex = (value) => {
  if (!value) return '-'
  if (value === 'Male') return 'M'
  if (value === 'Female') return 'F'
  return value
}

const formatPatientCode = (patientCode, patientId) => {
  const raw = `${patientCode || ''}`.trim()
  if (/^PT-\d{6}$/.test(raw)) return raw

  const digits = raw.replace(/\D/g, '')
  if (digits) return `PT-${digits.slice(-6).padStart(6, '0')}`

  const fallbackDigits = `${patientId || ''}`.replace(/\D/g, '').slice(-6)
  return `PT-${fallbackDigits.padStart(6, '0')}`
}

const calculateAge = (birthDate) => {
  if (!birthDate) return '-'
  const dob = new Date(birthDate)
  if (Number.isNaN(dob.getTime())) return '-'
  const now = new Date()
  let age = now.getFullYear() - dob.getFullYear()
  const monthDelta = now.getMonth() - dob.getMonth()
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < dob.getDate())) age -= 1
  return age < 0 ? '-' : age
}

const patientCodeNumber = (row) => {
  const code = formatPatientCode(row.patient_code, row.id)
  const digits = Number(code.replace(/\D/g, ''))
  return Number.isFinite(digits) ? digits : 0
}

function PatientRecords() {
  const navigate = useNavigate()
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState('patientId')
  const [nameSortDirection, setNameSortDirection] = useState('asc')
  const [registeredSortDirection, setRegisteredSortDirection] = useState('asc')
  const [patientIdSortDirection, setPatientIdSortDirection] = useState('desc')
  const [currentPage, setCurrentPage] = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_PAGE_SIZE)
  const [pageInput, setPageInput] = useState('1')
  const [statusConfirmRow, setStatusConfirmRow] = useSessionStorageState(`${PATIENT_RECORDS_UI_STORAGE_PREFIX}statusConfirmRow`, null)
  const [isStatusUpdating, setIsStatusUpdating] = useState(false)
  const [showFilters, setShowFilters] = useSessionStorageState(`${PATIENT_RECORDS_UI_STORAGE_PREFIX}filtersOpen`, false)
  const [sexFilter, setSexFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [minAgeFilter, setMinAgeFilter] = useState('')
  const [maxAgeFilter, setMaxAgeFilter] = useState('')
  const [registeredFromFilter, setRegisteredFromFilter] = useState('')
  const [registeredToFilter, setRegisteredToFilter] = useState('')

  const loadRecords = async () => {
    setLoading(true)
    setError('')

    const { data, error: fetchError } = await supabase
      .from('patients')
      .select('id, patient_code, first_name, last_name, sex, birth_date, created_at, is_active, archived_at')
      .is('archived_at', null)
      .order('created_at', { ascending: true })

    if (fetchError) {
      setError(fetchError.message)
      setRecords([])
      setLoading(false)
      return
    }

    setRecords(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    const bootstrapTimer = setTimeout(() => {
      void loadRecords()
    }, 0)

    return () => clearTimeout(bootstrapTimer)
  }, [])

  const toggleRecord = async (row) => {
    const nextIsActive = !row.is_active
    setError('')
    setIsStatusUpdating(true)
    setStatusConfirmRow(null)

    // Optimistic update for snappier UI; rollback only if save fails.
    setRecords((prev) =>
      prev.map((item) => (
        item.id === row.id
          ? {
            ...item,
            is_active: nextIsActive,
            archived_at: null,
          }
          : item
      )),
    )

    try {
      const { data: authData } = await supabase.auth.getUser()
      const actorId = authData?.user?.id ?? null

      const { error: updateError } = await supabase
        .from('patients')
        .update({
          is_active: nextIsActive,
          archived_at: null,
          archived_by: null,
          updated_by: actorId,
        })
        .eq('id', row.id)

      if (updateError) throw updateError

      const { error: logError } = await supabase
        .from('patient_logs')
        .insert({
          patient_id: row.id,
          action: nextIsActive ? 'retrieve' : 'archive',
          details: nextIsActive ? 'Set patient active' : 'Set patient inactive',
        })

      if (logError) {
        setError(logError.message)
      }

      await recordSystemAudit({
        action: nextIsActive ? 'patient_retrieved' : 'patient_inactivated',
        entityType: 'patient',
        entityId: row.id,
        entityLabel: `${row.last_name}, ${row.first_name}`,
        details: nextIsActive ? 'Set patient active.' : 'Set patient inactive.',
      })
    } catch (updateError) {
      // Rollback optimistic state if the database update failed.
      setRecords((prev) =>
        prev.map((item) => (
          item.id === row.id
            ? {
              ...item,
              is_active: row.is_active,
              archived_at: row.archived_at ?? null,
            }
            : item
        )),
      )
      setError(updateError.message)
    } finally {
      setIsStatusUpdating(false)
    }
  }

  const filteredRecords = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    const source = query
      ? records.filter((row) => `${row.last_name}, ${row.first_name}`.toLowerCase().includes(query))
      : [...records]

    const filtered = source.filter((row) => {
      if (sexFilter && row.sex !== sexFilter) return false

      if (statusFilter === 'active' && !row.is_active) return false
      if (statusFilter === 'inactive' && row.is_active) return false

      const age = calculateAge(row.birth_date)
      const numericAge = typeof age === 'number' ? age : Number.parseInt(`${age}`, 10)
      const minAge = Number.parseInt(minAgeFilter, 10)
      const maxAge = Number.parseInt(maxAgeFilter, 10)

      if (Number.isFinite(minAge) && (!Number.isFinite(numericAge) || numericAge < minAge)) return false
      if (Number.isFinite(maxAge) && (!Number.isFinite(numericAge) || numericAge > maxAge)) return false

      const createdDate = `${row.created_at || ''}`.slice(0, 10)
      if (registeredFromFilter && (!createdDate || createdDate < registeredFromFilter)) return false
      if (registeredToFilter && (!createdDate || createdDate > registeredToFilter)) return false

      return true
    })

    if (sortBy === 'registered') {
      const multiplier = registeredSortDirection === 'asc' ? 1 : -1
      return filtered.sort((a, b) => (
        (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * multiplier
      ))
    }

    if (sortBy === 'patientId') {
      const multiplier = patientIdSortDirection === 'asc' ? 1 : -1
      return filtered.sort((a, b) => (patientCodeNumber(a) - patientCodeNumber(b)) * multiplier)
    }

    return filtered.sort((a, b) => {
      const aName = `${a.last_name}, ${a.first_name}`.toLowerCase()
      const bName = `${b.last_name}, ${b.first_name}`.toLowerCase()
      return nameSortDirection === 'asc'
        ? aName.localeCompare(bName)
        : bName.localeCompare(aName)
    })
  }, [
    maxAgeFilter,
    minAgeFilter,
    nameSortDirection,
    patientIdSortDirection,
    records,
    registeredFromFilter,
    registeredSortDirection,
    registeredToFilter,
    searchTerm,
    sexFilter,
    sortBy,
    statusFilter,
  ])

  const hasActiveFilters = Boolean(
    sexFilter
    || statusFilter
    || minAgeFilter
    || maxAgeFilter
    || registeredFromFilter
    || registeredToFilter,
  )

  const clearFilters = () => {
    setSexFilter('')
    setStatusFilter('')
    setMinAgeFilter('')
    setMaxAgeFilter('')
    setRegisteredFromFilter('')
    setRegisteredToFilter('')
    setCurrentPage(1)
    setPageInput('1')
  }

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / rowsPerPage))
  const safePage = Math.min(currentPage, totalPages)
  const pageStart = (safePage - 1) * rowsPerPage
  const pagedRecords = filteredRecords.slice(pageStart, pageStart + rowsPerPage)
  const activeCount = useMemo(() => filteredRecords.filter((row) => row.is_active).length, [filteredRecords])
  const visibleStart = filteredRecords.length === 0 ? 0 : pageStart + 1
  const visibleEnd = filteredRecords.length === 0 ? 0 : Math.min(pageStart + rowsPerPage, filteredRecords.length)
  const currentSortDirection = (
    sortBy === 'registered'
      ? registeredSortDirection
      : sortBy === 'patientId'
        ? patientIdSortDirection
        : nameSortDirection
  )
  const currentSortDirectionLabel = (
    sortBy === 'registered'
      ? currentSortDirection === 'asc'
        ? 'Oldest to newest'
        : 'Newest to oldest'
      : currentSortDirection === 'asc'
        ? 'Ascending'
        : 'Descending'
  )
  const getVisiblePageItems = () => {
    if (totalPages <= 3) return Array.from({ length: totalPages }, (_, index) => index + 1)

    const startPage = Math.max(1, Math.min(safePage - 1, totalPages - 2))
    return Array.from({ length: 3 }, (_, index) => startPage + index)
  }
  const pageItems = getVisiblePageItems()

  const handlePageJump = () => {
    const parsedPage = Number.parseInt(pageInput, 10)
    if (!Number.isFinite(parsedPage)) {
      setPageInput(`${currentPage}`)
      return
    }

    const nextPage = Math.min(Math.max(parsedPage, 1), totalPages)
    setCurrentPage(nextPage)
    setPageInput(`${nextPage}`)
  }

  return (
    <>
      <header className="page-header">
        <h1>Patient Records</h1>
      </header>

      <section className="records fixed-table-page patient-records-page">
        <div className="records-header patient-records-header">
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
            <button type="button" className="primary" onClick={() => navigate('/add-patient')}>
              Add New Patient
            </button>
            <button
              type="button"
              className={`ghost records-filter-toggle ${showFilters ? 'is-open' : ''}`}
              onClick={() => setShowFilters((previous) => !previous)}
            >
              Filters
            </button>
            <div className="sorter">
              <label htmlFor="sort">Sort by:</label>
              <select
                id="sort"
                value={sortBy}
                onChange={(event) => {
                  setSortBy(event.target.value)
                  setCurrentPage(1)
                  setPageInput('1')
                }}
              >
                <option value="name">Name</option>
                <option value="patientId">Patient ID</option>
                <option value="registered">Date Registered</option>
              </select>
              <button
                type="button"
                className="ghost sort-direction-btn"
                aria-label={currentSortDirectionLabel}
                title={currentSortDirectionLabel}
                onClick={() => {
                  if (sortBy === 'registered') {
                    setRegisteredSortDirection((previous) => (previous === 'asc' ? 'desc' : 'asc'))
                  } else if (sortBy === 'patientId') {
                    setPatientIdSortDirection((previous) => (previous === 'asc' ? 'desc' : 'asc'))
                  } else {
                    setNameSortDirection((previous) => (previous === 'asc' ? 'desc' : 'asc'))
                  }
                  setCurrentPage(1)
                  setPageInput('1')
                }}
              >
                <SortDirectionIcon
                  direction={currentSortDirection}
                />
              </button>
            </div>
          </div>
        </div>

        <ErrorModal message={error} onClose={() => setError('')} />
        {loading ? <p>Loading patient records...</p> : null}

        <div className="records-table patient-records-table">
          <div className="table-head">
            <span>Patient ID</span>
            <span>Full Name</span>
            <span>Sex</span>
            <span>Age</span>
            <span>Date Registered</span>
            <span>Status</span>
            <span>Actions</span>
          </div>
          <div className="table-body">
            {pagedRecords.map((row) => (
              <div key={row.id} className={`table-row ${row.is_active ? '' : 'inactive-row'}`}>
                <span>{formatPatientCode(row.patient_code, row.id)}</span>
                <span>{`${row.last_name}, ${row.first_name}`}</span>
                <span>{formatSex(row.sex)}</span>
                <span>{calculateAge(row.birth_date)}</span>
                <span>{formatDate(row.created_at)}</span>
                <span>
                  <button
                    type="button"
                    className={`status ${row.is_active ? 'on' : 'off'}`}
                    aria-label={`Set ${row.last_name}, ${row.first_name} as ${row.is_active ? 'inactive' : 'active'}`}
                    title={row.is_active ? 'Active' : 'Inactive'}
                    onClick={() => {
                      setError('')
                      setStatusConfirmRow(row)
                    }}
                  />
                </span>
                <span>
                  <button
                    type="button"
                    className="view"
                    onClick={() => navigate(`/records/${row.id}`)}
                  >
                    View
                  </button>
                </span>
              </div>
            ))}
            {!loading && filteredRecords.length === 0 ? <p>No records found.</p> : null}
          </div>
        </div>

        <div className="records-footer">
          <span>
            Showing {visibleStart}-{visibleEnd} of {filteredRecords.length} entries ({activeCount} active / {filteredRecords.length - activeCount} inactive)
          </span>
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
                    <button
                      key={item}
                      type="button"
                      className={item === safePage ? 'active' : ''}
                      onClick={() => { setCurrentPage(item); setPageInput(`${item}`) }}
                    >
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
                  handlePageJump()
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
      </section>

      {showFilters ? <div className="modal-backdrop" onClick={() => setShowFilters(false)} /> : null}
      {showFilters ? (
        <div className="pr-modal procedures-modal patient-records-filter-modal">
          <div className="pr-modal-head">
            <h2>Filters</h2>
            <button type="button" onClick={() => setShowFilters(false)}>X</button>
          </div>
          <div className="pr-modal-body">
            <div className="records-filter-panel patient-records-filter-panel">
              <label className="inline-field" htmlFor="patient-filter-sex">
                Sex:
                <select
                  id="patient-filter-sex"
                  value={sexFilter}
                  onChange={(event) => {
                    setSexFilter(event.target.value)
                    setCurrentPage(1)
                    setPageInput('1')
                  }}
                >
                  <option value="">All</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
              </label>
              <label className="inline-field" htmlFor="patient-filter-age-min">
                Age Min:
                <input
                  id="patient-filter-age-min"
                  type="number"
                  min="0"
                  value={minAgeFilter}
                  onChange={(event) => {
                    setMinAgeFilter(event.target.value)
                    setCurrentPage(1)
                    setPageInput('1')
                  }}
                />
              </label>
              <label className="inline-field" htmlFor="patient-filter-age-max">
                Age Max:
                <input
                  id="patient-filter-age-max"
                  type="number"
                  min="0"
                  value={maxAgeFilter}
                  onChange={(event) => {
                    setMaxAgeFilter(event.target.value)
                    setCurrentPage(1)
                    setPageInput('1')
                  }}
                />
              </label>
              <label className="inline-field" htmlFor="patient-filter-registered-from">
                Registered From:
                <FilterDateInput
                  id="patient-filter-registered-from"
                  value={registeredFromFilter}
                  onChange={(nextValue) => {
                    setRegisteredFromFilter(nextValue)
                    setCurrentPage(1)
                    setPageInput('1')
                  }}
                />
              </label>
              <label className="inline-field" htmlFor="patient-filter-registered-to">
                Registered To:
                <FilterDateInput
                  id="patient-filter-registered-to"
                  value={registeredToFilter}
                  onChange={(nextValue) => {
                    setRegisteredToFilter(nextValue)
                    setCurrentPage(1)
                    setPageInput('1')
                  }}
                />
              </label>
              <label className="inline-field" htmlFor="patient-filter-status">
                Status:
                <select
                  id="patient-filter-status"
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value)
                    setCurrentPage(1)
                    setPageInput('1')
                  }}
                >
                  <option value="">All</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
            </div>
            <div className="modal-actions patient-records-filter-actions">
              <button type="button" className="ghost records-filter-clear" onClick={clearFilters} disabled={!hasActiveFilters}>
                Clear Filters
              </button>
              <button type="button" className="success-btn" onClick={() => setShowFilters(false)}>
                Apply
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {statusConfirmRow ? <div className="modal-backdrop" onClick={() => { if (!isStatusUpdating) setStatusConfirmRow(null) }} /> : null}
      {statusConfirmRow ? (
        <div className="pr-modal procedures-modal archive-modal status-confirm-modal">
          <div className="pr-modal-head"><h2>Confirm Status</h2></div>
          <div className="pr-modal-body">
            <p>
              Are you sure you want to {statusConfirmRow.is_active ? 'inactive' : 'active'} this user?
            </p>
            <div className="modal-actions">
              <button type="button" className="danger-btn" disabled={isStatusUpdating} onClick={() => setStatusConfirmRow(null)}>No</button>
              <button type="button" className="success-btn" disabled={isStatusUpdating} onClick={() => { void toggleRecord(statusConfirmRow) }}>
                {isStatusUpdating ? 'Saving...' : 'Yes'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

export default PatientRecords
