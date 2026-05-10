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
const MANILA_UTC_OFFSET = '+08:00'
const MANILA_TIME_ZONE = 'Asia/Manila'

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
    dateKey,
    startIso: new Date(`${dateKey}T00:00:00.000${MANILA_UTC_OFFSET}`).toISOString(),
    endIso: new Date(`${dateKey}T23:59:59.999${MANILA_UTC_OFFSET}`).toISOString(),
  }
}

const formatDate = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return `${MONTH_ABBR[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`
}

const formatDateTime = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  const dateLabel = `${MONTH_ABBR[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`
  const timeLabel = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
  return `${dateLabel} ${timeLabel}`
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

const formatStaffDisplayName = (profile) => {
  const fullName = `${profile?.full_name || ''}`.trim()
  if (fullName) return fullName
  return '-'
}

const fetchStaffNames = async (userIds) => {
  const ids = [...new Set((userIds ?? []).filter(Boolean))]
  if (!ids.length) return {}

  let data = null
  let fetchError = null

  const rpcResult = await supabase.rpc('lookup_staff_names', { p_user_ids: ids })
  data = rpcResult.data
  fetchError = rpcResult.error

  if (fetchError) {
    const fallbackResult = await supabase
      .from('staff_profiles')
      .select('user_id, full_name')
      .in('user_id', ids)

    data = fallbackResult.data
    fetchError = fallbackResult.error
  }

  if (fetchError) throw fetchError

  return Object.fromEntries((data ?? []).map((row) => [row.user_id, formatStaffDisplayName(row)]))
}

