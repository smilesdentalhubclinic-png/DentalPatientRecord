import { useEffect, useState } from 'react'
import ErrorModal from '../components/ErrorModal'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { recordSystemAudit } from '../utils/auditLog'

function ResetPassword() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loadingLink, setLoadingLink] = useState(true)
  const [canReset, setCanReset] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    if (!supabase) {
      setError('Supabase is not configured.')
      setCanReset(false)
      setLoadingLink(false)
      return
    }

    let isMounted = true

    const hydrateRecoverySession = async () => {
      setLoadingLink(true)
      setError('')

      try {
        const queryParams = new URLSearchParams(window.location.search)
        const code = queryParams.get('code')

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          if (exchangeError) throw exchangeError
        }

        const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : ''
        const hashParams = new URLSearchParams(hash)
        const accessToken = hashParams.get('access_token')
        const refreshToken = hashParams.get('refresh_token')

        if (accessToken && refreshToken) {
          const { error: setSessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          })
          if (setSessionError) throw setSessionError
        }

        if (window.location.hash) {
          window.history.replaceState(null, '', window.location.pathname + window.location.search)
        }

        const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
        if (sessionError) throw sessionError
        if (!sessionData.session) throw new Error('Invalid or expired password reset link.')

        if (isMounted) {
          setCanReset(true)
          setLoadingLink(false)
        }
      } catch (sessionSetupError) {
        if (!isMounted) return
        setError(sessionSetupError?.message || 'Invalid or expired password reset link.')
        setCanReset(false)
        setLoadingLink(false)
      }
    }

    void hydrateRecoverySession()

    return () => {
      isMounted = false
    }
  }, [])

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!supabase) return
    if (!canReset) {
      setError('Invalid or expired password reset link.')
      return
    }

    setError('')
    setSuccess('')

    if (!password || !confirmPassword) {
      setError('Please enter and confirm your new password.')
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      setError(updateError.message || 'Unable to update password.')
      setSubmitting(false)
      return
    }

    const { data: userData } = await supabase.auth.getUser()
    await recordSystemAudit({
      action: 'password_reset_completed',
      entityType: 'auth_password',
      entityId: userData?.user?.id || null,
      entityLabel: userData?.user?.email || 'Password reset user',
      details: 'Password reset completed from recovery page.',
    })

    await supabase.auth.signOut()
    setSuccess('Password updated successfully. You can now log in.')
    setSubmitting(false)
  }

  const goToLogin = () => {
    navigate('/login', { replace: true })
  }

  return (
    <div className="page" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#eef5f9', padding: '1.5rem' }}>
      <ErrorModal message={error} onClose={() => setError('')} />
      <div style={{ width: '100%', maxWidth: '460px', background: '#fff', borderRadius: '16px', boxShadow: '0 18px 40px rgba(10, 32, 44, 0.16)', padding: '1.5rem' }}>
        <h2 style={{ marginTop: 0, marginBottom: '0.75rem', color: '#12354b' }}>Reset Password</h2>
        {loadingLink ? <p style={{ marginTop: 0 }}>Validating reset link...</p> : null}
        {!loadingLink && canReset ? (
          <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '0.75rem' }}>
            <label style={{ display: 'grid', gap: '0.3rem' }}>
              <span style={{ fontWeight: 600, color: '#33576a' }}>New password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
              />
            </label>
            <label style={{ display: 'grid', gap: '0.3rem' }}>
              <span style={{ fontWeight: 600, color: '#33576a' }}>Confirm new password</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
              />
            </label>
            {success ? <p style={{ margin: 0, color: '#1f7a35', fontSize: '0.9rem' }}>{success}</p> : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
              <button type="button" onClick={goToLogin}>Back to login</button>
              <button type="submit" disabled={submitting || Boolean(success)}>
                {submitting ? 'Saving...' : 'Save password'}
              </button>
            </div>
          </form>
        ) : null}
        {!loadingLink && !canReset ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
            <button type="button" onClick={goToLogin}>Back to login</button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default ResetPassword
