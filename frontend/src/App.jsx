import { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import './App.css'
import Sidebar from './components/Sidebar'
import Login from './pages/Login'
import Home from './pages/Home'
import PatientRecords from './pages/PatientRecords'
import PatientRecordDetails from './pages/PatientRecordDetails'
import AddPatient from './pages/AddPatient'
import Procedures from './pages/Procedures'
import PatientLogs from './pages/PatientLogs'
import Admin from './pages/Admin'
import AdminImport from './pages/AdminImport'
import ResetPassword from './pages/ResetPassword'
import Settings from './pages/Settings'
import useSessionStorageState, { UI_SESSION_STORAGE_PREFIX, clearSessionStorageByPrefix } from './hooks/useSessionStorageState'
import { isAccessTokenExpired, missingSupabaseEnv, supabase } from './lib/supabaseClient'
import dentalLogo from './assets/DENTAL LOGO.png'

const ADD_PATIENT_DRAFT_KEY = 'dent22.addPatientDraft.v1'
const LAST_PROTECTED_ROUTE_KEY = 'dent22.lastProtectedRoute'
const APP_UI_STORAGE_PREFIX = `${UI_SESSION_STORAGE_PREFIX}app.`
const PLACEHOLDER_EMAIL_DOMAINS = ['@smilesdentalhub.local', '@dent22.local']
const BACKEND_STARTING_ERROR = 'BACKEND_STARTING_ERROR'
const INACTIVITY_LOGOUT_MS = 15 * 60 * 1000
const LOGIN_TRANSITION_MIN_MS = 1800

const sleep = (ms) => new Promise((resolve) => {
  window.setTimeout(resolve, ms)
})

function AppLoadingScreen({ label = 'Loading...' }) {
  return (
    <div className="app-loading app-loading-screen" aria-live="polite" aria-busy="true">
      <div className="app-loading-card">
        <p className="app-loading-label">{label}</p>
        <div className="app-loading-logo-shell">
          <div className="app-loading-logo-ring" aria-hidden="true" />
          <img className="app-loading-logo" src={dentalLogo} alt="Smiles Dental Hub" />
        </div>
      </div>
    </div>
  )
}

const waitForBackendReady = async ({ attempts = 6, delayMs = 500 } = {}) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`/api/health?ts=${Date.now()}`, {
        cache: 'no-store',
      })
      if (response.ok) return true
    } catch {
      // Ignore transient startup errors and keep polling until the backend responds.
    }

    if (attempt < attempts - 1) {
      await sleep(delayMs)
    }
  }

  return false
}

const fetchJsonWithBackendRetry = async (
  input,
  init,
  {
    readinessAttempts = 6,
    readinessDelayMs = 500,
    retryCount = 1,
    retryDelayMs = 350,
  } = {},
) => {
  const isBackendReady = await waitForBackendReady({
    attempts: readinessAttempts,
    delayMs: readinessDelayMs,
  })

  if (!isBackendReady) {
    const error = new Error('Backend is still starting.')
    error.code = BACKEND_STARTING_ERROR
    throw error
  }

  let lastError = null

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      const response = await fetch(input, init)
      const payload = await response.json().catch(() => ({}))
      return { response, payload }
    } catch (error) {
      lastError = error
      if (attempt < retryCount) {
        await sleep(retryDelayMs)
      }
    }
  }

  throw lastError
}

const isPlaceholderStaffEmail = (email = '') => {
  const normalized = `${email || ''}`.trim().toLowerCase()
  return PLACEHOLDER_EMAIL_DOMAINS.some((domain) => normalized.endsWith(domain))
}

const requiresStaffOnboarding = (profile) => {
  if (!profile?.is_active) return false
  return (
    isPlaceholderStaffEmail(profile?.email) ||
    !`${profile?.birth_date || ''}`.trim() ||
    !`${profile?.mobile_number || ''}`.trim() ||
    !`${profile?.address || ''}`.trim()
  )
}

const calculateAgeFromDate = (birthDate) => {
  if (!birthDate) return -1
  const dob = new Date(birthDate)
  if (Number.isNaN(dob.getTime())) return -1
  const now = new Date()
  let age = now.getFullYear() - dob.getFullYear()
  const monthDelta = now.getMonth() - dob.getMonth()
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < dob.getDate())) age -= 1
  return age
}

const normalizePhilippineMobile = (value = '') => `${value}`.replace(/\D/g, '').slice(0, 10)

const toPhilippineLocalMobileInput = (value = '') => {
  const digits = `${value || ''}`.replace(/\D/g, '')
  if (digits.startsWith('63') && digits.length >= 12) return digits.slice(2, 12)
  if (digits.startsWith('0') && digits.length >= 11) return digits.slice(1, 11)
  return digits.slice(0, 10)
}

const getAdultBirthDateMax = () => {
  const date = new Date()
  date.setFullYear(date.getFullYear() - 18)
  return date.toISOString().split('T')[0]
}

