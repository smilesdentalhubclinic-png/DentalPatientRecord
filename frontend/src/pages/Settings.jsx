import { useState } from 'react'
import ErrorModal from '../components/ErrorModal'
import { supabase } from '../lib/supabaseClient'
import clinicLogo from '../assets/DENTAL LOGO.png'
import useSessionStorageState, { UI_SESSION_STORAGE_PREFIX } from '../hooks/useSessionStorageState'
import { isValidLetterName, sanitizeLetterNameInput } from '../utils/nameValidation'

const ROLE_LABELS = {
  admin: 'Admin',
  associate_dentist: 'Associate Dentist',
  receptionist: 'Receptionist',
}

const formatStaffCode = (userId) => {
  const raw = `${userId || ''}`.trim()
  if (/^ST-\d{6}$/i.test(raw)) return raw.toUpperCase()

  const digits = raw.replace(/\D/g, '')
  if (digits) return `ST-${digits.slice(-6).padStart(6, '0')}`

  const alphanumerics = raw.replace(/[^a-zA-Z0-9]/g, '')
  const tail = alphanumerics.slice(-6).toUpperCase()
  return `ST-${tail.padStart(6, '0')}`
}

const formatDateTime = (value) => {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not available'
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
const SETTINGS_UI_STORAGE_PREFIX = `${UI_SESSION_STORAGE_PREFIX}settings.`

const OPTIONAL_SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'v'])

const splitProfileName = (value) => {
  const normalized = `${value ?? ''}`.trim().replace(/\s+/g, ' ')
  if (!normalized) {
    return {
      firstName: '-',
      middleName: '-',
      lastName: '-',
      suffix: '-',
    }
  }

  const segments = normalized.split(' ')
  let suffix = '-'
  let working = [...segments]
  const trailing = working.at(-1)?.toLowerCase()

  if (trailing && OPTIONAL_SUFFIXES.has(trailing)) {
    suffix = working.pop()
  }

  if (working.length === 1) {
    return {
      firstName: working[0] || '-',
      middleName: '-',
      lastName: '-',
      suffix,
    }
  }

  if (working.length === 2) {
    return {
      firstName: working[0] || '-',
      middleName: '-',
      lastName: working[1] || '-',
      suffix,
    }
  }

  return {
    firstName: working[0] || '-',
    middleName: working.slice(1, -1).join(' ') || '-',
    lastName: working.at(-1) || '-',
    suffix,
  }
}

const formatDateOnlyLong = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

const calculateAge = (birthDate) => {
  if (!birthDate) return '-'
  const dob = new Date(birthDate)
  if (Number.isNaN(dob.getTime())) return '-'
  const now = new Date()
  let age = now.getFullYear() - dob.getFullYear()
  const monthDelta = now.getMonth() - dob.getMonth()
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < dob.getDate())) age -= 1
  return age < 0 ? '-' : String(age)
}

const normalizePhilippineMobile = (value = '') => `${value}`.replace(/\D/g, '').slice(0, 10)

const toPhilippineLocalMobileInput = (value = '') => {
  const digits = `${value || ''}`.replace(/\D/g, '')
  if (digits.startsWith('63') && digits.length >= 12) return digits.slice(2, 12)
  if (digits.startsWith('0') && digits.length >= 11) return digits.slice(1, 11)
  return digits.slice(0, 10)
}

const formatPhilippineMobileDisplay = (value = '') => {
  const localDigits = toPhilippineLocalMobileInput(value)
  return localDigits ? `+63${localDigits}` : '-'
}

