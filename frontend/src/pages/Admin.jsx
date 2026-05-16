import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ErrorModal from '../components/ErrorModal'
import FilterDateInput from '../components/FilterDateInput'
import SortDirectionIcon from '../components/SortDirectionIcon'
import { supabase } from '../lib/supabaseClient'
import useSessionStorageState, { UI_SESSION_STORAGE_PREFIX } from '../hooks/useSessionStorageState'
import { isValidLetterName, sanitizeLetterNameInput } from '../utils/nameValidation'
import { recordSystemAudit } from '../utils/auditLog'
import { findExistingPatientRecord, isPatientDuplicateError } from '../utils/patientDuplicateCheck'

const DEFAULT_PAGE_SIZE = 10
const ROWS_PER_PAGE_OPTIONS = [10, 20, 30, 40, 50, 60]
const ADMIN_UI_STORAGE_PREFIX = `${UI_SESSION_STORAGE_PREFIX}admin.`

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'associate_dentist', label: 'Associate Dentist' },
  { value: 'receptionist', label: 'Receptionist' },
]

const ROLE_LABELS = Object.fromEntries(ROLE_OPTIONS.map((item) => [item.value, item.label]))
const ROLE_SORT_ORDER = ROLE_OPTIONS.reduce((accumulator, item, index) => {
  accumulator[item.value] = index
  return accumulator
}, {})
const MONTH_ABBR = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May.', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.']
const MANILA_TIME_ZONE = 'Asia/Manila'
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const isImportedServiceMigrationLog = (details) => {
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

  return {
    year,
    month,
    day,
  }
}

const formatDateLabelFromParts = (parts) => `${MONTH_ABBR[parts.month - 1]} ${parts.day}, ${parts.year}`

const formatAuditDateTime = (value, details = '') => {
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
  if (isImportedServiceMigrationLog(details)) return dateLabel

  const timeLabel = date.toLocaleTimeString('en-US', {
    timeZone: MANILA_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
  })

  return `${dateLabel} ${timeLabel}`
}

const formatDate = (value, details = '') => {
  const formatted = formatAuditDateTime(value, details)
  return formatted.replace(/\s+\d{1,2}:\d{2}\s(?:AM|PM)$/i, '')
}

const formatDateOnly = (value) => {
  return formatDate(value)
}

const formatDateTime = (value, details = '') => {
  return formatAuditDateTime(value, details)
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

const formatPatientCode = (patientCode, patientId) => {
  const raw = `${patientCode || ''}`.trim()
  if (/^PT-\d{6}$/.test(raw)) return raw

  const digits = raw.replace(/\D/g, '')
  if (digits) return `PT-${digits.slice(-6).padStart(6, '0')}`

  const fallbackDigits = `${patientId || ''}`.replace(/\D/g, '').slice(-6)
  return `PT-${fallbackDigits.padStart(6, '0')}`
}

const formatStaffCode = (userId) => {
  const raw = `${userId || ''}`.trim()
  if (/^ST-\d{6}$/i.test(raw)) return raw.toUpperCase()

  const digits = raw.replace(/\D/g, '')
  if (digits) return `ST-${digits.slice(-6).padStart(6, '0')}`

  // Fallback for UUID-like values that may not produce enough numeric digits
  const alphanumerics = raw.replace(/[^a-zA-Z0-9]/g, '')
  const tail = alphanumerics.slice(-6).toUpperCase()
  return `ST-${tail.padStart(6, '0')}`
}

const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(`${value ?? ''}`.trim())

const patientCodeNumber = (row) => {
  const code = formatPatientCode(row.patient_code, row.id)
  const digits = Number(code.replace(/\D/g, ''))
  return Number.isFinite(digits) ? digits : 0
}

const staffCodeNumber = (row) => {
  const code = formatStaffCode(row.user_id)
  const digits = Number(code.replace(/\D/g, ''))
  return Number.isFinite(digits) ? digits : 0
}

const toTitleCase = (value) => {
  const raw = `${value ?? ''}`
  if (!raw.trim()) return raw
  return raw.toLowerCase().replace(/\b[a-z]/g, (match) => match.toUpperCase())
}

const formatLetterNameInput = (value) => toTitleCase(sanitizeLetterNameInput(value))

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i
const OPTIONAL_SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'v'])
const STAFF_ONLINE_WINDOW_MS = 60 * 1000
const STAFF_PRESENCE_REFRESH_MS = 20 * 1000

const splitStaffProfileName = (value) => {
  const normalized = `${value ?? ''}`.trim().replace(/\s+/g, ' ')
  if (!normalized) {
    return {
      firstName: '',
      middleName: '',
      lastName: '',
      suffix: '',
    }
  }

  const segments = normalized.split(' ')
  let suffix = ''
  const working = [...segments]
  const trailing = working.at(-1)?.toLowerCase()

  if (trailing && OPTIONAL_SUFFIXES.has(trailing)) {
    suffix = working.pop() || ''
  }

  if (working.length === 1) {
    return {
      firstName: working[0] || '',
      middleName: '',
      lastName: '',
      suffix,
    }
  }

  if (working.length === 2) {
    return {
      firstName: working[0] || '',
      middleName: '',
      lastName: working[1] || '',
      suffix,
    }
  }

  return {
    firstName: working[0] || '',
    middleName: working.slice(1, -1).join(' '),
    lastName: working.at(-1) || '',
    suffix,
  }
}

const buildStaffFullName = ({ first_name, middle_name, last_name, suffix }) => (
  [first_name, middle_name, last_name, suffix]
    .map((value) => toTitleCase(`${value ?? ''}`.trim()))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
)

const getUserFormNameParts = (profile) => {
  const firstName = `${profile?.first_name ?? ''}`.trim()
  const middleName = `${profile?.middle_name ?? ''}`.trim()
  const lastName = `${profile?.last_name ?? ''}`.trim()
  const suffix = `${profile?.suffix ?? ''}`.trim()

  if (firstName || middleName || lastName || suffix) {
    return {
      firstName,
      middleName,
      lastName,
      suffix,
    }
  }

  return splitStaffProfileName(profile?.full_name || '')
}