function LoginRoute({
  onLogin,
  form,
  error,
  onErrorClose,
  logoutNotice,
  onLogoutNoticeClose,
  isLoggingIn,
  showPassword,
  onChange,
  onTogglePassword,
  forgotUsername,
  forgotCode,
  forgotNewPassword,
  forgotConfirmPassword,
  forgotStep,
  forgotError,
  forgotSuccess,
  isVerifyingCode,
  isSendingReset,
  isResendingForgotCode,
  isResettingPassword,
  onForgotUsernameChange,
  onForgotCodeChange,
  onForgotNewPasswordChange,
  onForgotConfirmPasswordChange,
  onForgotSubmit,
  onForgotResendCode,
  onForgotVerifyCode,
  onForgotResetPassword,
  onForgotClose,
}) {
  return (
    <Login
      form={form}
      error={error}
      onErrorClose={onErrorClose}
      logoutNotice={logoutNotice}
      onLogoutNoticeClose={onLogoutNoticeClose}
      isLoggingIn={isLoggingIn}
      showPassword={showPassword}
      onChange={onChange}
      onSubmit={onLogin}
      onTogglePassword={onTogglePassword}
      forgotUsername={forgotUsername}
      forgotCode={forgotCode}
      forgotNewPassword={forgotNewPassword}
      forgotConfirmPassword={forgotConfirmPassword}
      forgotStep={forgotStep}
      forgotError={forgotError}
      forgotSuccess={forgotSuccess}
      isVerifyingCode={isVerifyingCode}
      isSendingReset={isSendingReset}
      isResendingForgotCode={isResendingForgotCode}
      isResettingPassword={isResettingPassword}
      onForgotUsernameChange={onForgotUsernameChange}
      onForgotCodeChange={onForgotCodeChange}
      onForgotNewPasswordChange={onForgotNewPasswordChange}
      onForgotConfirmPasswordChange={onForgotConfirmPasswordChange}
      onForgotSubmit={onForgotSubmit}
      onForgotResendCode={onForgotResendCode}
      onForgotVerifyCode={onForgotVerifyCode}
      onForgotResetPassword={onForgotResetPassword}
      onForgotClose={onForgotClose}
    />
  )
}

function ProtectedLayout({ onLogout, navItems, role, profile, sessionUser, onProfileChange, isLogoutModalOpen }) {
  const location = useLocation()
  const isPatientRecordsRoute = location.pathname === '/records'

  return (
    <div className="dashboard">
      <Sidebar onLogout={onLogout} navItems={navItems} isLogoutModalOpen={isLogoutModalOpen} />
      <main className={`dashboard-main ${isPatientRecordsRoute ? 'dashboard-main-no-scroll' : ''}`}>
        <Routes>
          <Route path="home" element={<Home currentProfile={profile} />} />
          <Route path="records" element={<PatientRecords />} />
          <Route path="records/:id" element={<PatientRecordDetails currentRole={role} currentProfile={profile} />} />
          <Route path="add-patient" element={<AddPatient />} />
          <Route path="procedure" element={<Procedures currentProfile={profile} />} />
          <Route path="logs" element={<PatientLogs />} />
          <Route path="settings" element={<Settings currentProfile={profile} currentSessionUser={sessionUser} onProfileChange={onProfileChange} />} />
          {role === 'admin' ? <Route path="admin" element={<Admin currentProfile={profile} />} /> : <Route path="admin" element={<Navigate to="/home" replace />} />}
          {role === 'admin' ? <Route path="admin/import" element={<AdminImport />} /> : <Route path="admin/import" element={<Navigate to="/home" replace />} />}
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </main>
    </div>
  )
}

