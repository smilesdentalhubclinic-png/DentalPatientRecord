import { useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import useSessionStorageState, { UI_SESSION_STORAGE_PREFIX } from '../hooks/useSessionStorageState'
import navbarLogo from '../assets/NAVBARLOGO.png'
import homeIcon from '../assets/icon/Home.png'
import patientRecordsIcon from '../assets/icon/Patient Records.png'
import addPatientIcon from '../assets/icon/Add patient.png'
import procedureIcon from '../assets/icon/Procedure.png'
import patientLogsIcon from '../assets/icon/Patient logs.png'
import adminIcon from '../assets/icon/Admin.png'
import logoutIcon from '../assets/icon/Logout.png'

const NAV_ICONS = {
  home: homeIcon,
  records: patientRecordsIcon,
  'add-patient': addPatientIcon,
  procedure: procedureIcon,
  logs: patientLogsIcon,
  admin: adminIcon,
}
const SIDEBAR_UI_STORAGE_PREFIX = `${UI_SESSION_STORAGE_PREFIX}sidebar.`

function ProfileIcon() {
  return (
    <svg
      className="nav-icon-svg"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="8"
        r="3.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 19.25c1.44-3.08 4.05-4.75 7-4.75s5.56 1.67 7 4.75"
      />
    </svg>
  )
}

function renderNavIcon(itemId) {
  if (itemId === 'settings') {
    return (
      <span className="nav-icon" aria-hidden="true">
        <ProfileIcon />
      </span>
    )
  }

  return (
    <img className="nav-icon image" src={NAV_ICONS[itemId] ?? homeIcon} alt="" aria-hidden="true" />
  )
}

const ROLE_LABELS = {
  admin: 'Admin',
  receptionist: 'Receptionist',
  associate_dentist: 'Associate Dentist',
}

function Sidebar({ onLogout, navItems, isLogoutModalOpen = false, role }) {
  const location = useLocation()
  const navigate = useNavigate()
  const profileItem = (navItems ?? []).find((item) => item.id === 'settings')
  const primaryNavItems = (navItems ?? []).filter((item) => item.id !== 'settings')
  const [showGuardPassword, setShowGuardPassword] = useState(false)
  const [guardState, setGuardState] = useSessionStorageState(`${SIDEBAR_UI_STORAGE_PREFIX}guardState`, {
    isOpen: false,
    nextPath: '',
    password: '',
    error: '',
    isChecking: false,
  })

  useEffect(() => {
    if (!guardState.isOpen) return undefined

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setGuardState({
          isOpen: false,
          nextPath: '',
          password: '',
          error: '',
          isChecking: false,
        })
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [guardState.isOpen])

  const handleNavClick = (event, destinationPath) => {
    const isOnAddPatientPage = location.pathname === '/add-patient'
    const isLeavingAddPatient = isOnAddPatientPage && destinationPath !== '/add-patient'
    if (!isLeavingAddPatient) return

    event.preventDefault()
    setShowGuardPassword(false)
    setGuardState({
      isOpen: true,
      nextPath: destinationPath,
      password: '',
      error: '',
      isChecking: false,
    })
  }

  const closeGuardModal = () => {
    setShowGuardPassword(false)
    setGuardState({
      isOpen: false,
      nextPath: '',
      password: '',
      error: '',
      isChecking: false,
    })
  }

  const continueNavigation = async () => {
    if (!guardState.password.trim()) {
      setGuardState((previous) => ({ ...previous, error: 'Password is required.' }))
      return
    }

    setGuardState((previous) => ({ ...previous, isChecking: true, error: '' }))

    const { data: authData, error: authError } = await supabase.auth.getUser()
    const email = authData?.user?.email

    if (authError || !email) {
      setGuardState((previous) => ({
        ...previous,
        isChecking: false,
        error: 'Unable to verify current user. Please log in again.',
      }))
      return
    }

    const verifyClient = createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    )

    const { error: signInError } = await verifyClient.auth.signInWithPassword({
      email,
      password: guardState.password,
    })

    if (signInError) {
      setGuardState((previous) => ({
        ...previous,
        isChecking: false,
        error: 'Incorrect password. Access denied.',
      }))
      return
    }

    const destination = guardState.nextPath
    closeGuardModal()
    navigate(destination)
  }

  return (
    <>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img className="sidebar-logo" src={navbarLogo} alt="Smiles Dental Hub logo" />
        </div>
        <nav className="sidebar-nav">
          {primaryNavItems.map((item) => (
            <NavLink key={item.id} to={item.path} className="nav-item" onClick={(event) => handleNavClick(event, item.path)}>
              {renderNavIcon(item.id)}
              <span className="nav-item-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          {profileItem ? (
            <NavLink
              to={profileItem.path}
              className={({ isActive }) => `nav-item nav-item-profile${isActive ? ' active' : ''}`}
              onClick={(event) => handleNavClick(event, profileItem.path)}
            >
              <span className="nav-item-profile-copy">
                <span className="nav-item-profile-label-row">
                  <span className="nav-icon" aria-hidden="true">
                    <ProfileIcon />
                  </span>
                  <span className="nav-item-profile-text">
                    <span className="nav-item-label">My Account</span>
                    {ROLE_LABELS[role] ? (
                      <span className="nav-item-role-badge">{ROLE_LABELS[role]}</span>
                    ) : null}
                  </span>
                </span>
              </span>
            </NavLink>
          ) : null}
          <button type="button" className={`logout logout-featured${isLogoutModalOpen ? ' logout-active' : ''}`} onClick={onLogout}>
            <img className="nav-icon image" src={logoutIcon} alt="" aria-hidden="true" />
            <span className="nav-item-label">Logout</span>
          </button>
        </div>
      </aside>

      {guardState.isOpen ? (
        <>
          <div className="modal-backdrop" onClick={closeGuardModal} />
          <section className="pr-modal nav-password-modal" role="dialog" aria-modal="true" aria-labelledby="nav-password-title">
            <div className="pr-modal-head nav-password-modal-head">
              <h2 id="nav-password-title">Restricted Navigation</h2>
              <button type="button" onClick={closeGuardModal} aria-label="Close restricted navigation dialog">
                x
              </button>
            </div>
            <div className="pr-modal-body nav-password-modal-body">
              <p>
                Add Patient is open for customer input only. Enter your password to switch tabs.
              </p>
              <label htmlFor="nav-password-input">Password</label>
              <div className="nav-password-field">
                <input
                  id="nav-password-input"
                  type={showGuardPassword ? 'text' : 'password'}
                  value={guardState.password}
                  onChange={(event) => setGuardState((previous) => ({ ...previous, password: event.target.value, error: '' }))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void continueNavigation()
                  }}
                  disabled={guardState.isChecking}
                  autoFocus
                />
                <button
                  type="button"
                  className="nav-password-toggle"
                  onClick={() => setShowGuardPassword((previous) => !previous)}
                  aria-label={showGuardPassword ? 'Hide password' : 'Show password'}
                  title={showGuardPassword ? 'Hide password' : 'Show password'}
                  disabled={guardState.isChecking}
                >
                  <svg className="eye-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden>
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
                    {!showGuardPassword ? (
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
              {guardState.error ? <p className="nav-password-error">{guardState.error}</p> : null}
              <div className="modal-actions nav-password-actions">
                <button type="button" className="danger-btn" onClick={closeGuardModal} disabled={guardState.isChecking}>Cancel</button>
                <button type="button" className="success-btn" onClick={() => { void continueNavigation() }} disabled={guardState.isChecking}>
                  {guardState.isChecking ? 'Verifying...' : 'Continue'}
                </button>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </>
  )
}

export default Sidebar