function PatientRecords({ currentRole, queueEnabled = true }) {
  const navigate = useNavigate()
  const [records, setRecords] = useState([])
  const [queueEntries, setQueueEntries] = useState([])
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
  const [showQueueModal, setShowQueueModal] = useState(false)
  const [queueActionKey, setQueueActionKey] = useState('')
  const [queueStatusViewFilter, setQueueStatusViewFilter] = useSessionStorageState(
    `${PATIENT_RECORDS_UI_STORAGE_PREFIX}queueStatusViewFilter`,
    'pending',
  )
  const [acknowledgedAcceptedQueueIds, setAcknowledgedAcceptedQueueIds] = useSessionStorageState(
    `${PATIENT_RECORDS_UI_STORAGE_PREFIX}acknowledgedAcceptedQueueIds`,
    [],
  )
  const [sexFilter, setSexFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [minAgeFilter, setMinAgeFilter] = useState('')
  const [maxAgeFilter, setMaxAgeFilter] = useState('')
  const [registeredFromFilter, setRegisteredFromFilter] = useState('')
  const [registeredToFilter, setRegisteredToFilter] = useState('')

  const canAcceptQueue = currentRole === 'admin' || currentRole === 'associate_dentist'
  const canManageQueue = Boolean(currentRole)

  const loadQueueEntries = async () => {
    const todayQueueRange = getManilaDayRange()
    const { data, error: queueError } = await supabase
      .from('patient_queue_entries')
      .select('id, patient_id, queue_status, queued_by, queued_at, accepted_by, accepted_at, patients(id, patient_code, first_name, last_name, sex, birth_date)')
      .in('queue_status', ['pending', 'accepted'])
      .gte('queued_at', todayQueueRange.startIso)
      .lte('queued_at', todayQueueRange.endIso)
      .order('queued_at', { ascending: true })

    if (queueError) throw queueError

    const queueRows = data ?? []
    const staffNames = await fetchStaffNames(
      queueRows.flatMap((row) => [row.queued_by, row.accepted_by]).filter(Boolean),
    )

    const normalizedQueue = queueRows.map((row) => {
      const patientData = Array.isArray(row.patients) ? row.patients[0] : row.patients
      return {
        id: row.id,
        patientId: row.patient_id,
        queueStatus: row.queue_status,
        queuedBy: row.queued_by,
        queuedByName: staffNames[row.queued_by] || '-',
        queuedAt: row.queued_at,
        acceptedBy: row.accepted_by,
        acceptedByName: staffNames[row.accepted_by] || '-',
        acceptedAt: row.accepted_at,
        patient: patientData
          ? {
            id: patientData.id,
            patient_code: patientData.patient_code,
            first_name: patientData.first_name,
            last_name: patientData.last_name,
            sex: patientData.sex,
            birth_date: patientData.birth_date,
          }
          : null,
      }
    })

    setQueueEntries(normalizedQueue)
  }

  const loadPatientRows = async () => {
    const { data, error: patientsError } = await supabase
      .from('patients')
      .select('id, patient_code, first_name, last_name, sex, birth_date, created_at, is_active, archived_at')
      .is('archived_at', null)
      .order('created_at', { ascending: true })

    if (patientsError) throw patientsError
    setRecords(data ?? [])
  }

  const loadRecords = async () => {
    setLoading(true)
    setError('')

    try {
      await Promise.all([loadPatientRows(), loadQueueEntries()])
    } catch (fetchError) {
      setError(fetchError.message)
      setRecords([])
      setQueueEntries([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const bootstrapTimer = setTimeout(() => {
      void loadRecords()
    }, 0)

    return () => clearTimeout(bootstrapTimer)
  }, [])

  useEffect(() => {
    const channel = supabase
      .channel('patient-queue-live')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'patient_queue_entries',
        },
        () => {
          void loadQueueEntries().catch((queueError) => {
            setError(queueError?.message || 'Unable to refresh patient queue.')
          })
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [])

  const pendingQueueEntries = useMemo(
    () => queueEntries.filter((entry) => entry.queueStatus === 'pending'),
    [queueEntries],
  )

  const acceptedQueueEntries = useMemo(
    () => queueEntries.filter((entry) => entry.queueStatus === 'accepted'),
    [queueEntries],
  )

  const visibleQueueEntries = useMemo(
    () => queueEntries,
    [queueEntries],
  )

  const filteredQueueEntries = useMemo(
    () => (
      queueStatusViewFilter === 'accepted'
        ? visibleQueueEntries.filter((entry) => entry.queueStatus === 'accepted')
        : queueStatusViewFilter === 'pending'
          ? visibleQueueEntries.filter((entry) => entry.queueStatus === 'pending')
          : visibleQueueEntries
    ),
    [queueStatusViewFilter, visibleQueueEntries],
  )

  const receptionistRoomAssignments = useMemo(() => {
    const slots = [
      { slotId: 'room-slot-1', entryId: null, dentistName: 'Unassigned', patientName: 'No accepted queue yet' },
      { slotId: 'room-slot-2', entryId: null, dentistName: 'Unassigned', patientName: 'No accepted queue yet' },
    ]

    const sortedAcceptedQueueEntries = [...acceptedQueueEntries].sort(
      (a, b) => new Date(a.acceptedAt || 0).getTime() - new Date(b.acceptedAt || 0).getTime(),
    )

    sortedAcceptedQueueEntries.forEach((entry, index) => {
      const slotIndex = index % 2
      const dentistName = `${entry.acceptedByName || ''}`.trim()
      const patientName = `${entry.patient?.last_name || ''}, ${entry.patient?.first_name || ''}`.trim().replace(/^,\s*/, '')

      slots[slotIndex] = {
        slotId: slots[slotIndex].slotId,
        entryId: entry.id,
        dentistName: dentistName || 'Unassigned',
        patientName: patientName || 'No patient assigned',
      }
    })

    return slots
  }, [acceptedQueueEntries])

  useEffect(() => {
    const acceptedIds = new Set(acceptedQueueEntries.map((entry) => entry.id).filter(Boolean))
    setAcknowledgedAcceptedQueueIds((previous) => {
      const current = Array.isArray(previous) ? previous : []
      const nextValue = current.filter((id) => acceptedIds.has(id))
      return nextValue.length === current.length
        && nextValue.every((id, index) => id === current[index])
        ? previous
        : nextValue
    })
  }, [acceptedQueueEntries, setAcknowledgedAcceptedQueueIds])

  const acknowledgeAcceptedQueueCard = (entryId) => {
    if (!entryId) return
    setAcknowledgedAcceptedQueueIds((previous) => {
      const current = Array.isArray(previous) ? previous : []
      if (current.includes(entryId)) return current
      return [...current, entryId]
    })
  }

  const queueByPatientId = useMemo(
    () => Object.fromEntries(pendingQueueEntries.map((entry, index) => [entry.patientId, { ...entry, position: index + 1 }])),
    [pendingQueueEntries],
  )

  const toggleRecord = async (row) => {
    const nextIsActive = !row.is_active
    setError('')
    setIsStatusUpdating(true)
    setStatusConfirmRow(null)

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

  const addPatientToQueue = async (row) => {
    if (!row?.id) return
    if (!row.is_active) {
      setError('Inactive patients cannot be added to the queue.')
      return
    }

    setQueueActionKey(`add-${row.id}`)
    setError('')

    try {
      const { data: authData } = await supabase.auth.getUser()
      const actorId = authData?.user?.id ?? null

      const { error: insertError } = await supabase
        .from('patient_queue_entries')
        .insert({
          patient_id: row.id,
          queued_by: actorId,
        })

      if (insertError) throw insertError

      await loadRecords()
    } catch (queueError) {
      const queueErrorText = `${queueError?.message || ''} ${queueError?.details || ''}`
      if (
        queueError?.code === '23505'
        && (
          queueErrorText.includes('idx_patient_queue_entries_single_pending_patient_day')
          || queueErrorText.includes('idx_patient_queue_entries_single_pending_patient')
        )
      ) {
        setError('That patient is already in the queue.')
      } else {
        setError(queueError?.message || 'Unable to add patient to the queue.')
      }
    } finally {
      setQueueActionKey('')
    }
  }

  const acceptQueueEntry = async (entry) => {
    if (!entry?.id || !canAcceptQueue) return
    if (pendingQueueEntries[0]?.id !== entry.id) {
      setError('Only the first queued patient can be accepted.')
      return
    }

    setQueueActionKey(`accept-${entry.id}`)
    setError('')

    try {
      const { data: authData } = await supabase.auth.getUser()
      const actorId = authData?.user?.id ?? null

      const { error: updateError } = await supabase
        .from('patient_queue_entries')
        .update({
          queue_status: 'accepted',
          accepted_by: actorId,
          accepted_at: new Date().toISOString(),
        })
        .eq('id', entry.id)
        .eq('queue_status', 'pending')

      if (updateError) throw updateError

      await loadRecords()
      setShowQueueModal(false)
      navigate(`/records/${entry.patientId}`)
    } catch (queueError) {
      setError(queueError?.message || 'Unable to accept queued patient.')
    } finally {
      setQueueActionKey('')
    }
  }

  const cancelQueueEntry = async (entry) => {
    if (!entry?.id || !canManageQueue || entry.queueStatus !== 'pending') return

    setQueueActionKey(`cancel-${entry.id}`)
    setError('')

    try {
      const { error: updateError } = await supabase
        .from('patient_queue_entries')
        .update({
          queue_status: 'cancelled',
          accepted_by: null,
          accepted_at: null,
        })
        .eq('id', entry.id)
        .eq('queue_status', 'pending')

      if (updateError) throw updateError

      await loadRecords()
    } catch (queueError) {
      setError(queueError?.message || 'Unable to cancel queued patient.')
    } finally {
      setQueueActionKey('')
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
            {queueEnabled ? (
              <button type="button" className="ghost patient-queue-trigger" onClick={() => setShowQueueModal(true)}>
                Patient Queue
              </button>
            ) : null}
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
                <SortDirectionIcon direction={currentSortDirection} />
              </button>
            </div>
          </div>
        </div>

        <ErrorModal message={error} onClose={() => setError('')} />
        {loading ? <p>Loading patient records...</p> : null}

        <div className={`records-table patient-records-table${queueEnabled ? '' : ' no-queue-col'}`}>
          <div className="table-head">
            <span>Patient ID</span>
            <span>Full Name</span>
            <span>Sex</span>
            <span>Age</span>
            <span>Date Registered</span>
            <span>Status</span>
            {queueEnabled ? <span>Queue</span> : null}
            <span>Actions</span>
          </div>
          <div className="table-body">
            {pagedRecords.map((row) => {
              const queueEntry = queueByPatientId[row.id]
              const isAddingToQueue = queueActionKey === `add-${row.id}`

              return (
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
                  {queueEnabled ? (
                    <span>
                      {queueEntry ? (
                        <button type="button" className="queue-chip queued" onClick={() => setShowQueueModal(true)}>
                          {`Queued #${queueEntry.position}`}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="queue-chip"
                          disabled={!row.is_active || Boolean(queueActionKey)}
                          onClick={() => { void addPatientToQueue(row) }}
                        >
                          {isAddingToQueue ? 'Adding...' : 'Add to Queue'}
                        </button>
                      )}
                    </span>
                  ) : null}
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
              )
            })}
            {!loading && filteredRecords.length === 0 ? <p>No records found.</p> : null}
          </div>
        </div>

        <div className="records-footer">
          <span className="records-footer-summary">
            Showing {visibleStart}–{visibleEnd} of {filteredRecords.length} entries
            <span className="patient-status-badge active">{activeCount} Active</span>
            <span className="patient-status-badge inactive">{filteredRecords.length - activeCount} Inactive</span>
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

      {queueEnabled && showQueueModal ? <div className="modal-backdrop" onClick={() => { if (!queueActionKey) setShowQueueModal(false) }} /> : null}
      {queueEnabled && showQueueModal ? (
        <div className="pr-modal procedures-modal patient-queue-modal">
          <div className="pr-modal-head">
            <h2>Patient Queue</h2>
            <button type="button" onClick={() => { if (!queueActionKey) setShowQueueModal(false) }}>X</button>
          </div>
          <div className="pr-modal-body">
            <div className="patient-queue-summary">
              {canAcceptQueue ? (
                <>
                  <strong>{`${pendingQueueEntries.length} patient${pendingQueueEntries.length === 1 ? '' : 's'} waiting`}</strong>
                  <span>You can accept queued patients from here.</span>
                </>
              ) : (
                <div className="patient-queue-rooms" aria-label="Assigned queue rooms">
                  {receptionistRoomAssignments.map((room) => (
                    <button
                      key={room.slotId}
                      type="button"
                      className={`patient-queue-room-card ${room.entryId && !acknowledgedAcceptedQueueIds.includes(room.entryId) ? 'is-alerting' : ''}`}
                      onClick={() => acknowledgeAcceptedQueueCard(room.entryId)}
                      disabled={!room.entryId}
                    >
                      <span className="patient-queue-room-label">{room.dentistName}</span>
                      <strong>{room.patientName}</strong>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="patient-queue-toolbar">
              <label htmlFor="patient-queue-status-filter">
                Status:
                <select
                  id="patient-queue-status-filter"
                  value={queueStatusViewFilter}
                  onChange={(event) => setQueueStatusViewFilter(event.target.value)}
                >
                  <option value="pending">Pending</option>
                  <option value="all">All</option>
                  <option value="accepted">Accepted</option>
                </select>
              </label>
            </div>

            <div className={`records-table patient-queue-table ${canManageQueue ? (canAcceptQueue ? 'can-accept-queue' : 'has-queue-actions') : 'read-only-queue'}`}>
              <div className="table-head">
                <span>#</span>
                <span>Patient ID</span>
                <span>Full Name</span>
                <span>Queued At</span>
                <span>Queued By</span>
                <span>Status</span>
                {!canAcceptQueue ? <span>Accepted By</span> : null}
                {canManageQueue ? <span>Action</span> : null}
              </div>
              <div className="table-body">
                {filteredQueueEntries.map((entry, index) => {
                  const isAccepting = queueActionKey === `accept-${entry.id}`
                  const isCancelling = queueActionKey === `cancel-${entry.id}`
                  const pendingIndex = pendingQueueEntries.findIndex((pendingEntry) => pendingEntry.id === entry.id)
                  const isFirstInQueue = pendingIndex === 0
                  const isAccepted = entry.queueStatus === 'accepted'

                  return (
                    <div key={entry.id} className="table-row">
                      <span>{index + 1}</span>
                      <span>{formatPatientCode(entry.patient?.patient_code, entry.patient?.id)}</span>
                      <span>{`${entry.patient?.last_name || ''}, ${entry.patient?.first_name || ''}`.trim().replace(/^,\s*/, '') || 'Patient'}</span>
                      <span>{formatDateTime(entry.queuedAt)}</span>
                      <span>{entry.queuedByName || '-'}</span>
                      <span>{isAccepted ? 'Accepted' : 'Pending'}</span>
                      {!canAcceptQueue ? <span>{isAccepted ? entry.acceptedByName || '-' : '-'}</span> : null}
                      {canManageQueue ? (
                        <span className="queue-action-cell">
                          {isAccepted ? (
                            <span className="queue-readonly-label">Accepted</span>
                          ) : !canAcceptQueue ? (
                            <button
                              type="button"
                              className="danger-btn queue-cancel-btn queue-cancel-btn-standalone"
                              disabled={Boolean(queueActionKey)}
                              aria-label="Cancel queued patient"
                              title="Cancel queued patient"
                              onClick={() => { void cancelQueueEntry(entry) }}
                            >
                              {isCancelling ? '...' : 'X'}
                            </button>
                          ) : (
                            <span className="queue-action-group">
                              {canAcceptQueue && isFirstInQueue ? (
                                <button
                                  type="button"
                                  className="view queue-accept-btn"
                                  disabled={Boolean(queueActionKey)}
                                  onClick={() => { void acceptQueueEntry(entry) }}
                                >
                                  {isAccepting ? 'Accepting...' : 'Accept'}
                                </button>
                              ) : canAcceptQueue ? <span className="queue-action-placeholder" aria-hidden="true" /> : null}
                              <button
                                type="button"
                                className="danger-btn queue-cancel-btn"
                                disabled={Boolean(queueActionKey)}
                                aria-label="Cancel queued patient"
                                title="Cancel queued patient"
                                onClick={() => { void cancelQueueEntry(entry) }}
                              >
                                {isCancelling ? '...' : 'X'}
                              </button>
                            </span>
                          )}
                        </span>
                      ) : null}
                    </div>
                  )
                })}
                {!filteredQueueEntries.length ? <p>No patients match the selected queue filter.</p> : null}
              </div>
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
              Are you sure you want to {statusConfirmRow.is_active ? 'inactive' : 'active'} this patient?
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