function AppRoutes() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [navItems, setNavItems] = useState([])
  const [isBootstrapping, setIsBootstrapping] = useState(() => Boolean(supabase))
  const [isLoginTransitioning, setIsLoginTransitioning] = useState(false)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [error, setError] = useState('')
  const [logoutNotice, setLogoutNotice] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [form, setForm] = useState({ username: '', password: '' })
  const [forgotUsername, setForgotUsername] = useState('')
  const [forgotCode, setForgotCode] = useState('')
  const [forgotNewPassword, setForgotNewPassword] = useState('')
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState('')
  const [forgotStep, setForgotStep] = useState('request')
  const [forgotError, setForgotError] = useState('')
  const [forgotSuccess, setForgotSuccess] = useState('')
  const [isVerifyingCode, setIsVerifyingCode] = useState(false)
  const [isSendingReset, setIsSendingReset] = useState(false)
  const [isResendingForgotCode, setIsResendingForgotCode] = useState(false)
  const [isResettingPassword, setIsResettingPassword] = useState(false)
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useSessionStorageState(`${APP_UI_STORAGE_PREFIX}logoutModalOpen`, false)
  const [staffOnboardingStep, setStaffOnboardingStep] = useSessionStorageState(`${APP_UI_STORAGE_PREFIX}staffOnboardingStep`, 'details')
  const [staffOnboardingForm, setStaffOnboardingForm] = useState({
    email: '',
    birthDate: '',
    mobileNumber: '',
    address: '',
  })
  const [pendingStaffOnboarding, setPendingStaffOnboarding] = useState(null)
  const [staffOnboardingCode, setStaffOnboardingCode] = useState('')
  const [staffOnboardingError, setStaffOnboardingError] = useState('')
  const [staffOnboardingInfo, setStaffOnboardingInfo] = useState('')
  const [staffOnboardingFieldErrors, setStaffOnboardingFieldErrors] = useState({})
  const [isStaffOnboardingSubmitting, setIsStaffOnboardingSubmitting] = useState(false)
  const [isStaffOnboardingVerifying, setIsStaffOnboardingVerifying] = useState(false)
  const [isStaffOnboardingResending, setIsStaffOnboardingResending] = useState(false)
  const profileUserIdRef = useRef(null)
  const onboardingUserIdRef = useRef(null)
  const inactivityTimerRef = useRef(null)
  const loginTransitionStartedAtRef = useRef(0)
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    const path = `${location.pathname || ''}${location.search || ''}${location.hash || ''}`
    if (!path || path === '/login' || path === '/reset-password') return
  }, [location.hash, location.pathname, location.search])

  const loadAccessContext = useCallback(async (userId) => {
    if (!supabase) return false

    const { data: profileData, error: profileError } = await supabase
      .from('staff_profiles')
      .select('user_id, full_name, first_name, middle_name, last_name, suffix, birth_date, mobile_number, address, username, email, role, is_active')
      .eq('user_id', userId)
      .maybeSingle()

    if (profileError || !profileData || !profileData.is_active) {
      profileUserIdRef.current = null
      setProfile(null)
      setNavItems([])
      setError('Account is not provisioned for system access.')
      return false
    }

    const { data: navigationData, error: navigationError } = await supabase.rpc('allowed_navigation')
    if (navigationError) {
      profileUserIdRef.current = null
      setProfile(null)
      setNavItems([])
      setError('Unable to load role navigation.')
      return false
    }

    profileUserIdRef.current = profileData.user_id
    setProfile(profileData)
    setNavItems((navigationData ?? []).map((row) => ({
      id: row.item_key,
      label: row.item_key === 'settings' ? 'Profile' : row.label,
      path: row.path,
    })))
    setLogoutNotice('')
    setError('')
    return true
  }, [])

  const signOutAndRedirect = useCallback(async ({ message = '', redirectPath = '/login' } = {}) => {
    if (!supabase) return

    if (inactivityTimerRef.current) {
      window.clearTimeout(inactivityTimerRef.current)
      inactivityTimerRef.current = null
    }

    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) {
      setError(signOutError.message || message || 'Unable to log out right now.')
      return
    }

    setProfile(null)
    setNavItems([])
    setForm({ username: '', password: '' })
    setShowPassword(false)
    setSession(null)
    setStaffOnboardingStep('details')
    setPendingStaffOnboarding(null)
    setStaffOnboardingCode('')
    setStaffOnboardingError('')
    setStaffOnboardingInfo('')
    setIsStaffOnboardingResending(false)
    setIsLogoutModalOpen(false)
    clearSessionStorageByPrefix(UI_SESSION_STORAGE_PREFIX)
    sessionStorage.removeItem(ADD_PATIENT_DRAFT_KEY)
    setLogoutNotice(message)
    setError('')
    navigate(redirectPath, { replace: true })
  }, [navigate])

  useEffect(() => {
    if (!supabase) return undefined

    let isMounted = true

    const clearAuthState = () => {
      profileUserIdRef.current = null
      setSession(null)
      setProfile(null)
      setNavItems([])
      setForm({ username: '', password: '' })
      setIsLoggingIn(false)
      setShowPassword(false)
      setForgotUsername('')
      setForgotCode('')
      setForgotNewPassword('')
      setForgotConfirmPassword('')
      setForgotStep('request')
      setForgotError('')
      setForgotSuccess('')
      setIsVerifyingCode(false)
      setIsSendingReset(false)
      setIsResendingForgotCode(false)
      setIsResettingPassword(false)
      setIsLogoutModalOpen(false)
      clearSessionStorageByPrefix(UI_SESSION_STORAGE_PREFIX)
      sessionStorage.removeItem(ADD_PATIENT_DRAFT_KEY)
    }

    const syncSession = async (
      nextSession,
      options = { showLoading: false, forceContextRefresh: false },
    ) => {
      if (!isMounted) return
      const { showLoading, forceContextRefresh } = options

      if (showLoading) setIsBootstrapping(true)

      if (!nextSession) {
        clearAuthState()
        if (isMounted) setIsBootstrapping(false)
        return
      }

      setSession(nextSession)

      const userId = nextSession.user.id
      const shouldRefreshAccessContext = forceContextRefresh || profileUserIdRef.current !== userId

      if (shouldRefreshAccessContext) {
        const hasAccess = await loadAccessContext(userId)
        if (!hasAccess) {
          if (showLoading && isMounted) setIsBootstrapping(false)
          if (isMounted) setIsLoginTransitioning(false)
          clearAuthState()
          setError('Account is not provisioned for system access.')
          await supabase.auth.signOut()
          return
        }
      }

      if (isMounted && showLoading) {
        setIsBootstrapping(false)
      }
      if (isMounted) {
        const elapsed = Date.now() - loginTransitionStartedAtRef.current
        if (loginTransitionStartedAtRef.current && elapsed < LOGIN_TRANSITION_MIN_MS) {
          await sleep(LOGIN_TRANSITION_MIN_MS - elapsed)
        }
        setIsLoginTransitioning(false)
        loginTransitionStartedAtRef.current = 0
      }
    }

    const initializeSession = async () => {
      const { data, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) {
        setError('Unable to initialize session.')
        setIsBootstrapping(false)
        return
      }
      await syncSession(data.session, { showLoading: true, forceContextRefresh: true })
    }

    void initializeSession()

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!isMounted) return

      if (event === 'INITIAL_SESSION') return

      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        setSession(nextSession)
        return
      }

      void syncSession(nextSession, {
        showLoading: false,
        forceContextRefresh: event === 'SIGNED_IN',
      })
    })

    return () => {
      isMounted = false
      listener.subscription.unsubscribe()
    }
  }, [loadAccessContext])

  useEffect(() => {
    if (!supabase || !session) return undefined

    let isMounted = true

    const validateSessionToken = async () => {
      const { data, error: sessionError } = await supabase.auth.getSession()

      if (!isMounted) return

      if (sessionError) {
        setError('Session validation failed. Please login again.')
        await signOutAndRedirect({ message: 'Session validation failed. Please login again.' })
        return
      }

      const accessToken = data.session?.access_token
      if (!data.session || !accessToken || isAccessTokenExpired(accessToken)) {
        await signOutAndRedirect({ message: 'Session token expired. Please login again.' })
      }
    }
    const tokenCheckTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void validateSessionToken()
      }
    }, 60000)

    return () => {
      isMounted = false
      window.clearInterval(tokenCheckTimer)
    }
  }, [session, signOutAndRedirect])

  useEffect(() => {
    if (!supabase || !session) return undefined

    const activityEvents = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click']

    const resetInactivityTimer = () => {
      if (inactivityTimerRef.current) {
        window.clearTimeout(inactivityTimerRef.current)
      }

      inactivityTimerRef.current = window.setTimeout(() => {
        void signOutAndRedirect({
          message: 'You were logged out after 15 minutes of inactivity.',
        })
      }, INACTIVITY_LOGOUT_MS)
    }

    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, resetInactivityTimer, { passive: true })
    })
    resetInactivityTimer()

    return () => {
      if (inactivityTimerRef.current) {
        window.clearTimeout(inactivityTimerRef.current)
        inactivityTimerRef.current = null
      }
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, resetInactivityTimer)
      })
    }
  }, [session, signOutAndRedirect])

  useEffect(() => {
    if (!profile) return

    const profileUserId = profile?.user_id || null
    const isSameOnboardingUser = onboardingUserIdRef.current === profileUserId
    const onboardingSource = isSameOnboardingUser && pendingStaffOnboarding
      ? pendingStaffOnboarding
      : {
          email: isPlaceholderStaffEmail(profile?.email) ? '' : `${profile?.email || ''}`.trim(),
          birthDate: profile?.birth_date || '',
          mobileNumber: toPhilippineLocalMobileInput(profile?.mobile_number || ''),
          address: profile?.address || '',
        }

    setStaffOnboardingForm({
      email: onboardingSource.email,
      birthDate: onboardingSource.birthDate,
      mobileNumber: onboardingSource.mobileNumber,
      address: onboardingSource.address,
    })

    if (!isSameOnboardingUser) {
      setStaffOnboardingStep('details')
      setPendingStaffOnboarding(null)
      setStaffOnboardingCode('')
      setStaffOnboardingError('')
      setStaffOnboardingInfo('')
      setStaffOnboardingFieldErrors({})
    }

    onboardingUserIdRef.current = profileUserId
  }, [pendingStaffOnboarding, profile])

  const handleStaffOnboardingFieldChange = (event) => {
    const { name, value } = event.target
    setStaffOnboardingForm((previous) => ({
      ...previous,
      [name]: name === 'mobileNumber' ? normalizePhilippineMobile(value) : value,
    }))
    setStaffOnboardingFieldErrors((previous) => {
      if (!previous[name]) return previous
      const next = { ...previous }
      delete next[name]
      return next
    })
    setStaffOnboardingError('')
    setStaffOnboardingInfo('')
  }

  const handleStaffOnboardingCodeChange = (event) => {
    setStaffOnboardingCode(event.target.value)
    setStaffOnboardingError('')
    setStaffOnboardingInfo('')
  }

  const handleStaffOnboardingSubmit = async (event) => {
    event.preventDefault()
    if (!supabase || !session?.user?.id) return

    const email = staffOnboardingForm.email.trim().toLowerCase()
    const birthDate = staffOnboardingForm.birthDate
    const mobileNumber = normalizePhilippineMobile(staffOnboardingForm.mobileNumber)
    const address = staffOnboardingForm.address.trim()
    const nextFieldErrors = {
      email: !email,
      birthDate: !birthDate,
      mobileNumber: !mobileNumber,
      address: !address,
    }

    if (!email || !birthDate || !mobileNumber || !address) {
      setStaffOnboardingFieldErrors(nextFieldErrors)
      setStaffOnboardingError('Please complete all required details.')
      return
    }

    setStaffOnboardingFieldErrors({})

    if (calculateAgeFromDate(birthDate) < 18) {
      setStaffOnboardingError('You must be at least 18 years old.')
      return
    }
    if (!/^9\d{9}$/.test(mobileNumber)) {
      setStaffOnboardingError('Enter a valid Philippine mobile number after +63, like 9762911478.')
      return
    }

    setIsStaffOnboardingSubmitting(true)
    setStaffOnboardingError('')
    setStaffOnboardingInfo('')

    try {
      const { data, error: sessionError } = await supabase.auth.getSession()
      const accessToken = data?.session?.access_token || ''
      if (sessionError || !accessToken) {
        setStaffOnboardingError('Your session expired. Please log in again.')
        setIsStaffOnboardingSubmitting(false)
        return
      }

      const { response, payload } = await fetchJsonWithBackendRetry('/api/auth/start-staff-onboarding', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          email,
          birthDate,
          mobileNumber: `+63${mobileNumber}`,
          address,
        }),
      })
      if (!response.ok) {
        setStaffOnboardingError(payload?.error || 'Unable to start profile verification.')
        setIsStaffOnboardingSubmitting(false)
        return
      }

      const pendingDetails = {
        email: `${payload?.email || email}`.trim().toLowerCase(),
        birthDate,
        mobileNumber,
        address,
      }

      setPendingStaffOnboarding(pendingDetails)
      setStaffOnboardingStep('verify')
      setStaffOnboardingCode('')
      setStaffOnboardingInfo(`Verification code sent to ${pendingDetails.email}.`)
      setIsStaffOnboardingSubmitting(false)
    } catch (requestError) {
      setStaffOnboardingError(
        requestError?.code === BACKEND_STARTING_ERROR
          ? 'System is still starting. Please wait a moment and try again.'
          : 'Unable to start profile verification.',
      )
      setIsStaffOnboardingSubmitting(false)
    }
  }

  const handleStaffOnboardingResend = async () => {
    if (!supabase || !session?.user?.id) return

    const email = pendingStaffOnboarding?.email?.trim().toLowerCase() || ''
    const birthDate = pendingStaffOnboarding?.birthDate || ''
    const mobileNumber = normalizePhilippineMobile(pendingStaffOnboarding?.mobileNumber || '')
    const address = pendingStaffOnboarding?.address?.trim() || ''

    if (!email || !birthDate || !mobileNumber || !address) {
      setStaffOnboardingError('Please complete all required details before requesting a new code.')
      setStaffOnboardingInfo('')
      return
    }

    setIsStaffOnboardingResending(true)
    setStaffOnboardingError('')
    setStaffOnboardingInfo('')

    try {
      const { data, error: sessionError } = await supabase.auth.getSession()
      const accessToken = data?.session?.access_token || ''
      if (sessionError || !accessToken) {
        setStaffOnboardingError('Your session expired. Please log in again.')
        setIsStaffOnboardingResending(false)
        return
      }

      const { response, payload } = await fetchJsonWithBackendRetry('/api/auth/start-staff-onboarding', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          email,
          birthDate,
          mobileNumber: `+63${mobileNumber}`,
          address,
        }),
      })
      if (!response.ok) {
        setStaffOnboardingError(payload?.error || 'Unable to resend verification code.')
        setIsStaffOnboardingResending(false)
        return
      }

      const pendingDetails = {
        email: `${payload?.email || email}`.trim().toLowerCase(),
        birthDate,
        mobileNumber,
        address,
      }

      setPendingStaffOnboarding(pendingDetails)
      setStaffOnboardingCode('')
      setStaffOnboardingInfo(`A new verification code was sent to ${pendingDetails.email}.`)
      setIsStaffOnboardingResending(false)
    } catch (requestError) {
      setStaffOnboardingError(
        requestError?.code === BACKEND_STARTING_ERROR
          ? 'System is still starting. Please wait a moment and try again.'
          : 'Unable to resend verification code.',
      )
      setIsStaffOnboardingResending(false)
    }
  }

  const handleStaffOnboardingVerify = async (event) => {
    event.preventDefault()
    if (!supabase || !session?.user?.id) return

    const code = staffOnboardingCode.trim()
    const email = pendingStaffOnboarding?.email?.trim().toLowerCase() || ''

    if (!code) {
      setStaffOnboardingError('Please enter the verification code sent to your email.')
      return
    }

    if (!email) {
      setStaffOnboardingError('Your verification session expired. Please request a new code.')
      return
    }

    setIsStaffOnboardingVerifying(true)
    setStaffOnboardingError('')
    setStaffOnboardingInfo('')

    try {
      const { data, error: sessionError } = await supabase.auth.getSession()
      const accessToken = data?.session?.access_token || ''
      if (sessionError || !accessToken) {
        setStaffOnboardingError('Your session expired. Please log in again.')
        setIsStaffOnboardingVerifying(false)
        return
      }

      const { response, payload } = await fetchJsonWithBackendRetry('/api/auth/verify-staff-onboarding', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          email,
          code,
        }),
      })
      if (!response.ok) {
        setStaffOnboardingError(payload?.error || 'Unable to verify onboarding code.')
        setIsStaffOnboardingVerifying(false)
        return
      }

      await loadAccessContext(session.user.id)
      setStaffOnboardingStep('details')
      setPendingStaffOnboarding(null)
      setStaffOnboardingCode('')
      setStaffOnboardingInfo('')
      setIsStaffOnboardingVerifying(false)
    } catch (requestError) {
      setStaffOnboardingError(
        requestError?.code === BACKEND_STARTING_ERROR
          ? 'System is still starting. Please wait a moment and try again.'
          : 'Unable to verify onboarding code.',
      )
      setIsStaffOnboardingVerifying(false)
    }
  }

  const handleChange = (event) => {
    const { name, value } = event.target
    setForm((prev) => ({ ...prev, [name]: value }))
    setError('')
  }

  const handleForgotUsernameChange = (event) => {
    setForgotUsername(event.target.value)
    setForgotError('')
    setForgotSuccess('')
  }

  const handleForgotCodeChange = (event) => {
    const nextValue = `${event.target.value || ''}`.replace(/\D/g, '').slice(0, 6)
    setForgotCode(nextValue)
    setForgotError('')
    setForgotSuccess('')
  }

  const handleForgotNewPasswordChange = (event) => {
    setForgotNewPassword(event.target.value)
    setForgotError('')
    setForgotSuccess('')
  }

  const handleForgotConfirmPasswordChange = (event) => {
    setForgotConfirmPassword(event.target.value)
    setForgotError('')
    setForgotSuccess('')
  }

  const handleForgotClose = () => {
    setForgotUsername('')
    setForgotCode('')
    setForgotNewPassword('')
    setForgotConfirmPassword('')
    setForgotStep('request')
    setForgotError('')
    setForgotSuccess('')
    setIsVerifyingCode(false)
    setIsSendingReset(false)
    setIsResendingForgotCode(false)
    setIsResettingPassword(false)
  }

  const requestForgotCode = async ({ showResendMessage = false } = {}) => {
    const email = forgotUsername.trim().toLowerCase()
    if (!email) {
      setForgotError('Please enter your email.')
      setForgotSuccess('')
      return false
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setForgotError('Please enter a valid email address.')
      setForgotSuccess('')
      return false
    }

    if (showResendMessage) {
      setIsResendingForgotCode(true)
    } else {
      setIsSendingReset(true)
    }
    setForgotError('')
    setForgotSuccess('')

    try {
      const { response, payload } = await fetchJsonWithBackendRetry('/api/auth/forgot-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          login: email,
        }),
      })
      if (!response.ok) {
        setForgotError(payload?.error || 'Unable to send reset email. Please try again.')
        if (showResendMessage) {
          setIsResendingForgotCode(false)
        } else {
          setIsSendingReset(false)
        }
        return false
      }

      setForgotUsername(payload?.email || email)
      setForgotCode('')
      setForgotStep('verify')
      setForgotSuccess(
        showResendMessage
          ? `A new verification code was sent to ${payload?.email || email}. Check your email inbox for the latest code.`
          : `Verification code sent to ${payload?.email || email}. Check your email inbox for the latest code.`,
      )
      if (showResendMessage) {
        setIsResendingForgotCode(false)
      } else {
        setIsSendingReset(false)
      }
      return true
    } catch (requestError) {
      setForgotError(
        requestError?.code === BACKEND_STARTING_ERROR
          ? 'System is still starting. Please wait a moment and try again.'
          : 'Unable to send verification code. Please try again.',
      )
      if (showResendMessage) {
        setIsResendingForgotCode(false)
      } else {
        setIsSendingReset(false)
      }
      return false
    }
  }

  const handleForgotSubmit = async (event) => {
    event.preventDefault()
    await requestForgotCode()
  }

  const handleForgotResendCode = async () => {
    await requestForgotCode({ showResendMessage: true })
  }

  const handleForgotVerifyCode = async (event) => {
    event.preventDefault()

    const email = forgotUsername.trim().toLowerCase()
    const code = forgotCode.trim()

    if (!email || !code) {
      setForgotError('Enter your email and verification code.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setForgotError('Please enter a valid email address.')
      return
    }
    if (!/^\d{6}$/.test(code)) {
      setForgotError('Enter the 6-digit verification code sent to your email.')
      return
    }

    setIsVerifyingCode(true)
    setForgotError('')
    setForgotSuccess('')

    try {
      const { response, payload } = await fetchJsonWithBackendRetry('/api/auth/verify-reset-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          login: email,
          code,
        }),
      })
      if (!response.ok) {
        const rawError = String(payload?.error || '').toLowerCase()
        const nextError = rawError.includes('expired') || rawError.includes('invalid')
          ? 'That verification code is invalid or expired. Please use the latest code sent to your email, or request a new one.'
          : (payload?.error || 'Invalid or expired verification code.')
        setForgotError(nextError)
        setIsVerifyingCode(false)
        return
      }

      setForgotStep('reset')
      setForgotSuccess('Code verified. You can now set a new password.')
      setIsVerifyingCode(false)
    } catch (requestError) {
      setForgotError(
        requestError?.code === BACKEND_STARTING_ERROR
          ? 'System is still starting. Please wait a moment and try again.'
          : 'Unable to verify code. Please try again.',
      )
      setIsVerifyingCode(false)
    }
  }

  const handleForgotResetPassword = async (event) => {
    event.preventDefault()

    const newPassword = forgotNewPassword.trim()
    const confirmPassword = forgotConfirmPassword.trim()

    if (!newPassword || !confirmPassword) {
      setForgotError('Please enter and confirm your new password.')
      return
    }

    if (newPassword.length < 8) {
      setForgotError('Password must be at least 8 characters.')
      return
    }

    if (newPassword !== confirmPassword) {
      setForgotError('Passwords do not match.')
      return
    }

    setIsResettingPassword(true)
    setForgotError('')
    setForgotSuccess('')

    try {
      const { response, payload } = await fetchJsonWithBackendRetry('/api/auth/complete-forgot-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          login: forgotUsername.trim(),
          code: forgotCode.trim(),
          newPassword,
        }),
      })

      if (!response.ok) {
        setForgotError(payload?.error || 'Unable to update password.')
        setIsResettingPassword(false)
        return
      }

      setForgotStep('done')
      setForgotCode('')
      setForgotNewPassword('')
      setForgotConfirmPassword('')
      setForgotSuccess('Password updated successfully. You can now log in.')
      setIsResettingPassword(false)
    } catch (requestError) {
      setForgotError(
        requestError?.code === BACKEND_STARTING_ERROR
          ? 'System is still starting. Please wait a moment and try again.'
          : 'Unable to update password.',
      )
      setIsResettingPassword(false)
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!supabase || isLoggingIn) return

    const submittedForm = new FormData(event.currentTarget)
    const liveUsername = `${submittedForm.get('username') ?? ''}`
    const livePassword = `${submittedForm.get('password') ?? ''}`
    const loginInput = liveUsername.trim()

    setForm({
      username: liveUsername,
      password: livePassword,
    })

    if (!loginInput || !livePassword) {
      setError('Please enter username/email and password.')
      return
    }

    setError('')
    setIsLoggingIn(true)

    try {
      const { response, payload } = await fetchJsonWithBackendRetry('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          login: loginInput,
          password: livePassword,
        }),
      })
      if (!response.ok) {
        setError(payload?.error || 'Unable to log in right now. Please try again.')
        return
      }

      const accessToken = payload?.session?.access_token || ''
      const refreshToken = payload?.session?.refresh_token || ''
      if (!accessToken || !refreshToken) {
        setError('Login succeeded, but no session was returned.')
        return
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      })

      if (sessionError) {
        setError(sessionError.message || 'Unable to finish login.')
        return
      }

      loginTransitionStartedAtRef.current = Date.now()
      setIsLoginTransitioning(true)
    } catch (requestError) {
      setError(
        requestError?.code === BACKEND_STARTING_ERROR
          ? 'System is still starting. Please wait a moment and try again.'
          : 'Unable to log in right now.',
      )
      setIsLoginTransitioning(false)
      return
    } finally {
      setIsLoggingIn(false)
    }

    setError('')
  }

  const handleLogoutRequest = () => {
    setIsLogoutModalOpen(true)
  }

  const handleLoginErrorClose = () => {
    setError('')
  }

  const handleLogoutNoticeClose = () => {
    setLogoutNotice('')
  }

  const closeLogoutModal = () => {
    setIsLogoutModalOpen(false)
  }

  const handleLogoutConfirm = async () => {
    setIsLogoutModalOpen(false)
    await signOutAndRedirect()
  }

  const handleBackToLogin = async () => {
    await signOutAndRedirect()
  }

  const handleStaffOnboardingBackToDetails = (event) => {
    event?.preventDefault?.()
    event?.stopPropagation?.()
    if (pendingStaffOnboarding) {
      setStaffOnboardingForm({
        email: pendingStaffOnboarding.email,
        birthDate: pendingStaffOnboarding.birthDate,
        mobileNumber: pendingStaffOnboarding.mobileNumber,
        address: pendingStaffOnboarding.address,
      })
    }
    setStaffOnboardingStep('details')
    setStaffOnboardingCode('')
    setStaffOnboardingError('')
    setStaffOnboardingInfo('')
  }

  if (isBootstrapping || isLoginTransitioning) {
    return <AppLoadingScreen label={isLoginTransitioning ? 'Loading...' : 'Loading...'} />
  }

  if (!supabase) {
    return (
      <div className="app-loading">
        Missing frontend env vars: {missingSupabaseEnv.join(', ')}. Create `frontend/.env`.
      </div>
    )
  }

  const isAuthed = Boolean(session && profile?.is_active)
  const isResetPasswordRoute = location.pathname === '/reset-password'
  const isStaffOnboardingOpen = isAuthed && requiresStaffOnboarding(profile)
  const onboardingFirstName = `${profile?.first_name || profile?.full_name || 'User'}`.trim().split(/\s+/)[0]

  if (!isAuthed && location.pathname !== '/login' && !isResetPasswordRoute) {
    return <Navigate to="/login" replace />
  }

  if (isAuthed && location.pathname === '/login') {
    return <Navigate to="/home" replace />
  }

  return (
    <>
      <Routes>
        <Route
          path="/login"
          element={
            <LoginRoute
              onLogin={handleSubmit}
              form={form}
              error={error}
              onErrorClose={handleLoginErrorClose}
              logoutNotice={logoutNotice}
              onLogoutNoticeClose={handleLogoutNoticeClose}
              isLoggingIn={isLoggingIn}
              showPassword={showPassword}
              onChange={handleChange}
              onTogglePassword={() => setShowPassword((prev) => !prev)}
              forgotUsername={forgotUsername}
              forgotCode={forgotCode}
              forgotNewPassword={forgotNewPassword}
              forgotConfirmPassword={forgotConfirmPassword}
              forgotStep={forgotStep}
              forgotError={forgotError}
              forgotSuccess={forgotSuccess}
              isVerifyingCode={isVerifyingCode}
              isSendingReset={isSendingReset}
              isResendingForgotCode={isResendingForgotCode}
              isResettingPassword={isResettingPassword}
              onForgotUsernameChange={handleForgotUsernameChange}
              onForgotCodeChange={handleForgotCodeChange}
              onForgotNewPasswordChange={handleForgotNewPasswordChange}
              onForgotConfirmPasswordChange={handleForgotConfirmPasswordChange}
              onForgotSubmit={handleForgotSubmit}
              onForgotResendCode={handleForgotResendCode}
              onForgotVerifyCode={handleForgotVerifyCode}
              onForgotResetPassword={handleForgotResetPassword}
              onForgotClose={handleForgotClose}
            />
          }
        />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/*" element={<ProtectedLayout onLogout={handleLogoutRequest} navItems={navItems} role={profile?.role} profile={profile} sessionUser={session?.user} onProfileChange={setProfile} isLogoutModalOpen={isLogoutModalOpen} />} />
      </Routes>

      {isLogoutModalOpen ? (
        <>
          <div className="modal-backdrop" onClick={closeLogoutModal} />
          <section className="logout-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="logout-confirm-title">
            <div className="pr-modal-head"><h2 id="logout-confirm-title">Logout</h2></div>
            <div className="pr-modal-body">
              <p>Are you sure you want to logout?</p>
              <div className="modal-actions">
                <button type="button" className="danger-btn" onClick={closeLogoutModal}>Cancel</button>
                <button type="button" className="success-btn" onClick={() => { void handleLogoutConfirm() }}>Logout</button>
              </div>
            </div>
          </section>
        </>
      ) : null}

      {isStaffOnboardingOpen ? (
        <>
          <div className="modal-backdrop" />
          <section className="pr-modal onboarding-modal" role="dialog" aria-modal="true" aria-labelledby="staff-onboarding-title">
            <div className="pr-modal-head">
              <h2 id="staff-onboarding-title">
                {staffOnboardingStep === 'details' ? `Welcome ${onboardingFirstName}` : 'Verify Your Email'}
              </h2>
            </div>
            <div className="pr-modal-body">
              {staffOnboardingStep === 'details' ? (
                <form className="onboarding-form" onSubmit={(event) => { void handleStaffOnboardingSubmit(event) }}>
                  <p>
                    This form is a one-time step for new users only. Please complete your details now so we can finish setting up your account before you access the system.
                  </p>
                  <div className="onboarding-grid">
                    <label className={staffOnboardingFieldErrors.email ? 'field-required has-error' : 'field-required'}>
                      <span className="field-label-copy">Email</span>
                      <input type="email" name="email" value={staffOnboardingForm.email} onChange={handleStaffOnboardingFieldChange} placeholder="Enter your real email" />
                    </label>
                    <label className={staffOnboardingFieldErrors.birthDate ? 'field-required has-error' : 'field-required'}>
                      <span className="field-label-copy">Birthday</span>
                      <input type="date" name="birthDate" value={staffOnboardingForm.birthDate} onChange={handleStaffOnboardingFieldChange} max={getAdultBirthDateMax()} />
                    </label>
                    <label className={staffOnboardingFieldErrors.mobileNumber ? 'field-required has-error' : 'field-required'}>
                      <span className="field-label-copy">Mobile Number</span>
                      <div className="onboarding-phone-field">
                        <span className="onboarding-phone-prefix">+63</span>
                        <input type="text" inputMode="numeric" name="mobileNumber" value={staffOnboardingForm.mobileNumber} onChange={handleStaffOnboardingFieldChange} placeholder="9762911478" />
                      </div>
                    </label>
                    <label className={`span-2 field-required${staffOnboardingFieldErrors.address ? ' has-error' : ''}`}>
                      <span className="field-label-copy">Address</span>
                      <input type="text" name="address" value={staffOnboardingForm.address} onChange={handleStaffOnboardingFieldChange} placeholder="Enter your address" />
                    </label>
                  </div>
                  {staffOnboardingError ? <p className="error">{staffOnboardingError}</p> : null}
                  {staffOnboardingInfo ? <p className="onboarding-success">{staffOnboardingInfo}</p> : null}
                  <div className="modal-actions">
                    <button type="button" className="ghost" onClick={() => { void handleBackToLogin() }} disabled={isStaffOnboardingSubmitting}>
                      Back to Login
                    </button>
                    <button type="submit" className="success-btn" disabled={isStaffOnboardingSubmitting}>
                      {isStaffOnboardingSubmitting ? 'Sending...' : 'Submit Details'}
                    </button>
                  </div>
                </form>
              ) : (
                <form className="onboarding-form onboarding-verify-form" onSubmit={(event) => { void handleStaffOnboardingVerify(event) }}>
                  <p>Enter the verification code that was sent to your email.</p>
                  <div className="onboarding-grid single">
                    <label>
                      Verification Code
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        value={staffOnboardingCode}
                        onChange={handleStaffOnboardingCodeChange}
                        placeholder="Enter 6-digit code"
                      />
                    </label>
                  </div>
                  {staffOnboardingError ? <p className="error">{staffOnboardingError}</p> : null}
                  {staffOnboardingInfo ? <p className="onboarding-success">{staffOnboardingInfo}</p> : null}
                  <div className="modal-actions">
                    <button type="button" className="ghost onboarding-secondary-btn" onClick={() => { void handleBackToLogin() }} disabled={isStaffOnboardingVerifying || isStaffOnboardingResending}>
                      Back to Login
                    </button>
                    <button type="button" className="ghost onboarding-secondary-btn" onClick={handleStaffOnboardingBackToDetails} disabled={isStaffOnboardingVerifying || isStaffOnboardingResending}>
                      Back to Details
                    </button>
                    <button type="button" className="ghost onboarding-secondary-btn" onClick={() => { void handleStaffOnboardingResend() }} disabled={isStaffOnboardingVerifying || isStaffOnboardingResending}>
                      {isStaffOnboardingResending ? 'Resending...' : 'Resend Code'}
                    </button>
                    <button type="submit" className="success-btn" disabled={isStaffOnboardingVerifying}>
                      {isStaffOnboardingVerifying ? 'Verifying...' : 'Verify Code'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </section>
        </>
      ) : null}
    </>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}

export default App