const buildFullName = ({ firstName, middleName, lastName, suffix }) => (
  [firstName, middleName, lastName, suffix]
    .map((value) => `${value ?? ''}`.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
)

const formatLetterNameInput = (value) => sanitizeLetterNameInput(value)

const formatProfileFullName = (profile) => (
  [
    `${profile?.first_name || ''}`.trim(),
    `${profile?.middle_name || ''}`.trim(),
    `${profile?.last_name || ''}`.trim(),
    `${profile?.suffix || ''}`.trim(),
  ].filter(Boolean).join(' ') || `${profile?.full_name || ''}`.trim() || 'Staff User'
)

const getProfileNameParts = (profile) => {
  const fallback = splitProfileName(profile?.full_name)
  return {
    firstName: `${profile?.first_name || ''}`.trim() || (fallback.firstName === '-' ? '' : fallback.firstName),
    middleName: `${profile?.middle_name || ''}`.trim() || (fallback.middleName === '-' ? '' : fallback.middleName),
    lastName: `${profile?.last_name || ''}`.trim() || (fallback.lastName === '-' ? '' : fallback.lastName),
    suffix: `${profile?.suffix || ''}`.trim() || (fallback.suffix === '-' ? '' : fallback.suffix),
  }
}

function Settings({ currentProfile, currentSessionUser, onProfileChange }) {
  const [profileOverride, setProfileOverride] = useState(null)
  const [profileForm, setProfileForm] = useState(() => {
    const parsedName = getProfileNameParts(currentProfile)
    return {
      firstName: parsedName.firstName,
      middleName: parsedName.middleName,
      lastName: parsedName.lastName,
      suffix: parsedName.suffix,
      birthDate: currentProfile?.birth_date || '',
      mobileNumber: toPhilippineLocalMobileInput(currentProfile?.mobile_number || ''),
      address: currentProfile?.address || '',
      username: currentProfile?.username || '',
    }
  })
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [emailVerificationCode, setEmailVerificationCode] = useSessionStorageState(`${SETTINGS_UI_STORAGE_PREFIX}emailVerificationCode`, '')
  const [pendingEmailVerification, setPendingEmailVerification] = useSessionStorageState(`${SETTINGS_UI_STORAGE_PREFIX}pendingEmailVerification`, '')
  const [error, setError] = useState('')
  const [emailVerificationError, setEmailVerificationError] = useState('')
  const [emailVerificationInfo, setEmailVerificationInfo] = useSessionStorageState(`${SETTINGS_UI_STORAGE_PREFIX}emailVerificationInfo`, '')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isUpdatingEmail, setIsUpdatingEmail] = useState(false)
  const [isVerifyingEmailCode, setIsVerifyingEmailCode] = useState(false)
  const [isResendingEmailCode, setIsResendingEmailCode] = useState(false)
  const [isEditingProfile, setIsEditingProfile] = useState(false)
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [isSuccessModalOpen, setIsSuccessModalOpen] = useSessionStorageState(`${SETTINGS_UI_STORAGE_PREFIX}successModalOpen`, false)
  const [isEmailVerificationModalOpen, setIsEmailVerificationModalOpen] = useSessionStorageState(`${SETTINGS_UI_STORAGE_PREFIX}emailVerificationModalOpen`, false)
  const [successMessage, setSuccessMessage] = useSessionStorageState(`${SETTINGS_UI_STORAGE_PREFIX}successMessage`, '')
  const [passwordUpdatedAtOverride, setPasswordUpdatedAtOverride] = useState('')

  const profileSource = (
    profileOverride?.user_id && profileOverride.user_id === currentProfile?.user_id
      ? profileOverride
      : currentProfile
  ) ?? {}
  const parsedProfileName = getProfileNameParts(profileSource)
  const lastPasswordUpdatedAt = (
    passwordUpdatedAtOverride
    || currentSessionUser?.user_metadata?.password_updated_at
    || currentSessionUser?.updated_at
    || currentSessionUser?.last_sign_in_at
    || ''
  )

  const closeSuccessModal = () => {
    setIsSuccessModalOpen(false)
    setSuccessMessage('')
  }

  const closeEmailVerificationModal = () => {
    if (isVerifyingEmailCode) return
    setIsEmailVerificationModalOpen(false)
    setEmailVerificationCode('')
    setEmailVerificationError('')
    setEmailVerificationInfo('')
    setPendingEmailVerification('')
  }

  const startProfileEdit = () => {
    const parsedName = getProfileNameParts(profileSource)
    setProfileForm({
      firstName: parsedName.firstName,
      middleName: parsedName.middleName,
      lastName: parsedName.lastName,
      suffix: parsedName.suffix,
      birthDate: profileSource?.birth_date || '',
      mobileNumber: toPhilippineLocalMobileInput(profileSource?.mobile_number || ''),
      address: profileSource?.address || '',
      username: profileSource?.username || '',
    })
    setError('')
    setIsEditingProfile(true)
  }

  const cancelProfileEdit = () => {
    const parsedName = getProfileNameParts(profileSource)
    setProfileForm({
      firstName: parsedName.firstName,
      middleName: parsedName.middleName,
      lastName: parsedName.lastName,
      suffix: parsedName.suffix,
      birthDate: profileSource?.birth_date || '',
      mobileNumber: toPhilippineLocalMobileInput(profileSource?.mobile_number || ''),
      address: profileSource?.address || '',
      username: profileSource?.username || '',
    })
    setError('')
    setIsEditingProfile(false)
  }

  const handleProfileSave = async () => {
    const firstName = profileForm.firstName.trim()
    const middleName = profileForm.middleName.trim()
    const lastName = profileForm.lastName.trim()
    const suffix = profileForm.suffix.trim()
    const birthDate = profileForm.birthDate || null
    const mobileNumber = normalizePhilippineMobile(profileForm.mobileNumber)
    const address = profileForm.address.trim()
    const username = profileForm.username.trim()
    const fullName = buildFullName({ firstName, middleName, lastName, suffix })

    if (!firstName || !lastName || !username) {
      setError('First name, last name, and username are required.')
      return
    }
    if (!isValidLetterName(firstName) || !isValidLetterName(lastName) || !isValidLetterName(middleName, { allowEmpty: true })) {
      setError('First name, last name, and middle name must contain letters only.')
      return
    }

    if (mobileNumber && !/^9\d{9}$/.test(mobileNumber)) {
      setError('Mobile number must be a valid Philippine number after +63, like 9762911478.')
      return
    }

    if (!profileSource?.user_id) {
      setError('Unable to locate your profile record.')
      return
    }

    setIsSavingProfile(true)
    setError('')

    const { data, error: updateError } = await supabase
      .from('staff_profiles')
      .update({
        full_name: fullName,
        first_name: firstName,
        middle_name: middleName || null,
        last_name: lastName,
        suffix: suffix || null,
        birth_date: birthDate,
        mobile_number: mobileNumber ? `+63${mobileNumber}` : null,
        address: address || null,
        username,
      })
      .eq('user_id', profileSource.user_id)
      .select('user_id, full_name, first_name, middle_name, last_name, suffix, birth_date, mobile_number, address, email, username, role, is_active, created_at, updated_at')
      .single()

    if (updateError) {
      setError(updateError.message)
      setIsSavingProfile(false)
      return
    }

    setProfileOverride(data)
    onProfileChange?.(data)
    setIsEditingProfile(false)
    setIsSavingProfile(false)
  }

  const handleEmailSubmit = async (event) => {
    event.preventDefault()

    const trimmedNewEmail = newEmail.trim().toLowerCase()

    if (!trimmedNewEmail) {
      setError('Please enter your new email.')
      return
    }

    if (trimmedNewEmail === String(profileSource?.email || '').trim().toLowerCase()) {
      setError('Please enter a different email address.')
      return
    }

    setIsUpdatingEmail(true)
    setError('')
    setEmailVerificationError('')
    setEmailVerificationInfo('')

    try {
      const { data, error: sessionError } = await supabase.auth.getSession()
      const accessToken = data?.session?.access_token

      if (sessionError || !accessToken) {
        setError('Your session expired. Please log in again.')
        setIsUpdatingEmail(false)
        return
      }

      const response = await fetch('/api/auth/request-email-change-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          email: trimmedNewEmail,
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(payload?.error || 'Unable to update email.')
        setIsUpdatingEmail(false)
        return
      }

      setPendingEmailVerification(trimmedNewEmail)
      setEmailVerificationCode('')
      setEmailVerificationError('')
      setEmailVerificationInfo(`A verification code was sent to ${trimmedNewEmail}.`)
      setIsEmailVerificationModalOpen(true)
      setIsUpdatingEmail(false)
    } catch {
      setError('Unable to update email.')
      setIsUpdatingEmail(false)
    }
  }

  const handleEmailVerificationSubmit = async (event) => {
    event.preventDefault()

    const trimmedCode = emailVerificationCode.trim()
    const trimmedPendingEmail = pendingEmailVerification.trim().toLowerCase()

    if (!trimmedCode) {
      setEmailVerificationError('Please enter the verification code sent to your email.')
      return
    }

    if (!trimmedPendingEmail) {
      setEmailVerificationError('No pending email verification was found.')
      return
    }

    setIsVerifyingEmailCode(true)
    setEmailVerificationError('')
    setEmailVerificationInfo('')

    try {
      const { data, error: sessionError } = await supabase.auth.getSession()
      const accessToken = data?.session?.access_token

      if (sessionError || !accessToken) {
        setEmailVerificationError('Your session expired. Please log in again.')
        setIsVerifyingEmailCode(false)
        return
      }

      const response = await fetch('/api/auth/verify-email-change-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          email: trimmedPendingEmail,
          code: trimmedCode,
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setEmailVerificationError(payload?.error || 'Unable to verify email change.')
        setIsVerifyingEmailCode(false)
        return
      }

      setProfileOverride((previous) => ({ ...(previous || {}), email: trimmedPendingEmail }))
      onProfileChange?.((previous) => ({ ...(previous || {}), email: trimmedPendingEmail }))
      setNewEmail('')
      setPendingEmailVerification('')
      setEmailVerificationCode('')
      setEmailVerificationInfo('')
      setIsEmailVerificationModalOpen(false)
      setSuccessMessage('Email updated successfully.')
      setIsSuccessModalOpen(true)
      setIsVerifyingEmailCode(false)
    } catch {
      setEmailVerificationError('Unable to verify email change.')
      setIsVerifyingEmailCode(false)
    }
  }

  const handleResendEmailVerificationCode = async () => {
    const trimmedPendingEmail = pendingEmailVerification.trim().toLowerCase()

    if (!trimmedPendingEmail) {
      setEmailVerificationError('No pending email verification was found.')
      return
    }

    setIsResendingEmailCode(true)
    setEmailVerificationError('')
    setEmailVerificationInfo('')

    try {
      const { data, error: sessionError } = await supabase.auth.getSession()
      const accessToken = data?.session?.access_token

      if (sessionError || !accessToken) {
        setEmailVerificationError('Your session expired. Please log in again.')
        setIsResendingEmailCode(false)
        return
      }

      const response = await fetch('/api/auth/request-email-change-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          email: trimmedPendingEmail,
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setEmailVerificationError(payload?.error || 'Unable to resend verification code.')
        setIsResendingEmailCode(false)
        return
      }

      setEmailVerificationInfo(`A new verification code was sent to ${trimmedPendingEmail}.`)
      setIsResendingEmailCode(false)
    } catch {
      setEmailVerificationError('Unable to resend verification code.')
      setIsResendingEmailCode(false)
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    const trimmedNewPassword = newPassword.trim()
    const trimmedConfirmPassword = confirmPassword.trim()

    if (!trimmedNewPassword || !trimmedConfirmPassword) {
      setError('Please enter and confirm your new password.')
      return
    }

    if (trimmedNewPassword.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    if (trimmedNewPassword !== trimmedConfirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setIsSubmitting(true)
    setError('')

    try {
      const { data, error: sessionError } = await supabase.auth.getSession()
      const accessToken = data?.session?.access_token

      if (sessionError || !accessToken) {
        setError('Your session expired. Please log in again.')
        setIsSubmitting(false)
        return
      }

      const response = await fetch('/api/auth/update-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          newPassword: trimmedNewPassword,
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(payload?.error || 'Unable to update password.')
        setIsSubmitting(false)
        return
      }

      setNewPassword('')
      setConfirmPassword('')
      setPasswordUpdatedAtOverride(payload?.passwordUpdatedAt || payload?.user?.user_metadata?.password_updated_at || '')
      setSuccessMessage('Password updated successfully.')
      setIsSuccessModalOpen(true)
      setIsSubmitting(false)
    } catch {
      setError('Unable to update password.')
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <header className="page-header">
        <h1>Profile</h1>
      </header>

      <section className="panel settings-page">
        <div className="panel-card settings-card">
          <div className="settings-shell">
            <div className="settings-hero-card">
              <div className="settings-hero-copy">
                <p className="settings-eyebrow">Account Center</p>
                <h2>{formatProfileFullName(profileSource)}</h2>
                <div className="settings-hero-meta">
                  <div className="settings-hero-chip">
                    <span>Staff ID</span>
                    <strong>{formatStaffCode(profileSource?.user_id)}</strong>
                  </div>
                  <div className="settings-hero-chip">
                    <span>Role</span>
                    <strong>{ROLE_LABELS[profileSource?.role] || profileSource?.role || '-'}</strong>
                  </div>
                  <div className="settings-hero-chip settings-hero-chip-wide">
                    <span>Password Last Updated</span>
                    <strong>{formatDateTime(lastPasswordUpdatedAt)}</strong>
                  </div>
                </div>
              </div>

              <div className="settings-hero-brand">
                <img src={clinicLogo} alt="Smiles Dental Hub logo" className="settings-hero-logo" />
              </div>
            </div>

            <div className="settings-column">
              <div className="settings-section settings-section-card">
                <div className="settings-section-head">
                  <h2 className="panel-title">Profile Information</h2>
                  <div className="settings-inline-actions">
                    {isEditingProfile ? (
                      <>
                        <button type="button" className="ghost" onClick={cancelProfileEdit} disabled={isSavingProfile}>Cancel</button>
                        <button type="button" className="primary" onClick={() => { void handleProfileSave() }} disabled={isSavingProfile}>
                          {isSavingProfile ? 'Saving...' : 'Save'}
                        </button>
                      </>
                    ) : (
                      <button type="button" className="icon-btn" title="Update" onClick={startProfileEdit} aria-label="Edit profile">
                        &#9998;
                      </button>
                    )}
                  </div>
                </div>
                <div className="history-top-grid settings-grid settings-profile-grid">
                  <label>
                    Last Name
                    <input type="text" value={isEditingProfile ? profileForm.lastName : parsedProfileName.lastName} readOnly={!isEditingProfile} onChange={(event) => setProfileForm((previous) => ({ ...previous, lastName: formatLetterNameInput(event.target.value) }))} />
                  </label>

                  <label>
                    First Name
                    <input type="text" value={isEditingProfile ? profileForm.firstName : parsedProfileName.firstName} readOnly={!isEditingProfile} onChange={(event) => setProfileForm((previous) => ({ ...previous, firstName: formatLetterNameInput(event.target.value) }))} />
                  </label>

                  <label>
                    Middle Name
                    <input type="text" value={isEditingProfile ? profileForm.middleName : parsedProfileName.middleName} readOnly={!isEditingProfile} onChange={(event) => setProfileForm((previous) => ({ ...previous, middleName: formatLetterNameInput(event.target.value) }))} />
                  </label>

                  <label>
                    Suffix
                    <input type="text" value={isEditingProfile ? profileForm.suffix : parsedProfileName.suffix} readOnly={!isEditingProfile} onChange={(event) => setProfileForm((previous) => ({ ...previous, suffix: event.target.value }))} />
                  </label>

                  <label>
                    Username
                    <input type="text" value={isEditingProfile ? profileForm.username : (profileSource?.username || '-')} readOnly={!isEditingProfile} onChange={(event) => setProfileForm((previous) => ({ ...previous, username: event.target.value }))} />
                  </label>

                  <label>
                    Email
                    <input type="text" value={profileSource?.email || '-'} readOnly />
                  </label>

                  <label>
                    Birthday
                    <input type={isEditingProfile ? 'date' : 'text'} value={isEditingProfile ? profileForm.birthDate : formatDateOnlyLong(profileSource?.birth_date)} readOnly={!isEditingProfile} onChange={(event) => setProfileForm((previous) => ({ ...previous, birthDate: event.target.value }))} />
                  </label>

                  <label>
                    Age
                    <input type="text" value={calculateAge(isEditingProfile ? profileForm.birthDate : profileSource?.birth_date)} readOnly />
                  </label>

                  <label className="span-2">
                    Mobile Number
                    {isEditingProfile ? (
                      <div className="ph-mobile-field settings-ph-mobile-field">
                        <span className="ph-mobile-prefix">+63</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="9762911478"
                          maxLength={10}
                          value={profileForm.mobileNumber}
                          onChange={(event) => setProfileForm((previous) => ({
                            ...previous,
                            mobileNumber: normalizePhilippineMobile(event.target.value),
                          }))}
                        />
                      </div>
                    ) : (
                      <input type="text" value={formatPhilippineMobileDisplay(profileSource?.mobile_number || '')} readOnly />
                    )}
                  </label>

                  <label className="span-2">
                    Address
                    <input type="text" value={isEditingProfile ? profileForm.address : (profileSource?.address || '-')} readOnly={!isEditingProfile} onChange={(event) => setProfileForm((previous) => ({ ...previous, address: event.target.value }))} />
                  </label>
                </div>
              </div>
            </div>

            <div className="settings-column">
              <div className="settings-form settings-section settings-section-card">
                <h2 className="panel-title">Security</h2>
                <form onSubmit={(event) => { void handleEmailSubmit(event) }}>
                  <div className="settings-subsection-head">
                    <h3>Change Email</h3>
                  </div>
                  <div className="history-top-grid settings-grid settings-security-grid">
                    <label>
                      New Email
                      <input
                        type="email"
                        value={newEmail}
                        onChange={(event) => {
                          setNewEmail(event.target.value)
                          setError('')
                          setEmailVerificationError('')
                        }}
                        autoComplete="email"
                        disabled={isUpdatingEmail}
                      />
                    </label>

                    <div className="settings-email-action">
                      <button type="submit" className="primary" disabled={isUpdatingEmail}>
                        {isUpdatingEmail ? 'Sending...' : 'Update Email'}
                      </button>
                    </div>
                  </div>
                </form>

                <div className="settings-divider" aria-hidden="true" />

                <form onSubmit={(event) => { void handleSubmit(event) }}>
                  <div className="settings-subsection-head">
                    <h3>Change Password</h3>
                  </div>
                  <div className="history-top-grid settings-grid settings-security-grid">
                    <label>
                      New Password
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(event) => {
                          setNewPassword(event.target.value)
                          setError('')
                        }}
                        autoComplete="new-password"
                        disabled={isSubmitting}
                      />
                    </label>

                    <label>
                      Confirm Password
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(event) => {
                          setConfirmPassword(event.target.value)
                          setError('')
                        }}
                        autoComplete="new-password"
                        disabled={isSubmitting}
                      />
                    </label>
                  </div>

                  <div className="settings-help-card">
                    <h3>Password Tips</h3>
                    <ul className="settings-tip-list">
                      <li>Use at least 8 characters.</li>
                      <li>Mix uppercase, lowercase, numbers, or symbols.</li>
                      <li>Avoid using your username or email in the password.</li>
                    </ul>
                  </div>

                  <ErrorModal message={error} onClose={() => setError('')} />

                  <div className="settings-actions">
                    <button type="submit" className="primary" disabled={isSubmitting}>
                      {isSubmitting ? 'Updating...' : 'Update Password'}
                    </button>
                  </div>
                </form>

              </div>
            </div>
          </div>
        </div>
      </section>

      {isSuccessModalOpen ? (
        <>
          <div className="modal-backdrop" onClick={closeSuccessModal} />
          <div className="pr-modal procedures-modal success-modal settings-success-modal" role="dialog" aria-modal="true" aria-labelledby="settings-success-title">
            <div className="pr-modal-head"><h2 id="settings-success-title">&nbsp;</h2></div>
            <div className="pr-modal-body">
              <p>{successMessage || 'Updated successfully.'}</p>
              <div className="modal-actions center">
                <button type="button" className="success-btn" onClick={closeSuccessModal}>Done</button>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {isEmailVerificationModalOpen ? (
        <>
          <div className="modal-backdrop" onClick={closeEmailVerificationModal} />
          <div className="pr-modal settings-verification-modal" role="dialog" aria-modal="true" aria-labelledby="settings-email-verification-title">
            <div className="pr-modal-head">
              <h2 id="settings-email-verification-title">Verify Email Change</h2>
              <button type="button" onClick={closeEmailVerificationModal} aria-label="Close email verification modal">×</button>
            </div>
            <div className="pr-modal-body">
              <p className="settings-verification-copy">
                Check the verification code in your email{pendingEmailVerification ? `: ${pendingEmailVerification}` : ''}.
              </p>
              <form className="settings-verification-form" onSubmit={(event) => { void handleEmailVerificationSubmit(event) }}>
                <label>
                  Verification Code
                  <input
                    type="text"
                    value={emailVerificationCode}
                    onChange={(event) => {
                      setEmailVerificationCode(event.target.value)
                      setEmailVerificationError('')
                    }}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="Enter 6-digit code"
                    disabled={isVerifyingEmailCode}
                  />
                </label>

                <ErrorModal message={emailVerificationError} onClose={() => setEmailVerificationError('')} />
                {emailVerificationInfo ? <p className="onboarding-success">{emailVerificationInfo}</p> : null}

                <div className="modal-actions">
                  <button type="button" className="ghost" onClick={closeEmailVerificationModal} disabled={isVerifyingEmailCode || isResendingEmailCode}>Cancel</button>
                  <button type="button" className="ghost" onClick={() => { void handleResendEmailVerificationCode() }} disabled={isVerifyingEmailCode || isResendingEmailCode}>
                    {isResendingEmailCode ? 'Resending...' : 'Resend Code'}
                  </button>
                  <button type="submit" className="success-btn" disabled={isVerifyingEmailCode || isResendingEmailCode}>
                    {isVerifyingEmailCode ? 'Verifying...' : 'Verify Code'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </>
      ) : null}
    </>
  )
}

export default Settings