const buildSystemUserEmail = (username) => {
  const normalizedUsername = `${username ?? ''}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '')

  return normalizedUsername ? `${normalizedUsername}@smilesdentalhub.local` : ''
}

const toPhilippineLocalMobileInput = (value = '') => {
  const digits = `${value || ''}`.replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('63') && digits.length >= 12) return digits.slice(2, 12)
  if (digits.startsWith('0') && digits.length >= 11) return digits.slice(1, 11)
  if (digits.startsWith('9') && digits.length >= 10) return digits.slice(0, 10)
  return digits.slice(0, 10)
}

const formatPhilippineMobileDisplay = (value = '') => {
  const localDigits = toPhilippineLocalMobileInput(value)
  return localDigits ? `+63${localDigits}` : '-'
}

const getDisplayValue = (value, fallback = 'N/A') => `${value ?? ''}`.trim() || fallback

const formatHistoryAnswer = (answer, note) => {
  const normalizedAnswer = `${answer || ''}`.trim() || '-'
  const normalizedNote = `${note || ''}`.trim()
  return normalizedAnswer === 'YES' && normalizedNote ? `${normalizedAnswer} - ${normalizedNote}` : normalizedAnswer
}

const summarizeHealthConditions = (healthConditions) => {
  if (!healthConditions || typeof healthConditions !== 'object' || Array.isArray(healthConditions)) return 'None selected'

  const entries = Object.entries(healthConditions)
    .filter(([key, value]) => key !== 'othersText' && Boolean(value))
    .map(([key]) => key)

  const othersText = `${healthConditions.othersText || ''}`.trim()
  if (othersText) entries.push(`Others: ${othersText}`)

  return entries.length > 0 ? entries.join(', ') : 'None selected'
}

const summarizeAllergens = (allergenInfo) => {
  if (!allergenInfo || typeof allergenInfo !== 'object' || Array.isArray(allergenInfo)) return 'None selected'

  const labels = Object.entries(allergenInfo.values || {})
    .filter(([, value]) => Boolean(value))
    .map(([label]) => label)

  const others = `${allergenInfo.others || ''}`.trim()
  if (others) labels.push(`Others: ${others}`)

  return labels.length > 0 ? labels.join(', ') : 'None selected'
}

const formatPreviewBoolean = (value) => (value ? 'Accepted' : 'Not accepted')

const summarizeDentalHistory = (dh) => {
  if (!dh || typeof dh !== 'object') return 'N/A'
  const parts = []
  if (dh.previous) parts.push(`Dentist: ${dh.previous}`)
  if (dh.lastExam) parts.push(`Last Exam: ${formatDateOnly(dh.lastExam)}`)
  if (dh.reason) parts.push(`Reason: ${dh.reason}`)
  const answers = dh.answers || {}
  const yesCount = Object.values(answers).filter((v) => v === 'YES').length
  if (yesCount > 0) parts.push(`${yesCount} YES answer(s)`)
  return parts.join(' | ') || 'None'
}

const summarizeMedicalHistory = (mh) => {
  if (!mh || typeof mh !== 'object') return 'N/A'
  const parts = []
  if (mh.physician) parts.push(`Physician: ${mh.physician}`)
  if (mh.specialty) parts.push(`Specialty: ${mh.specialty}`)
  if (mh.address) parts.push(`Address: ${mh.address}`)
  const answers = mh.answers || {}
  const yesCount = Object.values(answers).filter((v) => v === 'YES').length
  if (yesCount > 0) parts.push(`${yesCount} YES answer(s)`)
  return parts.join(' | ') || 'None'
}

const normalizePreviewCompareValue = (field, value) => {
  if (field === 'phone' || field === 'guardian_mobile_number') {
    return formatPhilippineMobileDisplay(value)
  }
  if (field === 'birth_date') {
    return formatDateOnly(value)
  }
  if (field === 'authorization_accepted') {
    return formatPreviewBoolean(Boolean(value))
  }
  if (field === 'health_conditions') {
    return summarizeHealthConditions(value)
  }
  if (field === 'allergen_info') {
    return summarizeAllergens(value)
  }
  if (field === 'dental_history') {
    return summarizeDentalHistory(value)
  }
  if (field === 'medical_history') {
    return summarizeMedicalHistory(value)
  }

  return getDisplayValue(value, 'N/A')
}

const PATIENT_UPDATE_COMPARE_FIELDS = [
  ['first_name', 'First Name'],
  ['last_name', 'Last Name'],
  ['middle_name', 'Middle Name'],
  ['suffix', 'Suffix'],
  ['birth_date', 'Birthdate'],
  ['sex', 'Sex'],
  ['nickname', 'Nickname'],
  ['email', 'Email'],
  ['civil_status', 'Civil Status'],
  ['phone', 'Mobile Number'],
  ['occupation', 'Occupation'],
  ['address', 'Current Address'],
  ['office_address', 'Office Address'],
  ['guardian_name', 'Guardian Name'],
  ['guardian_mobile_number', 'Guardian Mobile'],
  ['guardian_occupation', 'Guardian Occupation'],
  ['guardian_office_address', 'Guardian Office Address'],
  ['authorization_accepted', 'Authorization'],
  ['health_conditions', 'Health Status'],
  ['allergen_info', 'Allergen Information'],
  ['dental_history', 'Dental History'],
  ['medical_history', 'Medical History'],
]

const formatStaffDisplayName = (profile) => {
  const firstName = `${profile?.first_name ?? ''}`.trim()
  const middleName = `${profile?.middle_name ?? ''}`.trim()
  const lastName = `${profile?.last_name ?? ''}`.trim()
  const suffix = `${profile?.suffix ?? ''}`.trim()

  if (firstName || middleName || lastName || suffix) {
    const middleInitial = middleName ? `${middleName[0]?.toUpperCase() || ''}.` : ''
    return [
      lastName ? `${lastName},` : '',
      firstName,
      middleInitial,
      suffix,
    ].filter(Boolean).join(' ') || '-'
  }

  const normalized = `${profile?.full_name || ''}`.trim().replace(/\s+/g, ' ')
  if (!normalized) return '-'

  const { firstName: fallbackFirstName, middleName: fallbackMiddleName, lastName: fallbackLastName, suffix: fallbackSuffix } = splitStaffProfileName(normalized)
  const middleInitial = fallbackMiddleName ? `${fallbackMiddleName[0]?.toUpperCase() || ''}.` : ''

  return [
    fallbackLastName ? `${fallbackLastName},` : '',
    fallbackFirstName,
    middleInitial,
    fallbackSuffix,
  ].filter(Boolean).join(' ') || normalized
}

const formatPatientDisplayName = (patient) => {
  const lastName = `${patient?.last_name ?? ''}`.trim()
  const firstName = `${patient?.first_name ?? ''}`.trim()
  if (lastName || firstName) return [lastName ? `${lastName},` : '', firstName].filter(Boolean).join(' ')
  return '-'
}

const formatAuditActionLabel = (action) => (
  `${action ?? ''}`
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase())
    .trim() || '-'
)

const isStaffOnlineNow = (row) => {
  if (!row?.active_session_id || !row?.last_seen_at) return false
  const lastSeenTime = new Date(row.last_seen_at).getTime()
  if (Number.isNaN(lastSeenTime)) return false
  return (Date.now() - lastSeenTime) <= STAFF_ONLINE_WINDOW_MS
}

const formatAuditSourceLabel = (source) => {
  const normalized = `${source ?? ''}`.trim().toLowerCase()
  if (!normalized) return 'System'
  if (normalized === 'api') return 'System'
  if (normalized === 'ui') return 'Web App'
  if (normalized === 'patient log') return 'Patient Log'
  if (normalized === 'archive event') return 'Archive History'
  return formatAuditActionLabel(source)
}

const formatAuditActorLabel = (actorName) => {
  const normalized = `${actorName ?? ''}`.trim()
  return normalized && normalized !== '-' ? normalized : 'System'
}

const AUDIT_CATEGORY_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'access', label: 'Access' },
  { value: 'patients', label: 'Patients' },
  { value: 'users', label: 'Users' },
  { value: 'archive', label: 'Archive' },
  { value: 'documents', label: 'Documents' },
  { value: 'system', label: 'System' },
]

const stringIncludesAny = (value, terms) => terms.some((term) => value.includes(term))

const getAuditCategoryKey = (row) => {
  const haystack = [
    row.action,
    row.source,
    row.subject,
    row.details,
  ].join(' ').toLowerCase()

  if (stringIncludesAny(haystack, ['login', 'logout', 'password', 'email change', 'verification', 'verify', 'reset', 'access'])) {
    return 'access'
  }

  if (stringIncludesAny(haystack, ['document', 'upload', 'import', 'file', 'csv'])) {
    return 'documents'
  }

  if (stringIncludesAny(haystack, ['archive', 'retrieve', 'inactive', 'active'])) {
    return 'archive'
  }

  if (stringIncludesAny(haystack, ['staff', 'user', 'profile', 'admin', 'onboarding'])) {
    return 'users'
  }

  if (stringIncludesAny(haystack, ['patient', 'service', 'dental', 'registration', 'record', 'tooth'])) {
    return 'patients'
  }

  return 'system'
}

const getAuditAccentClass = (categoryKey) => {
  switch (categoryKey) {
    case 'access':
      return 'access'
    case 'patients':
      return 'patients'
    case 'users':
      return 'users'
    case 'archive':
      return 'archive'
    case 'documents':
      return 'documents'
    default:
      return 'system'
  }
}

const getAuditCategoryInitial = (categoryKey) => {
  switch (categoryKey) {
    case 'access':
      return 'A'
    case 'patients':
      return 'P'
    case 'users':
      return 'U'
    case 'archive':
      return 'R'
    case 'documents':
      return 'D'
    default:
      return 'S'
  }
}

const isSystemAuditEvent = (row) => {
  const haystack = `${row.source || ''} ${row.actorName || ''}`.toLowerCase()
  return haystack.includes('api') || haystack.includes('system') || row.actorName === '-'
}

const isSensitiveAuditEvent = (row) => {
  const haystack = [
    row.action,
    row.source,
    row.subject,
    row.details,
  ].join(' ').toLowerCase()

  return stringIncludesAny(haystack, ['failed', 'password', 'email change', 'archive', 'inactive', 'reset', 'verify'])
}

const isAuditRowWithinDays = (row, days) => {
  const timestamp = new Date(row.timestamp).getTime()
  if (Number.isNaN(timestamp)) return false
  const now = Date.now()
  return timestamp >= (now - (days * 24 * 60 * 60 * 1000))
}

function Admin() {
  const navigate = useNavigate()
  const patientImportFileInputRef = useRef(null)
  const recordsImportFileInputRef = useRef(null)
  const [tab, setTab] = useState('users')
  const [showAddUser, setShowAddUser] = useSessionStorageState(`${ADMIN_UI_STORAGE_PREFIX}showAddUser`, false)
  const [users, setUsers] = useState([])
  const [inactivePatients, setInactivePatients] = useState([])
  const [pendingPatientRequests, setPendingPatientRequests] = useState([])
  const [archivePatients, setArchivePatients] = useState([])
  const [archiveUsers, setArchiveUsers] = useState([])
  const [archiveServices, setArchiveServices] = useState([])
  const [archiveDentalConditions, setArchiveDentalConditions] = useState([])
  const [auditLogs, setAuditLogs] = useState([])
  const [archiveType, setArchiveType] = useState('patients')
  const [usersPage, setUsersPage] = useState(1)
  const [inactivePage, setInactivePage] = useState(1)
  const [pendingPage, setPendingPage] = useState(1)
  const [archivePage, setArchivePage] = useState(1)
  const [auditPage, setAuditPage] = useState(1)
  const [usersRowsPerPage, setUsersRowsPerPage] = useState(DEFAULT_PAGE_SIZE)
  const [inactiveRowsPerPage, setInactiveRowsPerPage] = useState(DEFAULT_PAGE_SIZE)
  const [pendingRowsPerPage, setPendingRowsPerPage] = useState(DEFAULT_PAGE_SIZE)
  const [archiveRowsPerPage, setArchiveRowsPerPage] = useState(DEFAULT_PAGE_SIZE)
  const [auditRowsPerPage, setAuditRowsPerPage] = useState(DEFAULT_PAGE_SIZE)
  const [usersPageInput, setUsersPageInput] = useState('1')
  const [inactivePageInput, setInactivePageInput] = useState('1')
  const [pendingPageInput, setPendingPageInput] = useState('1')
  const [archivePageInput, setArchivePageInput] = useState('1')
  const [auditPageInput, setAuditPageInput] = useState('1')
  const [usersSearchTerm, setUsersSearchTerm] = useState('')
  const [usersSortBy, setUsersSortBy] = useState('created')
  const [usersNameSortDirection, setUsersNameSortDirection] = useState('asc')
  const [usersStaffIdSortDirection, setUsersStaffIdSortDirection] = useState('desc')
  const [usersCreatedSortDirection, setUsersCreatedSortDirection] = useState('desc')
  const [usersRoleSortDirection, setUsersRoleSortDirection] = useState('asc')
  const [inactiveSearchTerm, setInactiveSearchTerm] = useState('')
  const [pendingSearchTerm, setPendingSearchTerm] = useState('')
  const [inactiveSortBy, setInactiveSortBy] = useState('patientId')
  const [inactiveNameSortDirection, setInactiveNameSortDirection] = useState('asc')
  const [inactivePatientIdSortDirection, setInactivePatientIdSortDirection] = useState('desc')
  const [inactiveDateSortDirection, setInactiveDateSortDirection] = useState('desc')
  const [archiveSearchTerm, setArchiveSearchTerm] = useState('')
  const [archiveSortBy, setArchiveSortBy] = useState('patientId')
  const [archiveNameSortDirection, setArchiveNameSortDirection] = useState('asc')
  const [archiveIdSortDirection, setArchiveIdSortDirection] = useState('desc')
  const [archiveDateSortDirection, setArchiveDateSortDirection] = useState('desc')
  const [auditSearchTerm, setAuditSearchTerm] = useState('')
  const [auditSortDirection, setAuditSortDirection] = useState('desc')
  const [auditCategoryFilter, setAuditCategoryFilter] = useState('all')
  const [modal, setModal] = useSessionStorageState(`${ADMIN_UI_STORAGE_PREFIX}modal`, null)
  const [selected, setSelected] = useSessionStorageState(`${ADMIN_UI_STORAGE_PREFIX}selected`, null)
  const [successMessage, setSuccessMessage] = useSessionStorageState(`${ADMIN_UI_STORAGE_PREFIX}successMessage`, '')
  const [patientUpdatePreviewBase, setPatientUpdatePreviewBase] = useState(null)
  const [patientUpdatePreviewLoading, setPatientUpdatePreviewLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [isEditingUser, setIsEditingUser] = useState(false)
  const [invalidAddUserFields, setInvalidAddUserFields] = useState({})
  const [addUserValidationMessage, setAddUserValidationMessage] = useState('')
  const [showAddUserPassword, setShowAddUserPassword] = useState(false)
  const [patientImportFileName, setPatientImportFileName] = useState('')
  const [patientImportCsvContent, setPatientImportCsvContent] = useState('')
  const [patientImportSummary, setPatientImportSummary] = useState(null)
  const [recordsImportFileName, setRecordsImportFileName] = useState('')
  const [recordsImportCsvContent, setRecordsImportCsvContent] = useState('')
  const [recordsImportSummary, setRecordsImportSummary] = useState(null)
  const [importError, setImportError] = useState('')
  const [isImportingPatients, setIsImportingPatients] = useState(false)
  const [isImportingRecords, setIsImportingRecords] = useState(false)
  const [pendingProcessingId, setPendingProcessingId] = useState('')
  const [pendingConfirmAction, setPendingConfirmAction] = useState(null)
  const [showUsersFilters, setShowUsersFilters] = useSessionStorageState(`${ADMIN_UI_STORAGE_PREFIX}showUsersFilters`, false)
  const [showInactiveFilters, setShowInactiveFilters] = useSessionStorageState(`${ADMIN_UI_STORAGE_PREFIX}showInactiveFilters`, false)
  const [showArchiveFilters, setShowArchiveFilters] = useSessionStorageState(`${ADMIN_UI_STORAGE_PREFIX}showArchiveFilters`, false)
  const [usersRoleFilter, setUsersRoleFilter] = useState('')
  const [usersCreatedFromFilter, setUsersCreatedFromFilter] = useState('')
  const [usersCreatedToFilter, setUsersCreatedToFilter] = useState('')
  const [inactiveSexFilter, setInactiveSexFilter] = useState('')
  const [inactiveMinAgeFilter, setInactiveMinAgeFilter] = useState('')
  const [inactiveMaxAgeFilter, setInactiveMaxAgeFilter] = useState('')
  const [inactiveDateFromFilter, setInactiveDateFromFilter] = useState('')
  const [inactiveDateToFilter, setInactiveDateToFilter] = useState('')
  const [archiveSexFilter, setArchiveSexFilter] = useState('')
  const [archiveRoleFilter, setArchiveRoleFilter] = useState('')
  const [archiveMinAgeFilter, setArchiveMinAgeFilter] = useState('')
  const [archiveMaxAgeFilter, setArchiveMaxAgeFilter] = useState('')
  const [archiveDateFromFilter, setArchiveDateFromFilter] = useState('')
  const [archiveDateToFilter, setArchiveDateToFilter] = useState('')
  const [userForm, setUserForm] = useSessionStorageState(`${ADMIN_UI_STORAGE_PREFIX}userForm`, {
    user_id: '',
    first_name: '',
    middle_name: '',
    last_name: '',
    suffix: '',
    email: '',
    username: '',
    birth_date: '',
    mobile_number: '',
    address: '',
    password: '',
    role: 'receptionist',
    is_active: true,
  })

  const closeModal = () => {
    setModal(null)
    setSelected(null)
    setPatientUpdatePreviewBase(null)
    setPatientUpdatePreviewLoading(false)
    setIsEditingUser(false)
    setImportError('')
    setPatientImportSummary(null)
    setRecordsImportSummary(null)
    setIsImportingPatients(false)
    setIsImportingRecords(false)
    if (patientImportFileInputRef.current) {
      patientImportFileInputRef.current.value = ''
    }
    if (recordsImportFileInputRef.current) {
      recordsImportFileInputRef.current.value = ''
    }
  }

  const showSuccess = (message) => {
    setSuccessMessage(message)
    setModal('success')
  }

  const handleImportFileChange = async (event, type) => {
    const file = event.target.files?.[0]
    if (!file) {
      if (type === 'patients') {
        setPatientImportCsvContent('')
        setPatientImportFileName('')
      } else {
        setRecordsImportCsvContent('')
        setRecordsImportFileName('')
      }
      return
    }

    try {
      const text = await file.text()
      if (type === 'patients') {
        setPatientImportCsvContent(text)
        setPatientImportFileName(file.name)
        setPatientImportSummary(null)
      } else {
        setRecordsImportCsvContent(text)
        setRecordsImportFileName(file.name)
        setRecordsImportSummary(null)
      }
      setImportError('')
    } catch {
      setImportError('Unable to read the selected CSV file.')
      if (type === 'patients') {
        setPatientImportCsvContent('')
        setPatientImportFileName('')
      } else {
        setRecordsImportCsvContent('')
        setRecordsImportFileName('')
      }
    }
  }

  const importPatientMigration = async () => {
    if (!patientImportCsvContent.trim()) {
      setImportError('Please choose the patient information CSV first.')
      return
    }

    setIsImportingPatients(true)
    setImportError('')
    setPatientImportSummary(null)

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      const accessToken = sessionData?.session?.access_token || ''
      if (sessionError || !accessToken) {
        setImportError('Unable to verify your session. Please log in again.')
        return
      }

      const response = await fetch('/api/admin/import-patient-migration', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          fileName: patientImportFileName,
          csvContent: patientImportCsvContent,
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setImportError(payload?.error || 'Unable to import the migration CSV.')
        return
      }

      setPatientImportSummary(payload?.summary || null)
      await recordSystemAudit({
        action: 'patient_import_completed',
        entityType: 'patient_import',
        entityLabel: patientImportFileName,
        details: 'Imported patient migration CSV.',
      })
      await loadAll()
    } catch {
      setImportError('Unable to import the migration CSV.')
    } finally {
      setIsImportingPatients(false)
    }
  }

  const importPatientRecords = async () => {
    if (!recordsImportCsvContent.trim()) {
      setImportError('Please choose the dental and service records CSV first.')
      return
    }

    setIsImportingRecords(true)
    setImportError('')
    setRecordsImportSummary(null)

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      const accessToken = sessionData?.session?.access_token || ''
      if (sessionError || !accessToken) {
        setImportError('Unable to verify your session. Please log in again.')
        return
      }

      const response = await fetch('/api/admin/import-patient-records', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          fileName: recordsImportFileName,
          csvContent: recordsImportCsvContent,
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setImportError(payload?.error || 'Unable to import the dental and service records CSV.')
        return
      }

      setRecordsImportSummary(payload?.summary || null)
      await recordSystemAudit({
        action: 'patient_records_import_completed',
        entityType: 'patient_records_import',
        entityLabel: recordsImportFileName,
        details: 'Imported dental and service records CSV.',
      })
      await loadAll()
    } catch {
      setImportError('Unable to import the dental and service records CSV.')
    } finally {
      setIsImportingRecords(false)
    }
  }

  const loadUsers = async () => {
    const { data, error: fetchError } = await supabase
      .from('staff_profiles')
      .select('user_id, full_name, first_name, middle_name, last_name, suffix, birth_date, mobile_number, address, email, username, role, is_active, active_session_id, last_seen_at, created_at, updated_at')
      .eq('is_active', true)
      .order('created_at', { ascending: true })

    if (fetchError) throw fetchError
    setUsers(data ?? [])
  }

  const loadInactivePatients = async () => {
    const { data, error: fetchError } = await supabase
      .from('patients')
      .select('id, patient_code, first_name, last_name, sex, birth_date, archived_at, created_at')
      .eq('is_active', false)
      .is('archived_at', null)
      .order('updated_at', { ascending: false })

    if (fetchError) throw fetchError
    setInactivePatients(data ?? [])
  }

  const loadArchives = async () => {
    const [patientsRes, usersRes, servicesRes, dentalRes] = await Promise.all([
      supabase
        .from('patients')
        .select('id, patient_code, first_name, last_name, sex, birth_date, archived_at')
        .not('archived_at', 'is', null)
        .order('archived_at', { ascending: false }),
      supabase
        .from('staff_profiles')
        .select('user_id, full_name, first_name, middle_name, last_name, suffix, birth_date, mobile_number, address, email, username, role, is_active, updated_at')
        .eq('is_active', false)
        .order('updated_at', { ascending: false }),
      supabase
        .from('services')
        .select('id, service_name, is_active, updated_at')
        .eq('is_active', false)
        .order('updated_at', { ascending: false }),
      supabase
        .from('tooth_conditions')
        .select('id, code, condition_name, is_active, updated_at')
        .eq('is_active', false)
        .order('updated_at', { ascending: false }),
    ])

    if (patientsRes.error) throw patientsRes.error
    if (usersRes.error) throw usersRes.error
    if (servicesRes.error) throw servicesRes.error
    if (dentalRes.error) throw dentalRes.error

    setArchivePatients(patientsRes.data ?? [])
    setArchiveUsers(usersRes.data ?? [])
    setArchiveServices(servicesRes.data ?? [])
    setArchiveDentalConditions(dentalRes.data ?? [])
  }

  const fetchStaffNames = async (userIds) => {
    const ids = [...new Set((userIds ?? []).filter((value) => isUuid(value)))]
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

    return Object.fromEntries((data ?? []).map((row) => [row.user_id, row.full_name]))
  }

  const loadPendingPatientRequests = async () => {
    const { data, error: fetchError } = await supabase
      .from('pending_patient_registrations')
      .select('id, first_name, last_name, middle_name, suffix, sex, birth_date, email, payload, request_source, requested_by, created_at, status')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })

    if (fetchError) throw fetchError

    const staffNames = await fetchStaffNames((data ?? []).map((row) => row.requested_by).filter(Boolean))
    setPendingPatientRequests((data ?? []).map((row) => ({
      ...row,
      requested_by_name: staffNames[row.requested_by] || '-',
    })))
  }

  const loadAuditLogs = async () => {
    const [
      systemAuditResult,
      patientLogsResult,
      archiveEventsResult,
      pendingPatientRequestsResult,
    ] = await Promise.all([
      supabase
        .from('system_audit_logs')
        .select('id, action, source, entity_type, entity_id, entity_label, details, metadata, actor_user_id, actor_identifier, created_at')
        .order('created_at', { ascending: false }),
      supabase
        .from('patient_logs')
        .select('id, patient_id, action, details, created_by, created_at')
        .order('created_at', { ascending: false }),
      supabase
        .from('archive_events')
        .select('id, table_name, record_id, action, reason, performed_by, created_at')
        .order('created_at', { ascending: false }),
      supabase
        .from('pending_patient_registrations')
        .select('id, first_name, last_name, status, request_source, requested_by, decided_by, created_at, decided_at')
        .order('created_at', { ascending: false }),
    ])

    if (patientLogsResult.error) throw patientLogsResult.error
    if (archiveEventsResult.error) throw archiveEventsResult.error
    if (pendingPatientRequestsResult.error) throw pendingPatientRequestsResult.error

    const systemRows = systemAuditResult.error ? [] : (systemAuditResult.data ?? [])
    const patientLogRows = patientLogsResult.data ?? []
    const archiveEventRows = archiveEventsResult.data ?? []
    const pendingRequestRows = pendingPatientRequestsResult.data ?? []

    const patientIds = [...new Set([
      ...patientLogRows.map((row) => row.patient_id).filter(Boolean),
      ...archiveEventRows.filter((row) => row.table_name === 'patients').map((row) => row.record_id),
    ])]
    const serviceRecordIds = [...new Set(
      archiveEventRows.filter((row) => row.table_name === 'service_records').map((row) => row.record_id),
    )]
    const dentalRecordIds = [...new Set(
      archiveEventRows.filter((row) => row.table_name === 'dental_records').map((row) => row.record_id),
    )]

    const [
      patientResult,
      serviceRecordResult,
      dentalRecordResult,
      staffNames,
    ] = await Promise.all([
      patientIds.length > 0
        ? supabase
          .from('patients')
          .select('id, patient_code, first_name, last_name')
          .in('id', patientIds)
        : Promise.resolve({ data: [], error: null }),
      serviceRecordIds.length > 0
        ? supabase
          .from('service_records')
          .select('id, patient_id')
          .in('id', serviceRecordIds)
        : Promise.resolve({ data: [], error: null }),
      dentalRecordIds.length > 0
        ? supabase
          .from('dental_records')
          .select('id, patient_id')
          .in('id', dentalRecordIds)
        : Promise.resolve({ data: [], error: null }),
      fetchStaffNames([
        ...systemRows.map((row) => row.actor_user_id).filter(Boolean),
        ...patientLogRows.map((row) => row.created_by).filter(Boolean),
        ...archiveEventRows.map((row) => row.performed_by).filter(Boolean),
        ...pendingRequestRows.map((row) => row.requested_by).filter(Boolean),
        ...pendingRequestRows.map((row) => row.decided_by).filter(Boolean),
      ]),
    ])

    if (patientResult.error) throw patientResult.error
    if (serviceRecordResult.error) throw serviceRecordResult.error
    if (dentalRecordResult.error) throw dentalRecordResult.error

    const patientMap = Object.fromEntries((patientResult.data ?? []).map((row) => [row.id, row]))
    const serviceRecordMap = Object.fromEntries((serviceRecordResult.data ?? []).map((row) => [row.id, row]))
    const dentalRecordMap = Object.fromEntries((dentalRecordResult.data ?? []).map((row) => [row.id, row]))

    const linkedPatientIds = [...new Set([
      ...(serviceRecordResult.data ?? []).map((row) => row.patient_id).filter(Boolean),
      ...(dentalRecordResult.data ?? []).map((row) => row.patient_id).filter(Boolean),
    ])]

    let linkedPatientMap = {}
    if (linkedPatientIds.length > 0) {
      const linkedPatientsResult = await supabase
        .from('patients')
        .select('id, patient_code, first_name, last_name')
        .in('id', linkedPatientIds)

      if (linkedPatientsResult.error) throw linkedPatientsResult.error
      linkedPatientMap = Object.fromEntries((linkedPatientsResult.data ?? []).map((row) => [row.id, row]))
    }

    const normalizedSystemRows = systemRows.map((row) => ({
      id: `system-audit-${row.id}`,
      timestamp: row.created_at,
      source: row.source ? formatAuditActionLabel(row.source) : 'System Audit',
      action: formatAuditActionLabel(row.action),
      subject: row.entity_label || formatAuditActionLabel(row.entity_type),
      actorName: staffNames[row.actor_user_id] || row.actor_identifier || '-',
      details: row.details || '-',
    }))

    const normalizedPatientLogs = patientLogRows
      .filter((row) => !isImportedServiceMigrationLog(row.details))
      .map((row) => {
        const patient = patientMap[row.patient_id]
        const subject = patient
          ? `${formatPatientDisplayName(patient)} (${formatPatientCode(patient.patient_code, patient.id)})`
          : 'Patient record'

        return {
          id: `patient-log-${row.id}`,
          timestamp: row.created_at,
          source: 'Patient Log',
          action: formatAuditActionLabel(row.action),
          subject,
          actorName: staffNames[row.created_by] || '-',
          details: row.details || '-',
        }
      })

    const normalizedArchiveEvents = archiveEventRows.map((row) => {
      let subject = formatAuditActionLabel(row.table_name)
      if (row.table_name === 'patients') {
        const patient = patientMap[row.record_id]
        subject = patient
          ? `${formatPatientDisplayName(patient)} (${formatPatientCode(patient.patient_code, patient.id)})`
          : 'Patient record'
      } else if (row.table_name === 'service_records') {
        const patient = linkedPatientMap[serviceRecordMap[row.record_id]?.patient_id]
        subject = patient
          ? `Service record for ${formatPatientDisplayName(patient)} (${formatPatientCode(patient.patient_code, patient.id)})`
          : 'Service record'
      } else if (row.table_name === 'dental_records') {
        const patient = linkedPatientMap[dentalRecordMap[row.record_id]?.patient_id]
        subject = patient
          ? `Dental record for ${formatPatientDisplayName(patient)} (${formatPatientCode(patient.patient_code, patient.id)})`
          : 'Dental record'
      }

      return {
        id: `archive-event-${row.id}`,
        timestamp: row.created_at,
        source: 'Archive Event',
        action: `${formatAuditActionLabel(row.action)} ${formatAuditActionLabel(row.table_name)}`.trim(),
        subject,
        actorName: staffNames[row.performed_by] || '-',
        details: row.reason || '-',
      }
    })

    const normalizedPendingRequestEvents = pendingRequestRows.flatMap((row) => {
      const subject = `${row.last_name || ''}, ${row.first_name || ''}`.trim().replace(/^,\s*/, '') || 'Patient request'
      const rows = [
        {
          id: `pending-patient-request-created-${row.id}`,
          timestamp: row.created_at,
          source: 'Patient Request',
          action: 'Patient Registration Pending Approval',
          subject,
          actorName: staffNames[row.requested_by] || '-',
          details: 'Submitted patient registration for admin approval because no patient email was provided.',
        },
      ]

      if (row.status === 'approved' && row.decided_at) {
        rows.push({
          id: `pending-patient-request-approved-${row.id}`,
          timestamp: row.decided_at,
          source: 'Patient Request',
          action: 'Pending Patient Request Approved',
          subject,
          actorName: staffNames[row.decided_by] || '-',
          details: 'Approved pending patient request and created patient record.',
        })
      }

      if (row.status === 'declined' && row.decided_at) {
        rows.push({
          id: `pending-patient-request-declined-${row.id}`,
          timestamp: row.decided_at,
          source: 'Patient Request',
          action: 'Pending Patient Request Declined',
          subject,
          actorName: staffNames[row.decided_by] || '-',
          details: 'Declined pending patient request.',
        })
      }

      return rows
    })

    const seenLegacyKeys = new Set(
      normalizedSystemRows
        .map((row) => `${row.timestamp}|${row.action}|${row.subject}|${row.details}`),
    )

    const mergedLegacyRows = [...normalizedPatientLogs, ...normalizedArchiveEvents, ...normalizedPendingRequestEvents].filter((row) => {
      const key = `${row.timestamp}|${row.action}|${row.subject}|${row.details}`
      if (seenLegacyKeys.has(key)) return false
      seenLegacyKeys.add(key)
      return true
    })

    setAuditLogs(
      [...normalizedSystemRows, ...mergedLegacyRows]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    )
  }

  const loadAll = useMemo(() => async () => {
    setLoading(true)
    setError('')
    try {
      await Promise.all([loadUsers(), loadInactivePatients(), loadPendingPatientRequests(), loadArchives(), loadAuditLogs()])
    } catch (fetchError) {
      setError(fetchError.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  useEffect(() => {
    const refreshUsersPresence = () => {
      void loadUsers().catch((fetchError) => {
        setError(fetchError.message || 'Unable to refresh users.')
      })
    }

    refreshUsersPresence()
    const timer = window.setInterval(refreshUsersPresence, STAFF_PRESENCE_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (archiveType === 'patients' && archiveSortBy === 'staffId') {
      setArchiveSortBy('patientId')
    }
    if (archiveType === 'users' && archiveSortBy === 'patientId') {
      setArchiveSortBy('staffId')
    }
    if ((archiveType === 'services' || archiveType === 'dentalCondition') && (archiveSortBy === 'patientId' || archiveSortBy === 'staffId')) {
      setArchiveSortBy('name')
    }
  }, [archiveSortBy, archiveType])

  const openConfirmArchive = (payload) => {
    setSelected(payload)
    setModal('confirm-archive')
  }

  const openConfirmRetrieve = (payload) => {
    setSelected(payload)
    setModal('confirm-retrieve')
  }

  const openPendingRequestPreview = async (request) => {
    setError('')
    setPatientUpdatePreviewBase(null)
    setPatientUpdatePreviewLoading(false)
    setSelected(request)
    setModal('preview-patient-request')

    if (request?.request_source !== 'patient_details_update') {
      return
    }

    const payload = request.payload && typeof request.payload === 'object' && !Array.isArray(request.payload)
      ? request.payload
      : {}
    const patientId = `${payload.patient_id || ''}`.trim()

    if (!patientId) {
      setError('Unable to load the current patient record for this update request.')
      return
    }

    setPatientUpdatePreviewLoading(true)

    try {
      const { data, error: fetchError } = await supabase
        .from('patients')
        .select(`
          id,
          first_name,
          last_name,
          middle_name,
          suffix,
          birth_date,
          sex,
          nickname,
          email,
          civil_status,
          phone,
          occupation,
          address,
          office_address,
          guardian_name,
          guardian_mobile_number,
          guardian_occupation,
          guardian_office_address,
          authorization_accepted,
          health_conditions,
          allergen_info,
          dental_history,
          medical_history
        `)
        .eq('id', patientId)
        .maybeSingle()

      if (fetchError) throw fetchError
      setPatientUpdatePreviewBase(data || null)
    } catch (previewError) {
      setError(previewError?.message || 'Unable to load the current patient record for comparison.')
    } finally {
      setPatientUpdatePreviewLoading(false)
    }
  }

  const openEditUser = (user) => {
    const { firstName, middleName, lastName, suffix } = getUserFormNameParts(user)
    setUserForm({
      user_id: user.user_id,
      first_name: firstName,
      middle_name: middleName,
      last_name: lastName,
      suffix,
      email: user.email,
      username: user.username,
      birth_date: user.birth_date || '',
      mobile_number: user.mobile_number || user.phone || '',
      address: user.address || user.home_address || '',
      password: '',
      role: user.role,
      is_active: user.is_active,
    })
    setError('')
    setIsEditingUser(false)
    setSelected(user)
    setModal('edit-user')
  }

  const startUserEdit = () => {
    setError('')
    setIsEditingUser(true)
  }

  const cancelUserEdit = () => {
    if (!selected) return
    const { firstName, middleName, lastName, suffix } = getUserFormNameParts(selected)
    setUserForm({
      user_id: selected.user_id,
      first_name: firstName,
      middle_name: middleName,
      last_name: lastName,
      suffix,
      email: selected.email,
      username: selected.username,
      birth_date: selected.birth_date || '',
      mobile_number: selected.mobile_number || selected.phone || '',
      address: selected.address || selected.home_address || '',
      password: '',
      role: selected.role,
      is_active: selected.is_active,
    })
    setError('')
    setIsEditingUser(false)
  }

  const addUser = async () => {
    const firstName = toTitleCase(userForm.first_name.trim())
    const middleName = toTitleCase(userForm.middle_name?.trim?.() || '')
    const lastName = toTitleCase(userForm.last_name.trim())
    const suffix = toTitleCase(userForm.suffix?.trim?.() || '')
    const fullName = buildStaffFullName({
      first_name: firstName,
      middle_name: middleName,
      last_name: lastName,
      suffix,
    })
    const username = userForm.username.trim()
    const password = userForm.password.trim()
    const role = userForm.role.trim()
    const email = buildSystemUserEmail(username)

    const nextInvalidFields = {}
    if (!firstName) {
      nextInvalidFields.first_name = true
    }
    if (firstName && !isValidLetterName(firstName)) {
      nextInvalidFields.first_name = true
    }
    if (middleName && !isValidLetterName(middleName, { allowEmpty: true })) {
      nextInvalidFields.middle_name = true
    }
    if (!lastName) {
      nextInvalidFields.last_name = true
    }
    if (lastName && !isValidLetterName(lastName)) {
      nextInvalidFields.last_name = true
    }
    if (!username) {
      nextInvalidFields.username = true
    }
    if (!password) {
      nextInvalidFields.password = true
    }
    if (!role) {
      nextInvalidFields.role = true
    }
    setInvalidAddUserFields(nextInvalidFields)

    if (!firstName || !lastName || !fullName || !email || !username || !password || !role) {
      setAddUserValidationMessage('Please fill out required fields.')
      setModal('add-user-validation')
      return
    }

    if (!isValidLetterName(firstName) || !isValidLetterName(lastName) || !isValidLetterName(middleName, { allowEmpty: true })) {
      setAddUserValidationMessage('First name, last name, and middle name must contain letters only.')
      setModal('add-user-validation')
      return
    }

    if (!EMAIL_PATTERN.test(email)) {
      setInvalidAddUserFields((previous) => ({ ...previous, email: true }))
      setAddUserValidationMessage('Please enter a valid email address.')
      setModal('add-user-validation')
      return
    }

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      const accessToken = sessionData?.session?.access_token || ''
      if (sessionError || !accessToken) {
        setError('Unable to verify your session. Please log in again.')
        return
      }

      const response = await fetch('/api/auth/admin-create-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          email,
          password,
          fullName,
          username,
          role,
          firstName,
          middleName,
          lastName,
          suffix,
          birthDate: userForm.birth_date || null,
          mobileNumber: userForm.mobile_number?.trim?.() || null,
          address: userForm.address?.trim?.() || null,
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(payload?.error || 'Unable to create user.')
        return
      }
    } catch {
      setError('Unable to create user.')
      return
    }

    setShowAddUser(false)
    setShowAddUserPassword(false)
    setInvalidAddUserFields({})
    setAddUserValidationMessage('')
    setUserForm({
      user_id: '',
      first_name: '',
      middle_name: '',
      last_name: '',
      suffix: '',
      email: '',
      username: '',
      birth_date: '',
      mobile_number: '',
      address: '',
      password: '',
      role: 'receptionist',
      is_active: true,
    })
    await loadAll()
    await recordSystemAudit({
      action: 'staff_user_created',
      entityType: 'staff_profile',
      entityLabel: fullName,
      details: 'Created staff user from Admin page.',
      metadata: { username, role },
    })
    showSuccess('Added successfully.')
  }

  const saveUserEdit = async () => {
    if (!selected) return
    const nextEmail = userForm.email.trim().toLowerCase()
    const fullName = buildStaffFullName(userForm)

    if (!nextEmail) {
      setError('Email is required.')
      return
    }

    if (!userForm.first_name.trim() || !userForm.last_name.trim()) {
      setError('First name and last name are required.')
      return
    }

    if (
      !isValidLetterName(userForm.first_name)
      || !isValidLetterName(userForm.last_name)
      || !isValidLetterName(userForm.middle_name, { allowEmpty: true })
    ) {
      setError('First name, last name, and middle name must contain letters only.')
      return
    }

    try {
      const canProceed = await ensureNotLastActiveAdmin({
        targetUserId: selected.user_id,
        nextRole: userForm.role,
        nextIsActive: userForm.is_active,
      })

      if (!canProceed) {
        setError('Cannot deactivate/archive the last active admin account. Add or keep another active admin first.')
        return
      }
    } catch (guardError) {
      setError(guardError.message)
      return
    }

    const { error: updateError } = await supabase
      .from('staff_profiles')
      .update({
        full_name: fullName,
        first_name: toTitleCase(userForm.first_name.trim()),
        middle_name: toTitleCase(userForm.middle_name.trim()) || null,
        last_name: toTitleCase(userForm.last_name.trim()),
        suffix: toTitleCase(userForm.suffix.trim()) || null,
        birth_date: userForm.birth_date || null,
        mobile_number: userForm.mobile_number.trim() || null,
        address: toTitleCase(userForm.address.trim()) || null,
        username: userForm.username.trim(),
        role: userForm.role,
        is_active: userForm.is_active,
      })
      .eq('user_id', selected.user_id)

    if (updateError) {
      setError(updateError.message)
      return
    }

    if (nextEmail !== String(selected.email || '').trim().toLowerCase()) {
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData?.session?.access_token || ''
      if (!accessToken) {
        setError('Unable to verify your session. Please log in again.')
        return
      }

      const response = await fetch('/api/auth/admin-update-user-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          userId: selected.user_id,
          email: nextEmail,
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(payload?.error || 'Unable to update user email.')
        return
      }
    }

    await loadAll()
    setIsEditingUser(false)
    closeModal()
    await recordSystemAudit({
      action: 'staff_user_updated',
      entityType: 'staff_profile',
      entityId: selected.user_id,
      entityLabel: fullName,
      details: 'Updated staff user from Admin page.',
      metadata: { role: userForm.role, isActive: userForm.is_active },
    })
    showSuccess('Updated successfully')
  }

  const confirmArchive = async () => {
    if (!selected) return

    if (selected.kind === 'user') {
      try {
        const canProceed = await ensureNotLastActiveAdmin({
          targetUserId: selected.user_id,
          nextRole: selected.role,
          nextIsActive: false,
        })

        if (!canProceed) {
          setError('Cannot archive the last active admin account. Add or keep another active admin first.')
          closeModal()
          return
        }
      } catch (guardError) {
        setError(guardError.message)
        closeModal()
        return
      }

      const { error: archiveError } = await supabase.rpc('admin_update_user_profile', {
        p_user_id: selected.user_id,
        p_full_name: selected.full_name,
        p_username: selected.username,
        p_role: selected.role,
        p_is_active: false,
      })

      if (archiveError) {
        setError(archiveError.message)
        return
      }

      await loadAll()
      closeModal()
      await recordSystemAudit({
        action: 'staff_user_archived',
        entityType: 'staff_profile',
        entityId: selected.user_id,
        entityLabel: selected.full_name || selected.username,
        details: 'Archived staff user from Admin page.',
      })
      showSuccess('Archived successfully')
      return
    }

    const { data: authData } = await supabase.auth.getUser()
    const actorId = authData?.user?.id ?? null

    const { error: archiveError } = await supabase
      .from('patients')
      .update({
        is_active: false,
        archived_at: new Date().toISOString(),
        archived_by: actorId,
        updated_by: actorId,
      })
      .eq('id', selected.id)

    if (archiveError) {
      setError(archiveError.message)
      return
    }

    await loadAll()
    closeModal()
    await recordSystemAudit({
      action: 'patient_archived',
      entityType: 'patient',
      entityId: selected.id,
      entityLabel: `${selected.last_name}, ${selected.first_name}`,
      details: 'Archived patient from Admin page.',
    })
    showSuccess('Archived successfully')
  }

  const confirmRetrieve = async () => {
    if (!selected) return

    if (archiveType === 'patients') {
      const { data: authData } = await supabase.auth.getUser()
      const actorId = authData?.user?.id ?? null
      const { error: retrieveError } = await supabase
        .from('patients')
        .update({ is_active: true, archived_at: null, archived_by: null, updated_by: actorId })
        .eq('id', selected.id)

      if (retrieveError) {
        setError(retrieveError.message)
        return
      }
    } else if (archiveType === 'users') {
      const { error: retrieveError } = await supabase.rpc('admin_update_user_profile', {
        p_user_id: selected.user_id,
        p_full_name: selected.full_name,
        p_username: selected.username,
        p_role: selected.role,
        p_is_active: true,
      })

      if (retrieveError) {
        setError(retrieveError.message)
        return
      }
    } else if (archiveType === 'services') {
      const { data: authData } = await supabase.auth.getUser()
      const actorId = authData?.user?.id ?? null
      const { error: retrieveError } = await supabase
        .from('services')
        .update({ is_active: true, updated_by: actorId })
        .eq('id', selected.id)

      if (retrieveError) {
        setError(retrieveError.message)
        return
      }
    } else {
      const { data: authData } = await supabase.auth.getUser()
      const actorId = authData?.user?.id ?? null
      const { error: retrieveError } = await supabase
        .from('tooth_conditions')
        .update({ is_active: true, updated_by: actorId })
        .eq('id', selected.id)

      if (retrieveError) {
        setError(retrieveError.message)
        return
      }
    }

    await loadAll()
    closeModal()
    await recordSystemAudit({
      action: archiveType === 'patients'
        ? 'patient_retrieved'
        : archiveType === 'users'
          ? 'staff_user_retrieved'
          : archiveType === 'services'
            ? 'service_retrieved'
            : 'tooth_condition_retrieved',
      entityType: archiveType === 'users'
        ? 'staff_profile'
        : archiveType === 'services'
          ? 'service_catalog'
          : archiveType === 'dentalCondition'
            ? 'tooth_condition'
            : 'patient',
      entityId: archiveType === 'users' ? selected.user_id : selected.id,
      entityLabel: archiveType === 'patients'
        ? `${selected.last_name}, ${selected.first_name}`
        : archiveType === 'users'
          ? (selected.full_name || selected.username)
          : archiveType === 'services'
            ? selected.service_name
            : `${selected.code} - ${selected.condition_name}`,
      details: 'Retrieved archived record from Admin page.',
    })
    showSuccess('Retrieved successfully')
  }

  const approvePendingPatientRequest = (request) => {
    if (!request?.id) return
    setPendingConfirmAction({ type: 'approve', request })
  }

  const _executeApprovePendingPatientRequest = async (request) => {
    const isPatientUpdateRequest = request.request_source === 'patient_details_update'
    setPendingProcessingId(request.id)
    setError('')

    try {
      const payload = request.payload && typeof request.payload === 'object' && !Array.isArray(request.payload)
        ? request.payload
        : null
      if (!payload) {
        throw new Error('The pending request payload is missing or invalid.')
      }

      const { data: authData } = await supabase.auth.getUser()
      const actorId = authData?.user?.id ?? null

      let resolvedPatientId = null
      let resolvedPatientCode = null

      if (isPatientUpdateRequest) {
        const targetPatientId = `${payload.patient_id || ''}`.trim()
        if (!targetPatientId) {
          throw new Error('The patient update request is missing its target patient ID.')
        }

        const duplicatePatient = await findExistingPatientRecord(supabase, {
          firstName: payload.first_name,
          lastName: payload.last_name,
          sex: payload.sex,
          birthdate: payload.birth_date,
          excludeId: targetPatientId,
        })
        if (duplicatePatient) {
          throw new Error(
            `Existing record found (${formatPatientCode(duplicatePatient.patient_code, duplicatePatient.id)} - ${duplicatePatient.last_name}, ${duplicatePatient.first_name}).`,
          )
        }

        const updatePayload = {
          ...payload,
          updated_by: actorId,
        }
        delete updatePayload.patient_id
        delete updatePayload.registered_email

        const { data: updatedPatient, error: updatePatientError } = await supabase
          .from('patients')
          .update(updatePayload)
          .eq('id', targetPatientId)
          .eq('is_active', true)
          .select('id, patient_code')
          .maybeSingle()

        if (updatePatientError) throw updatePatientError
        if (!updatedPatient?.id) throw new Error('The patient record for this update request is no longer available.')

        resolvedPatientId = updatedPatient.id
        resolvedPatientCode = updatedPatient.patient_code || null

        const { error: logError } = await supabase.from('patient_logs').insert({
          patient_id: updatedPatient.id,
          action: 'update_patient',
          details: 'Updated from approved pending patient change request',
        })
        if (logError) throw logError
      } else {
        const duplicatePatient = await findExistingPatientRecord(supabase, {
          firstName: payload.first_name,
          lastName: payload.last_name,
          sex: payload.sex,
          birthdate: payload.birth_date,
        })
        if (duplicatePatient) {
          throw new Error(
            `Existing record found (${formatPatientCode(duplicatePatient.patient_code, duplicatePatient.id)} - ${duplicatePatient.last_name}, ${duplicatePatient.first_name}).`,
          )
        }

        const { data: insertedPatient, error: insertError } = await supabase
          .from('patients')
          .insert({
            ...payload,
            created_by: actorId,
            updated_by: actorId,
          })
          .select('id, patient_code')
          .single()

        if (insertError) throw insertError

        resolvedPatientId = insertedPatient.id
        resolvedPatientCode = insertedPatient.patient_code || null

        const { error: logError } = await supabase.from('patient_logs').insert({
          patient_id: insertedPatient.id,
          action: 'create_patient',
          details: 'Created from approved pending patient request',
        })
        if (logError) throw logError
      }

      const { error: updateError } = await supabase
        .from('pending_patient_registrations')
        .update({
          status: 'approved',
          decided_by: actorId,
          decided_at: new Date().toISOString(),
          resolved_patient_id: resolvedPatientId,
        })
        .eq('id', request.id)
        .eq('status', 'pending')

      if (updateError) throw updateError

      await loadAll()
      await recordSystemAudit({
        action: 'pending_patient_request_approved',
        entityType: 'pending_patient_registration',
        entityId: request.id,
        entityLabel: `${request.last_name}, ${request.first_name}`,
        details: isPatientUpdateRequest
          ? 'Approved pending patient update request and applied changes to the patient record.'
          : 'Approved pending patient request and created patient record.',
        metadata: {
          resolvedPatientId,
          patientCode: resolvedPatientCode,
          requestSource: request.request_source || 'add_patient_form',
        },
      })
      showSuccess(isPatientUpdateRequest ? 'Patient update request approved successfully.' : 'Patient request approved successfully.')
    } catch (approveError) {
      setError(
        isPatientDuplicateError(approveError)
          ? 'A patient with the same name, sex, and birthdate already exists.'
          : (approveError?.message || 'Unable to approve patient request.'),
      )
    } finally {
      setPendingProcessingId('')
    }
  }

  const declinePendingPatientRequest = (request) => {
    if (!request?.id) return
    setPendingConfirmAction({ type: 'decline', request })
  }

  const _executeDeclinePendingPatientRequest = async (request) => {
    setPendingProcessingId(request.id)
    setError('')

    try {
      const { data: authData } = await supabase.auth.getUser()
      const actorId = authData?.user?.id ?? null

      const { error: updateError } = await supabase
        .from('pending_patient_registrations')
        .update({
          status: 'declined',
          decided_by: actorId,
          decided_at: new Date().toISOString(),
        })
        .eq('id', request.id)
        .eq('status', 'pending')

      if (updateError) throw updateError

      await loadAll()
      await recordSystemAudit({
        action: 'pending_patient_request_declined',
        entityType: 'pending_patient_registration',
        entityId: request.id,
        entityLabel: `${request.last_name}, ${request.first_name}`,
        details: 'Declined pending patient request.',
      })
      showSuccess('Patient request declined successfully.')
    } catch (declineError) {
      setError(declineError?.message || 'Unable to decline patient request.')
    } finally {
      setPendingProcessingId('')
    }
  }

  const archiveRows = useMemo(() => {
    if (archiveType === 'patients') return archivePatients
    if (archiveType === 'users') return archiveUsers
    if (archiveType === 'services') return archiveServices
    return archiveDentalConditions
  }, [archiveType, archivePatients, archiveUsers, archiveServices, archiveDentalConditions])

  const filteredUsers = useMemo(() => {
    const query = usersSearchTerm.trim().toLowerCase()
    const source = query
      ? users.filter((row) => (
        row.full_name?.toLowerCase().includes(query)
        || row.username?.toLowerCase().includes(query)
        || row.email?.toLowerCase().includes(query)
        || formatStaffCode(row.user_id).toLowerCase().includes(query)
      ))
      : [...users]

    const filtered = source.filter((row) => {
      if (usersRoleFilter && row.role !== usersRoleFilter) return false

      const createdDate = `${row.created_at || ''}`.slice(0, 10)
      if (usersCreatedFromFilter && (!createdDate || createdDate < usersCreatedFromFilter)) return false
      if (usersCreatedToFilter && (!createdDate || createdDate > usersCreatedToFilter)) return false

      return true
    })

    if (usersSortBy === 'created') {
      const multiplier = usersCreatedSortDirection === 'asc' ? 1 : -1
      return filtered.sort((a, b) => (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * multiplier)
    }

    if (usersSortBy === 'staffId') {
      const multiplier = usersStaffIdSortDirection === 'asc' ? 1 : -1
      return filtered.sort((a, b) => (staffCodeNumber(a) - staffCodeNumber(b)) * multiplier)
    }

    if (usersSortBy === 'role') {
      const multiplier = usersRoleSortDirection === 'asc' ? 1 : -1
      return filtered.sort((a, b) => {
        const aRole = ROLE_SORT_ORDER[a.role] ?? Number.MAX_SAFE_INTEGER
        const bRole = ROLE_SORT_ORDER[b.role] ?? Number.MAX_SAFE_INTEGER
        if (aRole !== bRole) return (aRole - bRole) * multiplier
        const aName = `${a.full_name || ''}`.toLowerCase()
        const bName = `${b.full_name || ''}`.toLowerCase()
        return aName.localeCompare(bName)
      })
    }

    return filtered.sort((a, b) => {
      const aName = `${a.full_name || ''}`.toLowerCase()
      const bName = `${b.full_name || ''}`.toLowerCase()
      return usersNameSortDirection === 'asc' ? aName.localeCompare(bName) : bName.localeCompare(aName)
    })
  }, [
    users,
    usersCreatedFromFilter,
    usersCreatedSortDirection,
    usersCreatedToFilter,
    usersNameSortDirection,
    usersRoleFilter,
    usersRoleSortDirection,
    usersSearchTerm,
    usersSortBy,
    usersStaffIdSortDirection,
  ])

  const filteredInactivePatients = useMemo(() => {
    const query = inactiveSearchTerm.trim().toLowerCase()
    const source = query
      ? inactivePatients.filter((row) => (
        `${row.last_name || ''}, ${row.first_name || ''}`.toLowerCase().includes(query)
        || formatPatientCode(row.patient_code, row.id).toLowerCase().includes(query)
      ))
      : [...inactivePatients]

    const filtered = source.filter((row) => {
      if (inactiveSexFilter && row.sex !== inactiveSexFilter) return false

      const age = calculateAge(row.birth_date)
      const numericAge = typeof age === 'number' ? age : Number.parseInt(`${age}`, 10)
      const minAge = Number.parseInt(inactiveMinAgeFilter, 10)
      const maxAge = Number.parseInt(inactiveMaxAgeFilter, 10)
      if (Number.isFinite(minAge) && (!Number.isFinite(numericAge) || numericAge < minAge)) return false
      if (Number.isFinite(maxAge) && (!Number.isFinite(numericAge) || numericAge > maxAge)) return false

      const inactiveDate = `${row.archived_at ?? row.created_at ?? ''}`.slice(0, 10)
      if (inactiveDateFromFilter && (!inactiveDate || inactiveDate < inactiveDateFromFilter)) return false
      if (inactiveDateToFilter && (!inactiveDate || inactiveDate > inactiveDateToFilter)) return false

      return true
    })

    if (inactiveSortBy === 'inactiveDate') {
      const multiplier = inactiveDateSortDirection === 'asc' ? 1 : -1
      return filtered.sort((a, b) => (
        (new Date(a.archived_at ?? a.created_at).getTime() - new Date(b.archived_at ?? b.created_at).getTime()) * multiplier
      ))
    }

    if (inactiveSortBy === 'patientId') {
      const multiplier = inactivePatientIdSortDirection === 'asc' ? 1 : -1
      return filtered.sort((a, b) => (patientCodeNumber(a) - patientCodeNumber(b)) * multiplier)
    }

    return filtered.sort((a, b) => {
      const aName = `${a.last_name || ''}, ${a.first_name || ''}`.toLowerCase()
      const bName = `${b.last_name || ''}, ${b.first_name || ''}`.toLowerCase()
      return inactiveNameSortDirection === 'asc' ? aName.localeCompare(bName) : bName.localeCompare(aName)
    })
  }, [
    inactiveDateSortDirection,
    inactiveDateFromFilter,
    inactiveDateToFilter,
    inactiveMaxAgeFilter,
    inactiveMinAgeFilter,
    inactiveNameSortDirection,
    inactivePatientIdSortDirection,
    inactivePatients,
    inactiveSearchTerm,
    inactiveSexFilter,
    inactiveSortBy,
  ])

  const filteredPendingPatientRequests = useMemo(() => {
    const query = pendingSearchTerm.trim().toLowerCase()
    const source = query
      ? pendingPatientRequests.filter((row) => (
        `${row.last_name || ''}, ${row.first_name || ''}`.toLowerCase().includes(query)
        || `${row.email || 'n/a'}`.toLowerCase().includes(query)
        || `${row.requested_by_name || ''}`.toLowerCase().includes(query)
      ))
      : [...pendingPatientRequests]

    return source.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }, [pendingPatientRequests, pendingSearchTerm])

  const filteredArchiveRows = useMemo(() => {
    const query = archiveSearchTerm.trim().toLowerCase()
    const source = query
      ? archiveRows.filter((row) => {
        if (archiveType === 'patients') {
          return (
            `${row.last_name || ''}, ${row.first_name || ''}`.toLowerCase().includes(query)
            || formatPatientCode(row.patient_code, row.id).toLowerCase().includes(query)
          )
        }
        if (archiveType === 'users') {
          return (
            `${row.full_name || ''}`.toLowerCase().includes(query)
            || `${row.username || ''}`.toLowerCase().includes(query)
            || formatStaffCode(row.user_id).toLowerCase().includes(query)
          )
        }
        if (archiveType === 'services') {
          return `${row.service_name || ''}`.toLowerCase().includes(query)
        }
        return (
          `${row.code || ''}`.toLowerCase().includes(query)
          || `${row.condition_name || ''}`.toLowerCase().includes(query)
        )
      })
      : [...archiveRows]

    const filtered = source.filter((row) => {
      const archiveDate = `${row.updated_at ?? row.archived_at ?? ''}`.slice(0, 10)
      if (archiveDateFromFilter && (!archiveDate || archiveDate < archiveDateFromFilter)) return false
      if (archiveDateToFilter && (!archiveDate || archiveDate > archiveDateToFilter)) return false

      if (archiveType === 'patients') {
        if (archiveSexFilter && row.sex !== archiveSexFilter) return false
        const age = calculateAge(row.birth_date)
        const numericAge = typeof age === 'number' ? age : Number.parseInt(`${age}`, 10)
        const minAge = Number.parseInt(archiveMinAgeFilter, 10)
        const maxAge = Number.parseInt(archiveMaxAgeFilter, 10)
        if (Number.isFinite(minAge) && (!Number.isFinite(numericAge) || numericAge < minAge)) return false
        if (Number.isFinite(maxAge) && (!Number.isFinite(numericAge) || numericAge > maxAge)) return false
      }

      if (archiveType === 'users' && archiveRoleFilter && row.role !== archiveRoleFilter) return false

      return true
    })

    if (archiveSortBy === 'archiveDate') {
      const multiplier = archiveDateSortDirection === 'asc' ? 1 : -1
      return filtered.sort((a, b) => (new Date(a.updated_at ?? a.archived_at).getTime() - new Date(b.updated_at ?? b.archived_at).getTime()) * multiplier)
    }

    if (archiveSortBy === 'patientId' && archiveType === 'patients') {
      const multiplier = archiveIdSortDirection === 'asc' ? 1 : -1
      return filtered.sort((a, b) => (patientCodeNumber(a) - patientCodeNumber(b)) * multiplier)
    }

    if (archiveSortBy === 'staffId' && archiveType === 'users') {
      const multiplier = archiveIdSortDirection === 'asc' ? 1 : -1
      return filtered.sort((a, b) => (staffCodeNumber(a) - staffCodeNumber(b)) * multiplier)
    }

    return filtered.sort((a, b) => {
      const aName = archiveType === 'patients'
        ? `${a.last_name || ''}, ${a.first_name || ''}`.toLowerCase()
        : archiveType === 'users'
          ? `${a.full_name || ''}`.toLowerCase()
          : archiveType === 'services'
            ? `${a.service_name || ''}`.toLowerCase()
            : `${a.condition_name || ''}`.toLowerCase()
      const bName = archiveType === 'patients'
        ? `${b.last_name || ''}, ${b.first_name || ''}`.toLowerCase()
        : archiveType === 'users'
          ? `${b.full_name || ''}`.toLowerCase()
          : archiveType === 'services'
            ? `${b.service_name || ''}`.toLowerCase()
            : `${b.condition_name || ''}`.toLowerCase()
      return archiveNameSortDirection === 'asc' ? aName.localeCompare(bName) : bName.localeCompare(aName)
    })
  }, [
    archiveDateFromFilter,
    archiveDateSortDirection,
    archiveDateToFilter,
    archiveIdSortDirection,
    archiveMaxAgeFilter,
    archiveMinAgeFilter,
    archiveNameSortDirection,
    archiveRoleFilter,
    archiveRows,
    archiveSearchTerm,
    archiveSexFilter,
    archiveSortBy,
    archiveType,
  ])

  const filteredAuditLogs = useMemo(() => {
    const query = auditSearchTerm.trim().toLowerCase()
    const categoryRows = auditCategoryFilter === 'all'
      ? [...auditLogs]
      : auditLogs.filter((row) => getAuditCategoryKey(row) === auditCategoryFilter)

    const rows = query
      ? categoryRows.filter((row) => (
        `${row.subject || ''}`.toLowerCase().includes(query)
        || `${row.actorName || ''}`.toLowerCase().includes(query)
        || `${row.action || ''}`.toLowerCase().includes(query)
        || `${row.source || ''}`.toLowerCase().includes(query)
        || `${row.details || ''}`.toLowerCase().includes(query)
      ))
      : categoryRows

    return rows.sort((a, b) => {
      const aTime = new Date(a.timestamp).getTime()
      const bTime = new Date(b.timestamp).getTime()
      return auditSortDirection === 'asc' ? aTime - bTime : bTime - aTime
    })
  }, [auditCategoryFilter, auditLogs, auditSearchTerm, auditSortDirection])

  const auditCategoryCounts = useMemo(() => (
    AUDIT_CATEGORY_OPTIONS.reduce((accumulator, option) => {
      accumulator[option.value] = option.value === 'all'
        ? auditLogs.length
        : auditLogs.filter((row) => getAuditCategoryKey(row) === option.value).length
      return accumulator
    }, {})
  ), [auditLogs])

  const activeAdminCount = useMemo(
    () => users.filter((user) => user.is_active && user.role === 'admin').length,
    [users],
  )

  const ensureNotLastActiveAdmin = async ({ targetUserId, nextRole, nextIsActive }) => {
    const { data: targetUser, error: targetError } = await supabase
      .from('staff_profiles')
      .select('user_id, role, is_active')
      .eq('user_id', targetUserId)
      .maybeSingle()

    if (targetError) throw targetError
    if (!targetUser) return true

    const isCurrentlyActiveAdmin = targetUser.is_active && targetUser.role === 'admin'
    const willRemainActiveAdmin = nextIsActive && nextRole === 'admin'
    if (!isCurrentlyActiveAdmin || willRemainActiveAdmin) return true

    const { count, error: countError } = await supabase
      .from('staff_profiles')
      .select('user_id', { count: 'exact', head: true })
      .eq('is_active', true)
      .eq('role', 'admin')

    if (countError) throw countError
    return (count ?? 0) > 1
  }

  const paginateRows = (rows, page, pageSize) => {
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
    const safePage = Math.min(page, totalPages)
    const startIndex = (safePage - 1) * pageSize
    return {
      totalPages,
      safePage,
      startIndex,
      visibleStart: rows.length === 0 ? 0 : startIndex + 1,
      visibleEnd: rows.length === 0 ? 0 : Math.min(startIndex + pageSize, rows.length),
      pageRows: rows.slice(startIndex, startIndex + pageSize),
      pageNumbers: Array.from({ length: totalPages }, (_, index) => index + 1),
    }
  }

  const usersPaging = paginateRows(filteredUsers, usersPage, usersRowsPerPage)
  const inactivePaging = paginateRows(filteredInactivePatients, inactivePage, inactiveRowsPerPage)
  const pendingPaging = paginateRows(filteredPendingPatientRequests, pendingPage, pendingRowsPerPage)
  const archivePaging = paginateRows(filteredArchiveRows, archivePage, archiveRowsPerPage)
  const auditPaging = paginateRows(filteredAuditLogs, auditPage, auditRowsPerPage)

  const hasUsersFilters = Boolean(usersRoleFilter || usersCreatedFromFilter || usersCreatedToFilter)
  const hasInactiveFilters = Boolean(inactiveSexFilter || inactiveMinAgeFilter || inactiveMaxAgeFilter || inactiveDateFromFilter || inactiveDateToFilter)
  const hasArchiveFilters = Boolean(archiveSexFilter || archiveRoleFilter || archiveMinAgeFilter || archiveMaxAgeFilter || archiveDateFromFilter || archiveDateToFilter)

  const clearUsersFilters = () => {
    setUsersRoleFilter('')
    setUsersCreatedFromFilter('')
    setUsersCreatedToFilter('')
    setUsersPage(1)
    setUsersPageInput('1')
  }

  const clearInactiveFilters = () => {
    setInactiveSexFilter('')
    setInactiveMinAgeFilter('')
    setInactiveMaxAgeFilter('')
    setInactiveDateFromFilter('')
    setInactiveDateToFilter('')
    setInactivePage(1)
    setInactivePageInput('1')
  }

  const clearArchiveFilters = () => {
    setArchiveSexFilter('')
    setArchiveRoleFilter('')
    setArchiveMinAgeFilter('')
    setArchiveMaxAgeFilter('')
    setArchiveDateFromFilter('')
    setArchiveDateToFilter('')
    setArchivePage(1)
    setArchivePageInput('1')
  }

  const usersCurrentSortDirection = (
    usersSortBy === 'created'
      ? usersCreatedSortDirection
      : usersSortBy === 'staffId'
        ? usersStaffIdSortDirection
        : usersSortBy === 'role'
          ? usersRoleSortDirection
          : usersNameSortDirection
  )

  const inactiveCurrentSortDirection = (
    inactiveSortBy === 'inactiveDate'
      ? inactiveDateSortDirection
      : inactiveSortBy === 'patientId'
        ? inactivePatientIdSortDirection
        : inactiveNameSortDirection
  )

  const archiveCurrentSortDirection = (
    archiveSortBy === 'archiveDate'
      ? archiveDateSortDirection
      : (archiveSortBy === 'patientId' || archiveSortBy === 'staffId')
        ? archiveIdSortDirection
        : archiveNameSortDirection
  )
  const usersCurrentSortDirectionLabel = (
    usersSortBy === 'created'
      ? usersCurrentSortDirection === 'asc'
        ? 'Oldest to newest'
        : 'Newest to oldest'
      : usersCurrentSortDirection === 'asc'
        ? 'Ascending'
        : 'Descending'
  )
  const inactiveCurrentSortDirectionLabel = (
    inactiveSortBy === 'inactiveDate'
      ? inactiveCurrentSortDirection === 'asc'
        ? 'Oldest to newest'
        : 'Newest to oldest'
      : inactiveCurrentSortDirection === 'asc'
        ? 'Ascending'
        : 'Descending'
  )
  const archiveCurrentSortDirectionLabel = (
    archiveSortBy === 'archiveDate'
      ? archiveCurrentSortDirection === 'asc'
        ? 'Oldest to newest'
        : 'Newest to oldest'
      : archiveCurrentSortDirection === 'asc'
        ? 'Ascending'
        : 'Descending'
  )

  const handlePageJump = ({ pageInput, setPageInput, setPage, totalPages, fallbackPage }) => {
    const parsedPage = Number.parseInt(pageInput, 10)
    if (!Number.isFinite(parsedPage)) {
      setPageInput(`${fallbackPage}`)
      return
    }

    const nextPage = Math.min(Math.max(parsedPage, 1), totalPages)
    setPage(nextPage)
    setPageInput(`${nextPage}`)
  }

  const getVisiblePageItems = (safePage, totalPages) => {
    if (totalPages <= 3) return Array.from({ length: totalPages }, (_, index) => index + 1)

    const startPage = Math.max(1, Math.min(safePage - 1, totalPages - 2))
    return Array.from({ length: 3 }, (_, index) => startPage + index)
  }

  const renderPaginationControls = ({ paging, rowsPerPage, setRowsPerPage, setPage, pageInput, setPageInput }) => {
    const pageItems = getVisiblePageItems(paging.safePage, paging.totalPages)

    return (
      <div className="pagination">
      <div className="pagination-group pagination-size-group">
        <label className="page-size-control">
          Rows
          <select
            value={rowsPerPage}
            onChange={(event) => {
              const nextPageSize = Number(event.target.value)
              setRowsPerPage(nextPageSize)
              setPage(1)
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
        <button
          type="button"
          aria-label="Previous page"
          disabled={paging.safePage <= 1}
          onClick={() => {
            const nextPage = Math.max(1, paging.safePage - 1)
            setPage(nextPage)
            setPageInput(`${nextPage}`)
          }}
        >
          &#10094;
        </button>
        {pageItems.map((item) => (
          typeof item === 'number'
            ? (
              <button
                key={`page-${item}`}
                type="button"
                className={item === paging.safePage ? 'active' : ''}
                onClick={() => {
                  setPage(item)
                  setPageInput(`${item}`)
                }}
              >
                {item}
              </button>
            )
            : <span key={item} className="pagination-ellipsis">...</span>
        ))}
        <button
          type="button"
          aria-label="Next page"
          disabled={paging.safePage >= paging.totalPages}
          onClick={() => {
            const nextPage = Math.min(paging.totalPages, paging.safePage + 1)
            setPage(nextPage)
            setPageInput(`${nextPage}`)
          }}
        >
          &#10095;
        </button>
      </div>
      <div className="pagination-group pagination-jump-group">
        <form
          className="page-jump-form"
          onSubmit={(event) => {
            event.preventDefault()
            handlePageJump({
              pageInput,
              setPageInput,
              setPage,
              totalPages: paging.totalPages,
              fallbackPage: paging.safePage,
            })
          }}
        >
          <label>
            Page
            <input
              type="number"
              min="1"
              max={paging.totalPages}
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value)}
            />
          </label>
          <button type="submit">Go</button>
        </form>
      </div>
    </div>
    )
  }

  return (
    <>
      <header className="page-header">
        <h1>Admin</h1>
        <div className="page-header-actions">
          <button type="button" className="primary" onClick={() => navigate('/admin/import')}>Import Patient Records</button>
        </div>
      </header>

      <section className={`panel tabs-panel admin-panel v2 ${showAddUser ? '' : 'fixed-table-page'}`}>
        <div className="panel-tabs large add-patient-tabs compact-tabs admin-tabs">
          <button type="button" className={`tab ${tab === 'users' ? 'active' : ''}`} onClick={() => { setTab('users'); setShowAddUser(false); setUsersPage(1); setUsersPageInput('1') }}>
            Manage Users
          </button>
          <button type="button" className={`tab ${tab === 'inactive' ? 'active' : ''}`} onClick={() => { setTab('inactive'); setShowAddUser(false); setInactivePage(1); setInactivePageInput('1') }}>
            Inactive List
          </button>
          <button type="button" className={`tab ${tab === 'requests' ? 'active' : ''}`} onClick={() => { setTab('requests'); setShowAddUser(false); setPendingPage(1); setPendingPageInput('1') }}>
            Patient Requests
          </button>
          <button type="button" className={`tab ${tab === 'archive' ? 'active' : ''}`} onClick={() => { setTab('archive'); setShowAddUser(false); setArchivePage(1); setArchivePageInput('1') }}>
            Archive List
          </button>
          <button type="button" className={`tab ${tab === 'audit' ? 'active' : ''}`} onClick={() => { setTab('audit'); setShowAddUser(false); setAuditPage(1); setAuditPageInput('1') }}>
            Audit Logs
          </button>
        </div>

        <ErrorModal message={error || importError} onClose={() => {
          setError('')
          setImportError('')
        }} />
        {loading ? <p>Loading admin data...</p> : null}

        {tab === 'users' && !showAddUser ? (
          <div className="records">
            <div className="records-header admin-records-header">
              <div>
                <div className="records-toolbar">
                  <div className="search-box">
                    <span className="search-icon" aria-hidden />
                    <input
                      type="text"
                      placeholder="Search by Name"
                      value={usersSearchTerm}
                      onChange={(event) => {
                        setUsersSearchTerm(event.target.value)
                        setUsersPage(1)
                        setUsersPageInput('1')
                      }}
                    />
                  </div>
                </div>
              </div>
              <div className="records-actions">
                <button type="button" className="primary" onClick={() => {
                  setShowAddUserPassword(false)
                  setShowAddUser(true)
                }}>Add User</button>
                <button type="button" className={`ghost records-filter-toggle ${showUsersFilters ? 'is-open' : ''}`} onClick={() => setShowUsersFilters(true)}>Filters</button>
                <div className="sorter">
                  <label htmlFor="admin-users-sort">Sort by:</label>
                  <select
                    id="admin-users-sort"
                    value={usersSortBy}
                    onChange={(event) => {
                      setUsersSortBy(event.target.value)
                      setUsersPage(1)
                      setUsersPageInput('1')
                    }}
                  >
                    <option value="name">Name</option>
                    <option value="staffId">Staff ID</option>
                    <option value="role">Role</option>
                    <option value="created">Date Created</option>
                  </select>
                  <button
                    type="button"
                    className="ghost sort-direction-btn"
                    aria-label={usersCurrentSortDirectionLabel}
                    title={usersCurrentSortDirectionLabel}
                    onClick={() => {
                      if (usersSortBy === 'created') {
                        setUsersCreatedSortDirection((previous) => (previous === 'asc' ? 'desc' : 'asc'))
                      } else if (usersSortBy === 'staffId') {
                        setUsersStaffIdSortDirection((previous) => (previous === 'asc' ? 'desc' : 'asc'))
                      } else if (usersSortBy === 'role') {
                        setUsersRoleSortDirection((previous) => (previous === 'asc' ? 'desc' : 'asc'))
                      } else {
                        setUsersNameSortDirection((previous) => (previous === 'asc' ? 'desc' : 'asc'))
                      }
                      setUsersPage(1)
                      setUsersPageInput('1')
                    }}
                  >
                    <SortDirectionIcon
                      direction={
                        (usersSortBy === 'created'
                          ? usersCreatedSortDirection
                          : usersSortBy === 'staffId'
                            ? usersStaffIdSortDirection
                            : usersSortBy === 'role'
                              ? usersRoleSortDirection
                              : usersNameSortDirection)
                      }
                    />
                  </button>
                </div>
              </div>
            </div>

            <div className="records-table users-table">
              <div className="table-head">
                <span>Status</span>
                <span>Staff ID</span>
                <span>Fullname</span>
                <span>Email</span>
                <span>Role</span>
                <span>Date Created</span>
                <span>Action</span>
              </div>
              <div className="table-body">
                {usersPaging.pageRows.map((row) => (
                  <div key={row.user_id} className="table-row">
                    <span className="user-online-cell">
                        <span
                        className={`user-online-indicator ${isStaffOnlineNow(row) ? 'is-online' : 'is-offline'}`}
                        aria-label={isStaffOnlineNow(row) ? 'Online' : 'Offline'}
                        title={isStaffOnlineNow(row) ? 'Online' : 'Offline'}
                      />
                    </span>
                    <span>{formatStaffCode(row.user_id)}</span>
                    <span>{formatStaffDisplayName(row)}</span>
                    <span>{row.email}</span>
                    <span>{ROLE_LABELS[row.role] ?? row.role}</span>
                    <span>{formatDate(row.created_at)}</span>
                    <span className="row-actions">
                      <button type="button" className="view" onClick={() => openEditUser(row)}>View</button>
                      {row.is_active ? (
                        <button
                          type="button"
                          className="icon-btn danger"
                          onClick={() => openConfirmArchive({ ...row, kind: 'user' })}
                          disabled={row.role === 'admin' && activeAdminCount <= 1}
                          title={row.role === 'admin' && activeAdminCount <= 1 ? 'At least one active admin must remain.' : 'Archive user'}
                        >
                          &#8681;
                        </button>
                      ) : null}
                    </span>
                  </div>
                ))}
                {!loading && filteredUsers.length === 0 ? <p>No users found.</p> : null}
              </div>
            </div>
            <div className="records-footer">
              <span>Showing {usersPaging.visibleStart}-{usersPaging.visibleEnd} of {filteredUsers.length} entries</span>
              {renderPaginationControls({
                paging: usersPaging,
                rowsPerPage: usersRowsPerPage,
                setRowsPerPage: setUsersRowsPerPage,
                setPage: setUsersPage,
                pageInput: usersPageInput,
                setPageInput: setUsersPageInput,
              })}
            </div>
          </div>
        ) : null}

        {tab === 'users' && showAddUser ? (
          <div className="records add-user-card">
            <div className="records-header">
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setShowAddUser(false)
                  setShowAddUserPassword(false)
                  setInvalidAddUserFields({})
                  setAddUserValidationMessage('')
                }}
              >
                &larr; Back
              </button>
            </div>
            <h2>Add User</h2>
            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault()
                void addUser()
              }}
            >
              <div className="history-top-grid">
                <label><span className="required-label">First name<span className="required-asterisk">*</span></span><input className={invalidAddUserFields.first_name ? 'input-error' : ''} type="text" value={userForm.first_name} onChange={(e) => {
                  const nextValue = formatLetterNameInput(e.target.value)
                  setUserForm((p) => ({ ...p, first_name: nextValue }))
                  if (nextValue.trim()) setInvalidAddUserFields((p) => ({ ...p, first_name: false }))
                }} /></label>
                <label><span className="required-label">Last name<span className="required-asterisk">*</span></span><input className={invalidAddUserFields.last_name ? 'input-error' : ''} type="text" value={userForm.last_name} onChange={(e) => {
                  const nextValue = formatLetterNameInput(e.target.value)
                  setUserForm((p) => ({ ...p, last_name: nextValue }))
                  if (nextValue.trim()) setInvalidAddUserFields((p) => ({ ...p, last_name: false }))
                }} /></label>
                <label><span className="required-label">Username<span className="required-asterisk">*</span></span><input className={invalidAddUserFields.username ? 'input-error' : ''} type="text" value={userForm.username} onChange={(e) => {
                  const nextValue = e.target.value
                  setUserForm((p) => ({ ...p, username: nextValue }))
                  if (nextValue.trim()) setInvalidAddUserFields((p) => ({ ...p, username: false }))
                }} /></label>
                <label>
                  <span className="required-label">Password<span className="required-asterisk">*</span></span>
                  <div className="password-field">
                    <input className={invalidAddUserFields.password ? 'input-error' : ''} type={showAddUserPassword ? 'text' : 'password'} value={userForm.password} onChange={(e) => {
                      const nextValue = e.target.value
                      setUserForm((p) => ({ ...p, password: nextValue }))
                      if (nextValue.trim()) setInvalidAddUserFields((p) => ({ ...p, password: false }))
                    }} />
                    <button
                      type="button"
                      className="eye-toggle"
                      onClick={() => setShowAddUserPassword((previous) => !previous)}
                      aria-label={showAddUserPassword ? 'Hide password' : 'Show password'}
                      title={showAddUserPassword ? 'Hide password' : 'Show password'}
                    >
                      <svg
                        className="eye-icon"
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        aria-hidden
                      >
                        <path
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12Z"
                        />
                        <circle
                          cx="12"
                          cy="12"
                          r="3"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                        />
                        {!showAddUserPassword ? (
                          <line
                            x1="4"
                            y1="4"
                            x2="20"
                            y2="20"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                          />
                        ) : null}
                      </svg>
                    </button>
                  </div>
                </label>
                <label><span className="required-label">Role<span className="required-asterisk">*</span></span><select className={invalidAddUserFields.role ? 'input-error' : ''} value={userForm.role} onChange={(e) => {
                  const nextValue = e.target.value
                  setUserForm((p) => ({ ...p, role: nextValue }))
                  if (nextValue.trim()) setInvalidAddUserFields((p) => ({ ...p, role: false }))
                }}>{ROLE_OPTIONS.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label>
              </div>
              <div className="panel-footer">
                <button type="submit" className="primary wide">Add</button>
              </div>
            </form>
          </div>
        ) : null}

        {tab === 'inactive' ? (
          <div className="records">
            <div className="records-header admin-records-header">
              <div>
                <div className="records-toolbar">
                  <div className="search-box">
                    <span className="search-icon" aria-hidden />
                    <input
                      type="text"
                      placeholder="Search by Name"
                      value={inactiveSearchTerm}
                      onChange={(event) => {
                        setInactiveSearchTerm(event.target.value)
                        setInactivePage(1)
                        setInactivePageInput('1')
                      }}
                    />
                  </div>
                </div>
              </div>
              <div className="records-actions">
                <button type="button" className={`ghost records-filter-toggle ${showInactiveFilters ? 'is-open' : ''}`} onClick={() => setShowInactiveFilters(true)}>Filters</button>
                <div className="sorter">
                  <label htmlFor="admin-inactive-sort">Sort by:</label>
                  <select
                    id="admin-inactive-sort"
                    value={inactiveSortBy}
                    onChange={(event) => {
                      setInactiveSortBy(event.target.value)
                      setInactivePage(1)
                      setInactivePageInput('1')
                    }}
                  >
                    <option value="name">Name</option>
                    <option value="patientId">Patient ID</option>
                    <option value="inactiveDate">Inactive Date</option>
                  </select>
                  <button
                    type="button"
                    className="ghost sort-direction-btn"
                    aria-label={inactiveCurrentSortDirectionLabel}
                    title={inactiveCurrentSortDirectionLabel}
                    onClick={() => {
                      if (inactiveSortBy === 'inactiveDate') {
                        setInactiveDateSortDirection((previous) => (previous === 'asc' ? 'desc' : 'asc'))
                      } else if (inactiveSortBy === 'patientId') {
                        setInactivePatientIdSortDirection((previous) => (previous === 'asc' ? 'desc' : 'asc'))
                      } else {
                        setInactiveNameSortDirection((previous) => (previous === 'asc' ? 'desc' : 'asc'))
                      }
                      setInactivePage(1)
                      setInactivePageInput('1')
                    }}
                  >
                    <SortDirectionIcon
                      direction={
                        (inactiveSortBy === 'inactiveDate'
                          ? inactiveDateSortDirection
                          : inactiveSortBy === 'patientId'
                            ? inactivePatientIdSortDirection
                            : inactiveNameSortDirection)
                      }
                    />
                  </button>
                </div>
              </div>
            </div>

            <div className="records-table inactive-table">
              <div className="table-head">
                <span>Patient ID</span>
                <span>Full Name</span>
                <span>Sex</span>
                <span>Age</span>
                <span>Inactive Date</span>
                <span>Action</span>
              </div>
              <div className="table-body">
                {inactivePaging.pageRows.map((row) => (
                  <div key={row.id} className="table-row">
                    <span>{formatPatientCode(row.patient_code, row.id)}</span>
                    <span>{`${row.last_name}, ${row.first_name}`}</span>
                    <span>{row.sex === 'Male' ? 'M' : row.sex === 'Female' ? 'F' : row.sex}</span>
                    <span>{calculateAge(row.birth_date)}</span>
                    <span>{formatDate(row.archived_at ?? row.created_at)}</span>
                    <span><button type="button" className="icon-btn danger" title="Archive" onClick={() => openConfirmArchive({ ...row, kind: 'patient' })}>&#8681;</button></span>
                  </div>
                ))}
                {!loading && filteredInactivePatients.length === 0 ? <p>No inactive patients found.</p> : null}
              </div>
            </div>
            <div className="records-footer">
              <span>Showing {inactivePaging.visibleStart}-{inactivePaging.visibleEnd} of {filteredInactivePatients.length} entries</span>
              {renderPaginationControls({
                paging: inactivePaging,
                rowsPerPage: inactiveRowsPerPage,
                setRowsPerPage: setInactiveRowsPerPage,
                setPage: setInactivePage,
                pageInput: inactivePageInput,
                setPageInput: setInactivePageInput,
              })}
            </div>
          </div>
        ) : null}

        {tab === 'requests' ? (
          <div className="records">
            <div className="records-header admin-records-header">
              <div>
                <div className="records-toolbar">
                  <div className="search-box">
                    <span className="search-icon" aria-hidden />
                    <input
                      type="text"
                      placeholder="Search by patient, email, or requester"
                      value={pendingSearchTerm}
                      onChange={(event) => {
                        setPendingSearchTerm(event.target.value)
                        setPendingPage(1)
                        setPendingPageInput('1')
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="records-table pending-requests-table">
              <div className="table-head">
                <span>Submitted</span>
                <span>Patient</span>
                <span>Email</span>
                <span>Sex / Age</span>
                <span>Requested By</span>
                <span>Type</span>
                <span>Action</span>
              </div>
              <div className="table-body">
                {pendingPaging.pageRows.map((row) => {
                  const isProcessing = pendingProcessingId === row.id
                  const isUpdate = row.request_source === 'patient_details_update'
                  return (
                    <div key={row.id} className="table-row">
                      <span>{formatDateTime(row.created_at)}</span>
                      <span>{`${row.last_name}, ${row.first_name}`}</span>
                      <span>{row.email || 'N/A'}</span>
                      <span>{`${row.sex === 'Male' ? 'M' : row.sex === 'Female' ? 'F' : row.sex} / ${calculateAge(row.birth_date)}`}</span>
                      <span>{row.requested_by_name || '-'}</span>
                      <span>
                        <span className={`request-type-badge${isUpdate ? ' update' : ' add'}`}>
                          {isUpdate ? 'Update Patient' : 'Add Patient'}
                        </span>
                      </span>
                      <span className="row-actions">
                        <button type="button" className="view" disabled={Boolean(pendingProcessingId)} onClick={() => openPendingRequestPreview(row)}>
                          Preview
                        </button>
                        <button type="button" className="icon-btn danger" disabled={Boolean(pendingProcessingId)} title="Decline request" onClick={() => { void declinePendingPatientRequest(row) }}>
                          {isProcessing ? '...' : 'X'}
                        </button>
                      </span>
                    </div>
                  )
                })}
                {!loading && filteredPendingPatientRequests.length === 0 ? <p>No pending patient requests found.</p> : null}
              </div>
            </div>
            <div className="records-footer">
              <span>Showing {pendingPaging.visibleStart}-{pendingPaging.visibleEnd} of {filteredPendingPatientRequests.length} entries</span>
              {renderPaginationControls({
                paging: pendingPaging,
                rowsPerPage: pendingRowsPerPage,
                setRowsPerPage: setPendingRowsPerPage,
                setPage: setPendingPage,
                pageInput: pendingPageInput,
                setPageInput: setPendingPageInput,
              })}
            </div>
          </div>
        ) : null}

        {tab === 'archive' ? (
          <div className="records archive-records">
            <div className="records-header admin-records-header">
              <div>
                <div className="records-toolbar">
                  <div className="search-box">
                    <span className="search-icon" aria-hidden />
                    <input
                      type="text"
                      placeholder="Search by Name"
                      value={archiveSearchTerm}
                      onChange={(event) => {
                        setArchiveSearchTerm(event.target.value)
                        setArchivePage(1)
                        setArchivePageInput('1')
                      }}
                    />
                  </div>
                </div>
              </div>
              <div className="records-actions">
                <button type="button" className={`ghost records-filter-toggle ${showArchiveFilters ? 'is-open' : ''}`} onClick={() => setShowArchiveFilters(true)}>Filters</button>
                <div className="sorter">
                  <label htmlFor="admin-archive-sort">Sort by:</label>
                  <select
                    id="admin-archive-sort"
                    value={archiveSortBy}
                    onChange={(event) => {
                      setArchiveSortBy(event.target.value)
                      setArchivePage(1)
                      setArchivePageInput('1')
                    }}
                  >
                    <option value="name">Name</option>
                    {archiveType === 'patients' ? <option value="patientId">Patient ID</option> : null}
                    {archiveType === 'users' ? <option value="staffId">Staff ID</option> : null}
                    <option value="archiveDate">Archive Date</option>
                  </select>
                  <button
                    type="button"
                    className="ghost sort-direction-btn"
                    aria-label={archiveCurrentSortDirectionLabel}
                    title={archiveCurrentSortDirectionLabel}
                    onClick={() => {
                      if (archiveSortBy === 'archiveDate') {
                        setArchiveDateSortDirection((previous) => (previous === 'asc' ? 'desc' : 'asc'))
                      } else if (archiveSortBy === 'patientId' || archiveSortBy === 'staffId') {
                        setArchiveIdSortDirection((previous) => (previous === 'asc' ? 'desc' : 'asc'))
                      } else {
                        setArchiveNameSortDirection((previous) => (previous === 'asc' ? 'desc' : 'asc'))
                      }
                      setArchivePage(1)
                      setArchivePageInput('1')
                    }}
                  >
                    <SortDirectionIcon
                      direction={
                        (archiveSortBy === 'archiveDate'
                          ? archiveDateSortDirection
                          : (archiveSortBy === 'patientId' || archiveSortBy === 'staffId')
                            ? archiveIdSortDirection
                            : archiveNameSortDirection)
                      }
                    />
                  </button>
                </div>
                <div className="sorter inline">
                  <label htmlFor="archive-type">Type:</label>
                  <select
                    id="archive-type"
                    value={archiveType}
                    onChange={(e) => {
                      const nextType = e.target.value
                      setArchiveType(nextType)
                      setArchiveSortBy(nextType === 'users' ? 'staffId' : nextType === 'patients' ? 'patientId' : 'name')
                      setArchivePage(1)
                      setArchivePageInput('1')
                    }}
                  >
                    <option value="patients">Patients</option>
                    <option value="users">Users</option>
                    <option value="services">Services</option>
                    <option value="dentalCondition">Dental Condition</option>
                  </select>
                </div>
              </div>
            </div>

            <div
              className={`records-table archive-table ${
                archiveType === 'users' ? 'archive-table-users' : ''
              } ${
                archiveType === 'services' ? 'archive-table-services' : ''
              } ${archiveType === 'dentalCondition' ? 'archive-table-dental' : ''}`}
            >
              <div className="table-head">
                {archiveType === 'services' ? (
                  <>
                    <span>Service</span>
                    <span>Archived date</span>
                    <span>Action</span>
                  </>
                ) : null}
                {archiveType === 'dentalCondition' ? (
                  <>
                    <span>Legend</span>
                    <span>Tooth Condition</span>
                    <span>Archived date</span>
                    <span>Action</span>
                  </>
                ) : null}
                {(archiveType === 'patients' || archiveType === 'users') ? (
                  <>
                    <span>{archiveType === 'patients' ? 'Patient ID' : 'Staff ID'}</span>
                    <span>Full Name</span>
                    <span>{archiveType === 'patients' ? 'Sex' : 'Username'}</span>
                    <span>{archiveType === 'patients' ? 'Age' : 'Role'}</span>
                    <span>Archive Date</span>
                    <span>Action</span>
                  </>
                ) : null}
              </div>
              <div className="table-body">
                {archivePaging.pageRows.map((row) => (
                  <div key={archiveType === 'users' ? row.user_id : row.id} className="table-row">
                    {archiveType === 'services' ? (
                      <>
                        <span>{row.service_name}</span>
                        <span>{formatDate(row.updated_at)}</span>
                        <span><button type="button" className="view" onClick={() => openConfirmRetrieve({ ...row, kind: 'services' })}>Retrieve</button></span>
                      </>
                    ) : null}
                    {archiveType === 'dentalCondition' ? (
                      <>
                        <span>{row.code}</span>
                        <span>{row.condition_name}</span>
                        <span>{formatDate(row.updated_at)}</span>
                        <span><button type="button" className="view" onClick={() => openConfirmRetrieve({ ...row, kind: 'dentalCondition' })}>Retrieve</button></span>
                      </>
                    ) : null}
                    {(archiveType === 'patients' || archiveType === 'users') ? (
                      <>
                        <span>{archiveType === 'patients' ? formatPatientCode(row.patient_code, row.id) : formatStaffCode(row.user_id)}</span>
                        <span>{archiveType === 'patients' ? `${row.last_name}, ${row.first_name}` : formatStaffDisplayName(row)}</span>
                        <span>{archiveType === 'patients' ? (row.sex === 'Male' ? 'M' : row.sex === 'Female' ? 'F' : row.sex) : row.username}</span>
                        <span>{archiveType === 'patients' ? calculateAge(row.birth_date) : (ROLE_LABELS[row.role] ?? row.role)}</span>
                        <span>{formatDate(archiveType === 'patients' ? row.archived_at : row.updated_at)}</span>
                        <span><button type="button" className="view" onClick={() => openConfirmRetrieve({ ...row, kind: archiveType })}>Retrieve</button></span>
                      </>
                    ) : null}
                  </div>
                ))}
                {!loading && filteredArchiveRows.length === 0 ? <p>No archived entries found.</p> : null}
              </div>
            </div>
            <div className="records-footer">
              <span>Showing {archivePaging.visibleStart}-{archivePaging.visibleEnd} of {filteredArchiveRows.length} entries</span>
              {renderPaginationControls({
                paging: archivePaging,
                rowsPerPage: archiveRowsPerPage,
                setRowsPerPage: setArchiveRowsPerPage,
                setPage: setArchivePage,
                pageInput: archivePageInput,
                setPageInput: setArchivePageInput,
              })}
            </div>
          </div>
        ) : null}

        {tab === 'audit' ? (
          <div className="records audit-trail-page">
            <div className="records-header admin-records-header audit-trail-header">
              <div>
                <div className="records-toolbar">
                  <div className="search-box audit-search-box">
                    <span className="search-icon" aria-hidden />
                    <input
                      type="text"
                      placeholder="Search logs by subject, actor, action, or details"
                      value={auditSearchTerm}
                      onChange={(event) => {
                        setAuditSearchTerm(event.target.value)
                        setAuditPage(1)
                        setAuditPageInput('1')
                      }}
                    />
                  </div>
                </div>
              </div>
              <div className="records-actions">
                <div className="sorter">
                  <label htmlFor="admin-audit-category">Category:</label>
                  <select
                    id="admin-audit-category"
                    className="audit-category-select"
                    value={auditCategoryFilter}
                    onChange={(event) => {
                      setAuditCategoryFilter(event.target.value)
                      setAuditPage(1)
                      setAuditPageInput('1')
                    }}
                  >
                    {AUDIT_CATEGORY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sorter">
                  <label htmlFor="admin-audit-sort">Sort by:</label>
                  <select id="admin-audit-sort" value="timestamp" onChange={() => {}}>
                    <option value="timestamp">Date &amp; Time</option>
                  </select>
                  <button
                    type="button"
                    className="ghost sort-direction-btn"
                    aria-label={auditSortDirection === 'asc' ? 'Oldest to newest' : 'Newest to oldest'}
                    title={auditSortDirection === 'asc' ? 'Oldest to newest' : 'Newest to oldest'}
                    onClick={() => {
                      setAuditSortDirection((previous) => (previous === 'asc' ? 'desc' : 'asc'))
                      setAuditPage(1)
                      setAuditPageInput('1')
                    }}
                  >
                    <SortDirectionIcon direction={auditSortDirection} />
                  </button>
                </div>
              </div>
            </div>

            <div className="audit-feed">
              <div className="audit-feed-list">
                {auditPaging.pageRows.map((row) => {
                  const categoryKey = getAuditCategoryKey(row)
                  const accentClass = getAuditAccentClass(categoryKey)

                  return (
                    <article key={row.id} className="audit-feed-item">
                      <div className={`audit-feed-icon ${accentClass}`} aria-hidden>{getAuditCategoryInitial(categoryKey)}</div>
                      <div className="audit-feed-content">
                        <div className="audit-feed-title-row">
                          <div className="audit-feed-heading">
                            <strong>{row.details && row.details !== '-' ? row.details : row.action}</strong>
                            <span className={`audit-feed-badge ${accentClass}`}>{categoryKey}</span>
                          </div>
                          <div className="audit-feed-time">
                            <strong>{formatDateTime(row.timestamp, row.details)}</strong>
                            <span>{row.action}</span>
                          </div>
                        </div>
                        <p className="audit-feed-subject">{row.subject}</p>
                        <p className="audit-feed-meta">
                          By {formatAuditActorLabel(row.actorName)} • {formatAuditSourceLabel(row.source)}
                        </p>
                      </div>
                    </article>
                  )
                })}
                {!loading && filteredAuditLogs.length === 0 ? (
                  <div className="audit-feed-empty">
                    <strong>No audit logs found.</strong>
                    <span>Try a different keyword or switch to another category.</span>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="records-footer">
              <span>Showing {auditPaging.visibleStart}-{auditPaging.visibleEnd} of {filteredAuditLogs.length} entries</span>
              {renderPaginationControls({
                paging: auditPaging,
                rowsPerPage: auditRowsPerPage,
                setRowsPerPage: setAuditRowsPerPage,
                setPage: setAuditPage,
                pageInput: auditPageInput,
                setPageInput: setAuditPageInput,
              })}
            </div>
          </div>
        ) : null}
      </section>

      {showUsersFilters ? <div className="modal-backdrop" onClick={() => setShowUsersFilters(false)} /> : null}
      {showUsersFilters ? (
        <div className="pr-modal procedures-modal admin-records-filter-modal">
          <div className="pr-modal-head">
            <h2>User Filters</h2>
            <button type="button" onClick={() => setShowUsersFilters(false)}>X</button>
          </div>
          <div className="pr-modal-body">
            <div className="records-filter-panel admin-records-filter-panel">
              <label className="inline-field" htmlFor="admin-filter-role">
                Role:
                <select id="admin-filter-role" value={usersRoleFilter} onChange={(event) => { setUsersRoleFilter(event.target.value); setUsersPage(1); setUsersPageInput('1') }}>
                  <option value="">All</option>
                  {ROLE_OPTIONS.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                </select>
              </label>
              <label className="inline-field" htmlFor="admin-filter-created-from">
                Date Created From:
                <FilterDateInput id="admin-filter-created-from" value={usersCreatedFromFilter} onChange={(nextValue) => { setUsersCreatedFromFilter(nextValue); setUsersPage(1); setUsersPageInput('1') }} />
              </label>
              <label className="inline-field" htmlFor="admin-filter-created-to">
                Date Created To:
                <FilterDateInput id="admin-filter-created-to" value={usersCreatedToFilter} onChange={(nextValue) => { setUsersCreatedToFilter(nextValue); setUsersPage(1); setUsersPageInput('1') }} />
              </label>
            </div>
            <div className="modal-actions admin-records-filter-actions">
              <button type="button" className="ghost records-filter-clear" onClick={clearUsersFilters} disabled={!hasUsersFilters}>Clear Filters</button>
              <button type="button" className="success-btn" onClick={() => setShowUsersFilters(false)}>Apply</button>
            </div>
          </div>
        </div>
      ) : null}

      {showInactiveFilters ? <div className="modal-backdrop" onClick={() => setShowInactiveFilters(false)} /> : null}
      {showInactiveFilters ? (
        <div className="pr-modal procedures-modal admin-records-filter-modal">
          <div className="pr-modal-head">
            <h2>Inactive Filters</h2>
            <button type="button" onClick={() => setShowInactiveFilters(false)}>X</button>
          </div>
          <div className="pr-modal-body">
            <div className="records-filter-panel admin-records-filter-panel">
              <label className="inline-field" htmlFor="admin-inactive-filter-sex">
                Sex:
                <select id="admin-inactive-filter-sex" value={inactiveSexFilter} onChange={(event) => { setInactiveSexFilter(event.target.value); setInactivePage(1); setInactivePageInput('1') }}>
                  <option value="">All</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
              </label>
              <label className="inline-field" htmlFor="admin-inactive-filter-min-age">
                Age Min:
                <input id="admin-inactive-filter-min-age" type="number" min="0" value={inactiveMinAgeFilter} onChange={(event) => { setInactiveMinAgeFilter(event.target.value); setInactivePage(1); setInactivePageInput('1') }} />
              </label>
              <label className="inline-field" htmlFor="admin-inactive-filter-max-age">
                Age Max:
                <input id="admin-inactive-filter-max-age" type="number" min="0" value={inactiveMaxAgeFilter} onChange={(event) => { setInactiveMaxAgeFilter(event.target.value); setInactivePage(1); setInactivePageInput('1') }} />
              </label>
              <label className="inline-field" htmlFor="admin-inactive-filter-date-from">
                Inactive Date From:
                <FilterDateInput id="admin-inactive-filter-date-from" value={inactiveDateFromFilter} onChange={(nextValue) => { setInactiveDateFromFilter(nextValue); setInactivePage(1); setInactivePageInput('1') }} />
              </label>
              <label className="inline-field" htmlFor="admin-inactive-filter-date-to">
                Inactive Date To:
                <FilterDateInput id="admin-inactive-filter-date-to" value={inactiveDateToFilter} onChange={(nextValue) => { setInactiveDateToFilter(nextValue); setInactivePage(1); setInactivePageInput('1') }} />
              </label>
            </div>
            <div className="modal-actions admin-records-filter-actions">
              <button type="button" className="ghost records-filter-clear" onClick={clearInactiveFilters} disabled={!hasInactiveFilters}>Clear Filters</button>
              <button type="button" className="success-btn" onClick={() => setShowInactiveFilters(false)}>Apply</button>
            </div>
          </div>
        </div>
      ) : null}

      {showArchiveFilters ? <div className="modal-backdrop" onClick={() => setShowArchiveFilters(false)} /> : null}
      {showArchiveFilters ? (
        <div className="pr-modal procedures-modal admin-records-filter-modal">
          <div className="pr-modal-head">
            <h2>Archive Filters</h2>
            <button type="button" onClick={() => setShowArchiveFilters(false)}>X</button>
          </div>
          <div className="pr-modal-body">
            <div className="records-filter-panel admin-records-filter-panel">
              {archiveType === 'patients' ? (
                <>
                  <label className="inline-field" htmlFor="admin-archive-filter-sex">
                    Sex:
                    <select id="admin-archive-filter-sex" value={archiveSexFilter} onChange={(event) => { setArchiveSexFilter(event.target.value); setArchivePage(1); setArchivePageInput('1') }}>
                      <option value="">All</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                    </select>
                  </label>
                  <label className="inline-field" htmlFor="admin-archive-filter-min-age">
                    Age Min:
                    <input id="admin-archive-filter-min-age" type="number" min="0" value={archiveMinAgeFilter} onChange={(event) => { setArchiveMinAgeFilter(event.target.value); setArchivePage(1); setArchivePageInput('1') }} />
                  </label>
                  <label className="inline-field" htmlFor="admin-archive-filter-max-age">
                    Age Max:
                    <input id="admin-archive-filter-max-age" type="number" min="0" value={archiveMaxAgeFilter} onChange={(event) => { setArchiveMaxAgeFilter(event.target.value); setArchivePage(1); setArchivePageInput('1') }} />
                  </label>
                </>
              ) : null}
              {archiveType === 'users' ? (
                <label className="inline-field" htmlFor="admin-archive-filter-role">
                  Role:
                  <select id="admin-archive-filter-role" value={archiveRoleFilter} onChange={(event) => { setArchiveRoleFilter(event.target.value); setArchivePage(1); setArchivePageInput('1') }}>
                    <option value="">All</option>
                    {ROLE_OPTIONS.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                  </select>
                </label>
              ) : null}
              <label className="inline-field" htmlFor="admin-archive-filter-date-from">
                Archive Date From:
                <FilterDateInput id="admin-archive-filter-date-from" value={archiveDateFromFilter} onChange={(nextValue) => { setArchiveDateFromFilter(nextValue); setArchivePage(1); setArchivePageInput('1') }} />
              </label>
              <label className="inline-field" htmlFor="admin-archive-filter-date-to">
                Archive Date To:
                <FilterDateInput id="admin-archive-filter-date-to" value={archiveDateToFilter} onChange={(nextValue) => { setArchiveDateToFilter(nextValue); setArchivePage(1); setArchivePageInput('1') }} />
              </label>
            </div>
            <div className="modal-actions admin-records-filter-actions">
              <button type="button" className="ghost records-filter-clear" onClick={clearArchiveFilters} disabled={!hasArchiveFilters}>Clear Filters</button>
              <button type="button" className="success-btn" onClick={() => setShowArchiveFilters(false)}>Apply</button>
            </div>
          </div>
        </div>
      ) : null}

      {modal ? <div className="modal-backdrop" onClick={closeModal} /> : null}

      {modal === 'edit-user' ? (
        <div className="pr-modal procedures-modal admin-user-modal">
          <div className="pr-modal-head">
            <h2>View or Update User</h2>
            <div className="admin-user-modal-head-actions">
              {!isEditingUser ? (
                <button type="button" className="icon-btn" title="Update" onClick={startUserEdit} aria-label="Edit user">
                  &#9998;
                </button>
              ) : null}
              <button type="button" onClick={closeModal}>X</button>
            </div>
          </div>
          <div className="pr-modal-body">
            <div className="history-top-grid">
                <label>Last Name<input className={isEditingUser ? 'is-editable' : ''} type="text" value={userForm.last_name} readOnly={!isEditingUser} onChange={(e) => setUserForm((p) => ({ ...p, last_name: formatLetterNameInput(e.target.value) }))} /></label>
              <label>First Name<input className={isEditingUser ? 'is-editable' : ''} type="text" value={userForm.first_name} readOnly={!isEditingUser} onChange={(e) => setUserForm((p) => ({ ...p, first_name: formatLetterNameInput(e.target.value) }))} /></label>
              <label>Middle Name<input className={isEditingUser ? 'is-editable' : ''} type="text" value={userForm.middle_name} readOnly={!isEditingUser} onChange={(e) => setUserForm((p) => ({ ...p, middle_name: formatLetterNameInput(e.target.value) }))} /></label>
              <label>Suffix<input className={isEditingUser ? 'is-editable' : ''} type="text" value={userForm.suffix} readOnly={!isEditingUser} onChange={(e) => setUserForm((p) => ({ ...p, suffix: toTitleCase(e.target.value) }))} /></label>
              <label>Email<input className={isEditingUser ? 'is-locked' : ''} type="email" value={userForm.email} readOnly onChange={(e) => setUserForm((p) => ({ ...p, email: e.target.value }))} /></label>
              <label>Username<input className={isEditingUser ? 'is-editable' : ''} type="text" value={userForm.username} readOnly={!isEditingUser} onChange={(e) => setUserForm((p) => ({ ...p, username: e.target.value }))} /></label>
              <label>Birthday<input className={isEditingUser ? 'is-editable' : ''} type={isEditingUser ? 'date' : 'text'} value={isEditingUser ? userForm.birth_date : formatDateOnly(userForm.birth_date)} readOnly={!isEditingUser} onChange={(e) => setUserForm((p) => ({ ...p, birth_date: e.target.value }))} /></label>
              <label>Age<input className={isEditingUser ? 'is-locked' : ''} type="text" value={calculateAge(userForm.birth_date)} readOnly /></label>
              <label className="span-2">Mobile Number<input className={isEditingUser ? 'is-editable' : ''} type="text" value={isEditingUser ? userForm.mobile_number : formatPhilippineMobileDisplay(userForm.mobile_number)} readOnly={!isEditingUser} onChange={(e) => setUserForm((p) => ({ ...p, mobile_number: e.target.value }))} /></label>
              <label className="span-2">Address<input className={isEditingUser ? 'is-editable' : ''} type="text" value={isEditingUser ? userForm.address : (userForm.address || '-')} readOnly={!isEditingUser} onChange={(e) => setUserForm((p) => ({ ...p, address: e.target.value }))} /></label>
              <label>Role<select className={isEditingUser ? 'is-editable' : ''} value={userForm.role} disabled={!isEditingUser} onChange={(e) => setUserForm((p) => ({ ...p, role: e.target.value }))}>{ROLE_OPTIONS.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label>
            </div>
            {isEditingUser ? (
              <div className="modal-actions admin-user-modal-actions">
                <button type="button" className="danger-btn" onClick={cancelUserEdit}>Cancel</button>
                <button type="button" className="success-btn" onClick={() => { void saveUserEdit() }}>Update</button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {modal === 'preview-patient-request' && selected ? (
        <div className="pr-modal procedures-modal admin-patient-request-modal">
          <div className="pr-modal-head">
            <h2>Patient Request Preview</h2>
            <button type="button" onClick={closeModal}>X</button>
          </div>
          <div className="pr-modal-body">
            {(() => {
              const payload = selected.payload && typeof selected.payload === 'object' && !Array.isArray(selected.payload)
                ? selected.payload
                : {}
              const isPatientUpdateRequest = selected.request_source === 'patient_details_update'
              const medicalAnswers = payload.medical_history?.answers || {}
              const medicalNotes = payload.medical_history?.notes || {}
              const dentalAnswers = payload.dental_history?.answers || {}
              const dentalNotes = payload.dental_history?.notes || {}
              const isMinor = Boolean(payload.guardian_name || payload.guardian_mobile_number || payload.guardian_occupation || payload.guardian_office_address)
              const changedFields = isPatientUpdateRequest
                ? PATIENT_UPDATE_COMPARE_FIELDS
                  .map(([field, label]) => {
                    if (!(field in payload)) return null
                    const oldValue = normalizePreviewCompareValue(field, patientUpdatePreviewBase?.[field])
                    const newValue = normalizePreviewCompareValue(field, payload?.[field])
                    return oldValue === newValue ? null : { field, label, oldValue, newValue }
                  })
                  .filter(Boolean)
                : []

              return (
                <div className="preview-shell admin-request-preview-shell">
                  <div className="preview-head">
                    <span className="preview-kicker">Review First</span>
                    <h2>{`${selected.last_name}, ${selected.first_name}`}</h2>
                    <p>{isPatientUpdateRequest ? 'Review the requested field changes before approving this patient update.' : 'Check the submitted patient details before approving this request.'}</p>
                  </div>

                  <div className="preview-grid">
                    {isPatientUpdateRequest ? (
                      <>
                        <article className="preview-card">
                          <h3>Request Details</h3>
                          <div className="preview-detail-grid">
                            <p><strong>Submitted</strong><span>{formatDateTime(selected.created_at)}</span></p>
                            <p><strong>Requested By</strong><span>{getDisplayValue(selected.requested_by_name, '-')}</span></p>
                            <p><strong>Patient</strong><span>{`${selected.last_name}, ${selected.first_name}`}</span></p>
                            <p><strong>Request Source</strong><span>{getDisplayValue(selected.request_source, 'patient_details_update')}</span></p>
                          </div>
                        </article>

                        <article className="preview-card preview-card-span-2">
                          <h3>Changed Fields</h3>
                          {patientUpdatePreviewLoading ? (
                            <p className="preview-empty-state">Loading current patient data...</p>
                          ) : changedFields.length > 0 ? (
                            <div className="update-request-compare-list">
                              {changedFields.map((entry) => (
                                <div key={entry.field} className="update-request-compare-row">
                                  <div className="update-request-compare-label">{entry.label}</div>
                                  <div className="update-request-compare-values">
                                    <div className="update-request-compare-old">
                                      <span className="update-request-compare-kicker">Old</span>
                                      <strong>{entry.oldValue}</strong>
                                    </div>
                                    <div className="update-request-compare-new">
                                      <span className="update-request-compare-kicker">New</span>
                                      <strong>{entry.newValue}</strong>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="preview-empty-state">No field differences were found for this update request.</p>
                          )}
                        </article>
                      </>
                    ) : (
                      <>
                        <article className="preview-card">
                          <h3>Patient Information</h3>
                          <div className="preview-detail-grid">
                            <p><strong>Submitted</strong><span>{formatDateTime(selected.created_at)}</span></p>
                            <p><strong>Requested By</strong><span>{getDisplayValue(selected.requested_by_name, '-')}</span></p>
                            <p><strong>Last Name</strong><span>{getDisplayValue(payload.last_name || selected.last_name)}</span></p>
                            <p><strong>First Name</strong><span>{getDisplayValue(payload.first_name || selected.first_name)}</span></p>
                            <p><strong>Middle Name</strong><span>{getDisplayValue(payload.middle_name)}</span></p>
                            <p><strong>Suffix</strong><span>{getDisplayValue(payload.suffix)}</span></p>
                            <p><strong>Birthdate</strong><span>{getDisplayValue(formatDateOnly(payload.birth_date || selected.birth_date))}</span></p>
                            <p><strong>Age</strong><span>{calculateAge(payload.birth_date || selected.birth_date)}</span></p>
                            <p><strong>Sex</strong><span>{getDisplayValue(payload.sex || selected.sex)}</span></p>
                            <p><strong>Nickname</strong><span>{getDisplayValue(payload.nickname)}</span></p>
                            <p><strong>Email</strong><span>{getDisplayValue(payload.email)}</span></p>
                            <p><strong>Civil Status</strong><span>{getDisplayValue(payload.civil_status)}</span></p>
                            <p><strong>Mobile Number</strong><span>{getDisplayValue(formatPhilippineMobileDisplay(payload.phone), 'N/A')}</span></p>
                            <p><strong>Occupation</strong><span>{getDisplayValue(payload.occupation)}</span></p>
                            <p className="preview-span-2"><strong>Current Address</strong><span>{getDisplayValue(payload.address)}</span></p>
                            <p className="preview-span-2"><strong>Office Address</strong><span>{getDisplayValue(payload.office_address)}</span></p>
                          </div>

                          {isMinor ? (
                            <div className="preview-subsection">
                              <h4>Guardian Details</h4>
                              <div className="preview-detail-grid">
                                <p><strong>Name</strong><span>{getDisplayValue(payload.guardian_name)}</span></p>
                                <p><strong>Mobile</strong><span>{getDisplayValue(formatPhilippineMobileDisplay(payload.guardian_mobile_number), 'N/A')}</span></p>
                                <p><strong>Occupation</strong><span>{getDisplayValue(payload.guardian_occupation)}</span></p>
                                <p className="preview-span-2"><strong>Office Address</strong><span>{getDisplayValue(payload.guardian_office_address)}</span></p>
                              </div>
                            </div>
                          ) : null}
                        </article>

                        <article className="preview-card">
                          <h3>Health Summary</h3>
                          <div className="preview-detail-grid">
                            <p className="preview-span-2"><strong>Health Conditions</strong><span>{summarizeHealthConditions(payload.health_conditions)}</span></p>
                            <p className="preview-span-2"><strong>Allergies</strong><span>{summarizeAllergens(payload.allergen_info)}</span></p>
                            <p><strong>Physician</strong><span>{getDisplayValue(payload.medical_history?.physician)}</span></p>
                            <p><strong>Specialty</strong><span>{getDisplayValue(payload.medical_history?.specialty)}</span></p>
                            <p className="preview-span-2"><strong>Physician Address</strong><span>{getDisplayValue(payload.medical_history?.address)}</span></p>
                            <p><strong>Authorization</strong><span>{payload.authorization_accepted ? 'Accepted' : 'Not accepted'}</span></p>
                            <p><strong>Request Source</strong><span>{getDisplayValue(selected.request_source, 'Add Patient Form')}</span></p>
                          </div>
                        </article>

                        <article className="preview-card">
                          <h3>Medical Questionnaire</h3>
                          <div className="preview-detail-grid">
                            {Object.keys(medicalAnswers).length > 0 ? Object.keys(medicalAnswers).map((key) => (
                              <p key={`medical-${key}`} className="preview-span-2">
                                <strong>{`Question ${Number(key) + 1}`}</strong>
                                <span>{formatHistoryAnswer(medicalAnswers[key], medicalNotes[key])}</span>
                              </p>
                            )) : (
                              <p className="preview-span-2"><strong>Status</strong><span>No medical answers recorded.</span></p>
                            )}
                          </div>
                        </article>

                        <article className="preview-card">
                          <h3>Dental History</h3>
                          <div className="preview-detail-grid">
                            <p><strong>Previous Dentist</strong><span>{getDisplayValue(payload.dental_history?.previous)}</span></p>
                            <p><strong>Last Exam</strong><span>{getDisplayValue(formatDateOnly(payload.dental_history?.lastExam))}</span></p>
                            <p className="preview-span-2"><strong>Consultation Reason</strong><span>{getDisplayValue(payload.dental_history?.reason)}</span></p>
                            {Object.keys(dentalAnswers).length > 0 ? Object.keys(dentalAnswers).map((key) => (
                              <p key={`dental-${key}`} className="preview-span-2">
                                <strong>{`Question ${Number(key) + 1}`}</strong>
                                <span>{formatHistoryAnswer(dentalAnswers[key], dentalNotes[key])}</span>
                              </p>
                            )) : (
                              <p className="preview-span-2"><strong>Status</strong><span>No dental answers recorded.</span></p>
                            )}
                          </div>
                        </article>
                      </>
                    )}
                  </div>

                  <div className="modal-actions">
                    <button type="button" className="ghost" onClick={closeModal} disabled={Boolean(pendingProcessingId)}>Close</button>
                    <button type="button" className="danger-btn" onClick={() => { void declinePendingPatientRequest(selected) }} disabled={Boolean(pendingProcessingId)}>
                      Decline
                    </button>
                    <button type="button" className="success-btn" onClick={() => { void approvePendingPatientRequest(selected) }} disabled={Boolean(pendingProcessingId)}>
                      {pendingProcessingId === selected.id ? 'Approving...' : 'Approve Request'}
                    </button>
                  </div>
                </div>
              )
            })()}
          </div>
        </div>
      ) : null}

      {pendingConfirmAction ? <div className="modal-backdrop" onClick={() => { if (!pendingProcessingId) setPendingConfirmAction(null) }} /> : null}
      {pendingConfirmAction ? (
        <div className="pr-modal procedures-modal archive-modal">
          <div className="pr-modal-head">
            <h2>{pendingConfirmAction.type === 'approve' ? 'Approve Request' : 'Decline Request'}</h2>
          </div>
          <div className="pr-modal-body">
            <p>
              {pendingConfirmAction.type === 'approve'
                ? `${pendingConfirmAction.request.request_source === 'patient_details_update' ? 'Approve patient update request' : 'Approve patient request'} for ${pendingConfirmAction.request.last_name}, ${pendingConfirmAction.request.first_name}?`
                : `Decline patient request for ${pendingConfirmAction.request.last_name}, ${pendingConfirmAction.request.first_name}?`}
            </p>
            <div className="modal-actions">
              <button type="button" className="ghost" disabled={Boolean(pendingProcessingId)} onClick={() => setPendingConfirmAction(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={pendingConfirmAction.type === 'approve' ? 'success-btn' : 'danger-btn'}
                disabled={Boolean(pendingProcessingId)}
                onClick={() => {
                  const action = pendingConfirmAction
                  setPendingConfirmAction(null)
                  if (action.type === 'approve') {
                    void _executeApprovePendingPatientRequest(action.request)
                  } else {
                    void _executeDeclinePendingPatientRequest(action.request)
                  }
                }}
              >
                {pendingProcessingId ? 'Processing...' : pendingConfirmAction.type === 'approve' ? 'Approve' : 'Decline'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {modal === 'confirm-archive' ? (
        <div className="pr-modal procedures-modal archive-modal">
          <div className="pr-modal-head"><h2>Archive</h2></div>
          <div className="pr-modal-body">
            <p>
              {selected?.kind === 'user'
                ? 'Are you sure you want to archive this user?'
                : 'Are you sure you want to archive this patient?'}
            </p>
            <div className="modal-actions">
              <button type="button" className="danger-btn" onClick={closeModal}>No</button>
              <button type="button" className="success-btn" onClick={() => { void confirmArchive() }}>Yes</button>
            </div>
          </div>
        </div>
      ) : null}

      {modal === 'confirm-retrieve' ? (
        <div className="pr-modal procedures-modal archive-modal">
          <div className="pr-modal-head"><h2>Retrieve</h2></div>
          <div className="pr-modal-body">
            <p>
              {archiveType === 'patients'
                ? 'Are you sure you want to retrieve this patient?'
                : archiveType === 'users'
                  ? 'Are you sure you want to retrieve this user?'
                  : archiveType === 'services'
                    ? 'Are you sure you want to retrieve this service?'
                    : 'Are you sure you want to retrieve this dental condition?'}
            </p>
            <div className="modal-actions">
              <button type="button" className="danger-btn" onClick={closeModal}>No</button>
              <button type="button" className="success-btn" onClick={() => { void confirmRetrieve() }}>Yes</button>
            </div>
          </div>
        </div>
      ) : null}


      {modal === 'success' ? (
        <div className="pr-modal procedures-modal success-modal">
          <div className="pr-modal-head"><h2>&nbsp;</h2></div>
          <div className="pr-modal-body">
            <p>{successMessage}</p>
            <div className="modal-actions center">
              <button type="button" className="success-btn" onClick={closeModal}>Done</button>
            </div>
          </div>
        </div>
      ) : null}

      {modal === 'add-user-validation' ? (
        <div className="pr-modal procedures-modal procedures-error-modal add-user-validation-modal">
          <div className="pr-modal-head"><h2>Notice</h2></div>
          <div className="pr-modal-body">
            <p>{addUserValidationMessage || 'Please fill out required fields.'}</p>
            <div className="modal-actions center">
              <button type="button" className="success-btn" onClick={closeModal}>OK</button>
            </div>
          </div>
        </div>
      ) : null}

    </>
  )
}

export default Admin
