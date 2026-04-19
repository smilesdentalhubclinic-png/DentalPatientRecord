const express = require('express');
const crypto = require('crypto');
const { createSupabaseClient } = require('../supabase');
const config = require('../config');
const {
  getBearerToken,
  getSessionClaims,
  requireAccessToken,
} = require('../middleware/auth');
const { sendSupabaseError } = require('../lib/response');
const {
  isSmtpConfigured,
  sendEmailChangeVerificationEmail,
  sendFailedLoginAlertEmail,
  sendPasswordResetVerificationEmail,
  sendStaffOnboardingVerificationEmail,
  sendWelcomeTestEmail,
} = require('../lib/mailer');

const router = express.Router();
const failedLoginAlertStore = new Map();
const EMAIL_CHANGE_CODE_EXPIRY_MS = 10 * 60 * 1000;
const EMAIL_CHANGE_MAX_ATTEMPTS = 5;
const PASSWORD_RESET_CODE_EXPIRY_MS = 10 * 60 * 1000;
const PASSWORD_RESET_MAX_ATTEMPTS = 5;
const FAILED_LOGIN_ALERT_THRESHOLD = 4;
const FAILED_LOGIN_TRACKING_WINDOW_MS = 30 * 60 * 1000;
const VERIFICATION_PURPOSE = Object.freeze({
  EMAIL_CHANGE: 'email_change',
  STAFF_ONBOARDING: 'staff_onboarding',
  PASSWORD_RESET: 'password_reset',
});

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function setActiveStaffSession(serviceClient, userId, sessionId) {
  if (!userId || !sessionId) {
    throw new Error('Unable to determine active session.');
  }

  const { error } = await serviceClient
    .from('staff_profiles')
    .update({
      active_session_id: sessionId,
      active_session_updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  if (error) throw error;
}

async function clearActiveStaffSession(serviceClient, userId, sessionId) {
  if (!userId || !sessionId) return;

  const { error } = await serviceClient
    .from('staff_profiles')
    .update({
      active_session_id: null,
      active_session_updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('active_session_id', sessionId);

  if (error) throw error;
}

function isLetterOnlyName(value, { allowEmpty = false } = {}) {
  const normalized = normalizeString(value).replace(/\s+/g, ' ');
  if (!normalized) return allowEmpty;
  return /^[A-Za-z]+(?: [A-Za-z]+)*$/.test(normalized);
}

function mergeUserMetadata(user, updates = {}) {
  return {
    ...(user?.user_metadata && typeof user.user_metadata === 'object' ? user.user_metadata : {}),
    ...updates,
  };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

function isPlaceholderStaffEmail(email) {
  const normalized = normalizeString(email).toLowerCase();
  return normalized.endsWith('@smilesdentalhub.local') || normalized.endsWith('@dent22.local');
}

function createSixDigitCode() {
  return crypto.randomInt(100000, 1000000).toString();
}

function hashVerificationCode(code) {
  return crypto.createHash('sha256').update(normalizeString(code)).digest('hex');
}

function getVerificationMetadata(record) {
  return record?.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
    ? record.metadata
    : {};
}

async function deleteVerificationRecord({ purpose, userId = null, email = '' }) {
  const normalizedEmail = normalizeString(email).toLowerCase();
  const serviceClient = createSupabaseClient({ useServiceRole: true });
  let query = serviceClient
    .from('verification_codes')
    .delete()
    .eq('purpose', purpose);

  if (userId) {
    query = query.eq('user_id', userId);
  } else {
    query = query.eq('email', normalizedEmail);
  }

  const { error } = await query;
  if (error) throw error;
}

async function storeVerificationRecord({ purpose, userId = null, email, code, expiresInMs, metadata = {} }) {
  const normalizedEmail = normalizeString(email).toLowerCase();
  const serviceClient = createSupabaseClient({ useServiceRole: true });

  await deleteVerificationRecord({ purpose, userId, email: normalizedEmail });

  const { error } = await serviceClient
    .from('verification_codes')
    .insert({
      purpose,
      user_id: userId || null,
      email: normalizedEmail,
      code_hash: hashVerificationCode(code),
      metadata,
      attempts: 0,
      expires_at: new Date(Date.now() + expiresInMs).toISOString(),
    });

  if (error) throw error;
}

async function getVerificationRecord({ purpose, userId = null, email = '' }) {
  const normalizedEmail = normalizeString(email).toLowerCase();
  const serviceClient = createSupabaseClient({ useServiceRole: true });
  let query = serviceClient
    .from('verification_codes')
    .select('id, purpose, user_id, email, code_hash, metadata, attempts, expires_at, created_at')
    .eq('purpose', purpose)
    .order('created_at', { ascending: false })
    .limit(1);

  if (userId) {
    query = query.eq('user_id', userId);
  } else {
    query = query.eq('email', normalizedEmail);
  }

  const { data, error } = await query;
  if (error) throw error;
  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}

async function incrementVerificationAttempts(recordId, attempts) {
  const serviceClient = createSupabaseClient({ useServiceRole: true });
  const { error } = await serviceClient
    .from('verification_codes')
    .update({ attempts })
    .eq('id', recordId);
  if (error) throw error;
}

function getFailedLoginAlertEntry(email) {
  const normalizedEmail = normalizeString(email).toLowerCase();
  if (!normalizedEmail) return null;

  const now = Date.now();
  const existingEntry = failedLoginAlertStore.get(normalizedEmail);
  if (!existingEntry) {
    return {
      email: normalizedEmail,
      count: 0,
      firstFailedAt: now,
      lastFailedAt: now,
    };
  }

  if ((now - Number(existingEntry.lastFailedAt || 0)) > FAILED_LOGIN_TRACKING_WINDOW_MS) {
    failedLoginAlertStore.delete(normalizedEmail);
    return {
      email: normalizedEmail,
      count: 0,
      firstFailedAt: now,
      lastFailedAt: now,
    };
  }

  return existingEntry;
}

function clearFailedLoginAlertEntry(email) {
  const normalizedEmail = normalizeString(email).toLowerCase();
  if (!normalizedEmail) return;
  failedLoginAlertStore.delete(normalizedEmail);
}

async function recordFailedLoginAttempt(email) {
  const entry = getFailedLoginAlertEntry(email);
  if (!entry?.email) return;

  const now = Date.now();
  entry.count += 1;
  entry.lastFailedAt = now;
  failedLoginAlertStore.set(entry.email, entry);

  if (!isSmtpConfigured()) return;
  if (entry.count < FAILED_LOGIN_ALERT_THRESHOLD) return;
  if (entry.count % FAILED_LOGIN_ALERT_THRESHOLD !== 0) return;

  await sendFailedLoginAlertEmail({
    toEmail: entry.email,
    attemptedAt: new Date(now).toISOString(),
    failedAttempts: entry.count,
  });
}

async function findAuthUserByEmail(serviceClient, email) {
  const normalizedEmail = normalizeString(email).toLowerCase();
  if (!normalizedEmail) return null;

  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await serviceClient.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const users = Array.isArray(data?.users) ? data.users : [];
    const match = users.find((user) => normalizeString(user?.email).toLowerCase() === normalizedEmail);
    if (match) return match;
    if (users.length < perPage) return null;

    page += 1;
  }
}

async function updateEmailForUser({ userId, email }) {
  if (!config.supabaseServiceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for email updates.');
  }

  const serviceClient = createSupabaseClient({ useServiceRole: true });

  const { data: existingProfiles, error: existingProfilesError } = await serviceClient
    .from('staff_profiles')
    .select('user_id, email')
    .eq('email', email)
    .neq('user_id', userId)
    .limit(1);
  if (existingProfilesError) throw existingProfilesError;
  if (Array.isArray(existingProfiles) && existingProfiles.length > 0) {
    const duplicateError = new Error('Email already exists.');
    duplicateError.status = 409;
    throw duplicateError;
  }

  const existingAuthUser = await findAuthUserByEmail(serviceClient, email);
  if (existingAuthUser && existingAuthUser.id !== userId) {
    const duplicateError = new Error('This email already exists in Supabase Authentication.');
    duplicateError.status = 409;
    throw duplicateError;
  }

  const { error: authUpdateError } = await serviceClient.auth.admin.updateUserById(userId, {
    email,
    email_confirm: true,
  });
  if (authUpdateError) {
    if (/already been registered|user already registered|email address has already been registered|email.*exists/i.test(authUpdateError.message || '')) {
      const duplicateError = new Error('Email already exists in Supabase Authentication.');
      duplicateError.status = 409;
      duplicateError.code = authUpdateError.code || null;
      duplicateError.details = authUpdateError.details || null;
      duplicateError.hint = authUpdateError.hint || null;
      throw duplicateError;
    }
    throw authUpdateError;
  }

  const { error: profileUpdateError } = await serviceClient
    .from('staff_profiles')
    .update({ email })
    .eq('user_id', userId);
  if (profileUpdateError) throw profileUpdateError;
}

async function requireAdminRequester(accessToken) {
  const requesterClient = createSupabaseClient({ accessToken });
  const { data: requesterUserData, error: requesterUserError } = await requesterClient.auth.getUser();
  if (requesterUserError || !requesterUserData?.user?.id) {
    return {
      errorResponse: {
        status: 401,
        payload: requesterUserError || { message: 'Unable to resolve authenticated user.' },
      },
    };
  }

  const serviceClient = createSupabaseClient({ useServiceRole: true });
  const { data: requesterProfile, error: requesterProfileError } = await serviceClient
    .from('staff_profiles')
    .select('user_id, full_name, role, is_active')
    .eq('user_id', requesterUserData.user.id)
    .maybeSingle();

  if (requesterProfileError) {
    return {
      errorResponse: {
        status: 403,
        payload: requesterProfileError,
      },
    };
  }

  if (!requesterProfile || !requesterProfile.is_active || requesterProfile.role !== 'admin') {
    return {
      errorResponse: {
        status: 403,
        payload: { error: 'Forbidden: admin role required.' },
      },
    };
  }

  return {
    requesterUserData,
    requesterProfile,
    serviceClient,
  };
}

async function cleanupNullableUserReferences(serviceClient, userId) {
  const nullableReferences = [
    ['patients', 'updated_by'],
    ['patients', 'archived_by'],
    ['services', 'updated_by'],
    ['tooth_conditions', 'updated_by'],
    ['service_records', 'performed_by'],
    ['service_records', 'updated_by'],
    ['service_records', 'archived_by'],
    ['dental_records', 'updated_by'],
    ['dental_records', 'archived_by'],
    ['patient_documents', 'updated_by'],
    ['patient_documents', 'archived_by'],
  ];

  for (const [table, column] of nullableReferences) {
    const { error } = await serviceClient
      .from(table)
      .update({ [column]: null })
      .eq(column, userId);
    if (error) throw error;
  }
}

async function collectHardDeleteUserBlockers(serviceClient, userId) {
  const nonNullableReferences = [
    ['patients', 'created_by', 'patient records created by this user'],
    ['patient_logs', 'created_by', 'patient log entries created by this user'],
    ['services', 'created_by', 'services created by this user'],
    ['tooth_conditions', 'created_by', 'dental chart legends created by this user'],
    ['service_records', 'created_by', 'service records created by this user'],
    ['dental_records', 'created_by', 'dental records created by this user'],
    ['patient_documents', 'created_by', 'patient documents created by this user'],
    ['archive_events', 'performed_by', 'archive history events performed by this user'],
  ];

  const blockers = [];

  for (const [table, column, label] of nonNullableReferences) {
    const { count, error } = await serviceClient
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq(column, userId);
    if (error) throw error;
    if ((count || 0) > 0) {
      blockers.push(`${count} ${label}`);
    }
  }

  return blockers;
}

async function requireAuthenticatedRequester(accessToken) {
  const requesterClient = createSupabaseClient({ accessToken });
  const { data: requesterUserData, error: requesterUserError } = await requesterClient.auth.getUser();
  if (requesterUserError || !requesterUserData?.user?.id) {
    return {
      errorResponse: {
        status: 401,
        payload: requesterUserError || { message: 'Unable to resolve authenticated user.' },
      },
    };
  }

  const serviceClient = createSupabaseClient({ useServiceRole: true });
  const { data: requesterProfile, error: requesterProfileError } = await serviceClient
    .from('staff_profiles')
    .select('user_id, full_name, email, username, role, is_active, first_name, middle_name, last_name, suffix, birth_date, mobile_number, address')
    .eq('user_id', requesterUserData.user.id)
    .maybeSingle();

  if (requesterProfileError) {
    return {
      errorResponse: {
        status: 403,
        payload: requesterProfileError,
      },
    };
  }

  if (!requesterProfile || !requesterProfile.is_active) {
    return {
      errorResponse: {
        status: 403,
        payload: { error: 'Account is not provisioned for system access.' },
      },
    };
  }

  return {
    requesterUserData,
    requesterProfile,
    serviceClient,
  };
}

async function resolveLoginEmail(login) {
  const normalizedLogin = normalizeString(login);
  if (!normalizedLogin) return '';
  if (EMAIL_PATTERN.test(normalizedLogin)) {
    return normalizedLogin.toLowerCase();
  }

  const client = createSupabaseClient();
  const { data, error } = await client.rpc('resolve_login_email', { p_username: normalizedLogin });
  if (error) throw error;
  return normalizeString(data);
}

router.post('/login', async (req, res) => {
  try {
    const login = normalizeString(req.body?.login);
    const password = normalizeString(req.body?.password);

    if (!login || !password) {
      return res.status(400).json({ error: 'login and password are required.' });
    }

    const resolvedEmail = await resolveLoginEmail(login);
    if (!resolvedEmail) {
      return res.status(401).json({ error: 'Invalid username/email or password.' });
    }

    const client = createSupabaseClient();
    const { data, error } = await client.auth.signInWithPassword({
      email: resolvedEmail,
      password,
    });

    if (error) {
      if (/invalid login credentials|invalid credentials|email not confirmed|invalid grant/i.test(error.message || '')) {
        try {
          await recordFailedLoginAttempt(resolvedEmail);
        } catch (alertError) {
          console.error('Failed to send failed-login alert email:', alertError);
        }
      }

      return sendSupabaseError(res, error, 401);
    }

    clearFailedLoginAlertEntry(resolvedEmail);

    const serviceClient = createSupabaseClient({ useServiceRole: true });
    const sessionAccessToken = data.session?.access_token || '';
    const { userId, sessionId } = getSessionClaims(sessionAccessToken);
    await setActiveStaffSession(serviceClient, userId || data.user?.id, sessionId);

    return res.json({
      message: 'Login successful.',
      user: data.user,
      session: data.session,
    });
  } catch (error) {
    return sendSupabaseError(res, error);
  }
});

router.post('/forgot-password', async (req, res) => {
  try {
    if (!config.supabaseServiceRoleKey) {
      return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is required for password resets.' });
    }

    const login = normalizeString(req.body?.login);

    if (!login) {
      return res.status(400).json({ error: 'email is required.' });
    }
    if (!EMAIL_PATTERN.test(login)) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }
    if (!isSmtpConfigured()) {
      return res.status(500).json({ error: 'SMTP is not configured for verification emails.' });
    }

    const resolvedEmail = login.toLowerCase();
    if (!resolvedEmail) {
      return res.status(404).json({ error: 'No active staff account found for that email.' });
    }

    const serviceClient = createSupabaseClient({ useServiceRole: true });
    const existingAuthUser = await findAuthUserByEmail(serviceClient, resolvedEmail);
    if (!existingAuthUser?.id) {
      return res.status(404).json({ error: 'No active staff account found for that email.' });
    }

    const code = createSixDigitCode();

    await storeVerificationRecord({
      purpose: VERIFICATION_PURPOSE.PASSWORD_RESET,
      userId: existingAuthUser.id,
      email: resolvedEmail,
      code,
      expiresInMs: PASSWORD_RESET_CODE_EXPIRY_MS,
    });

    await sendPasswordResetVerificationEmail({
      toEmail: resolvedEmail,
      code,
      expiresInMinutes: Math.round(PASSWORD_RESET_CODE_EXPIRY_MS / 60000),
    });

    return res.json({
      message: 'Verification code sent to email.',
      email: resolvedEmail,
      expiresInMinutes: Math.round(PASSWORD_RESET_CODE_EXPIRY_MS / 60000),
    });
  } catch (error) {
    return sendSupabaseError(res, error);
  }
});

router.post('/verify-reset-code', async (req, res) => {
  try {
    if (!config.supabaseServiceRoleKey) {
      return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is required for password resets.' });
    }

    const login = normalizeString(req.body?.login);
    const code = normalizeString(req.body?.code);

    if (!login || !code) {
      return res.status(400).json({ error: 'email and code are required.' });
    }
    if (!EMAIL_PATTERN.test(login)) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Verification code must be exactly 6 digits.' });
    }

    const resolvedEmail = login.toLowerCase();
    if (!resolvedEmail) {
      return res.status(404).json({ error: 'No active staff account found for that email.' });
    }

    const storedVerification = await getVerificationRecord({
      purpose: VERIFICATION_PURPOSE.PASSWORD_RESET,
      email: resolvedEmail,
    });
    if (!storedVerification) {
      return res.status(400).json({ error: 'No pending password reset request was found.' });
    }
    if (new Date(storedVerification.expires_at).getTime() < Date.now()) {
      await deleteVerificationRecord({
        purpose: VERIFICATION_PURPOSE.PASSWORD_RESET,
        email: resolvedEmail,
      });
      return res.status(400).json({ error: 'Verification code expired. Please request a new one.' });
    }
    if (storedVerification.attempts >= PASSWORD_RESET_MAX_ATTEMPTS) {
      await deleteVerificationRecord({
        purpose: VERIFICATION_PURPOSE.PASSWORD_RESET,
        email: resolvedEmail,
      });
      return res.status(400).json({ error: 'Too many invalid attempts. Please request a new code.' });
    }
    if (storedVerification.code_hash !== hashVerificationCode(code)) {
      await incrementVerificationAttempts(storedVerification.id, storedVerification.attempts + 1);
      return res.status(400).json({ error: 'Invalid verification code.' });
    }

    return res.json({
      message: 'Code verified.',
      email: resolvedEmail,
    });
  } catch (error) {
    return sendSupabaseError(res, error);
  }
});

router.post('/refresh-session', async (req, res) => {
  try {
    const refreshToken = normalizeString(req.body?.refreshToken);
    if (!refreshToken) {
      return res.status(400).json({ error: 'refreshToken is required.' });
    }

    const client = createSupabaseClient();
    const { data, error } = await client.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error) return sendSupabaseError(res, error, 401);

    const serviceClient = createSupabaseClient({ useServiceRole: true });
    const sessionAccessToken = data.session?.access_token || '';
    const { userId, sessionId } = getSessionClaims(sessionAccessToken);
    await setActiveStaffSession(serviceClient, userId || data.user?.id, sessionId);

    return res.json({
      message: 'Session refreshed.',
      session: data.session,
      user: data.user,
    });
  } catch (error) {
    return sendSupabaseError(res, error, 500);
  }
});

router.get('/me', requireAccessToken, async (req, res) => {
  try {
    const client = createSupabaseClient({ accessToken: req.accessToken });
    const { data, error } = await client.auth.getUser();

    if (error) return sendSupabaseError(res, error, 401);

    return res.json({ user: data.user });
  } catch (error) {
    return sendSupabaseError(res, error, 500);
  }
});

router.post('/update-password', requireAccessToken, async (req, res) => {
  try {
    const newPassword = normalizeString(req.body?.newPassword);
    if (!newPassword) {
      return res.status(400).json({ error: 'newPassword is required.' });
    }

    if (!config.supabaseServiceRoleKey) {
      return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is required for password updates.' });
    }

    const client = createSupabaseClient({ accessToken: req.accessToken });
    const { data: currentUserData, error: currentUserError } = await client.auth.getUser();
    if (currentUserError || !currentUserData?.user?.id) {
      return sendSupabaseError(res, currentUserError || { message: 'Unable to load current user.' }, 401);
    }

    const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${req.accessToken}`,
      },
      body: JSON.stringify({ password: newPassword }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({
        error: payload?.msg || payload?.message || 'Unable to update password.',
        code: payload?.error_code || null,
        details: payload?.error_description || null,
        hint: null,
      });
    }

    const passwordUpdatedAt = new Date().toISOString();
    const serviceClient = createSupabaseClient({ useServiceRole: true });
    const { data: updatedUserData, error: metadataUpdateError } = await serviceClient.auth.admin.updateUserById(currentUserData.user.id, {
      user_metadata: mergeUserMetadata(payload?.user || currentUserData.user, {
        password_updated_at: passwordUpdatedAt,
      }),
    });
    if (metadataUpdateError) return sendSupabaseError(res, metadataUpdateError, 500);

    return res.json({
      message: 'Password updated successfully.',
      passwordUpdatedAt,
      user: updatedUserData?.user || payload?.user || null,
    });
  } catch (error) {
    return sendSupabaseError(res, error, 500);
  }
});

router.post('/complete-forgot-password', async (req, res) => {
  try {
    if (!config.supabaseServiceRoleKey) {
      return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is required for password resets.' });
    }

    const login = normalizeString(req.body?.login);
    const code = normalizeString(req.body?.code);
    const newPassword = normalizeString(req.body?.newPassword);

    if (!login || !code || !newPassword) {
      return res.status(400).json({ error: 'email, code, and newPassword are required.' });
    }
    if (!EMAIL_PATTERN.test(login)) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Verification code must be exactly 6 digits.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const resolvedEmail = login.toLowerCase();
    if (!resolvedEmail) {
      return res.status(404).json({ error: 'No active staff account found for that email.' });
    }

    const storedVerification = await getVerificationRecord({
      purpose: VERIFICATION_PURPOSE.PASSWORD_RESET,
      email: resolvedEmail,
    });
    if (!storedVerification) {
      return res.status(400).json({ error: 'No pending password reset request was found.' });
    }
    if (new Date(storedVerification.expires_at).getTime() < Date.now()) {
      await deleteVerificationRecord({
        purpose: VERIFICATION_PURPOSE.PASSWORD_RESET,
        email: resolvedEmail,
      });
      return res.status(400).json({ error: 'Verification code expired. Please request a new one.' });
    }
    if (storedVerification.attempts >= PASSWORD_RESET_MAX_ATTEMPTS) {
      await deleteVerificationRecord({
        purpose: VERIFICATION_PURPOSE.PASSWORD_RESET,
        email: resolvedEmail,
      });
      return res.status(400).json({ error: 'Too many invalid attempts. Please request a new code.' });
    }
    if (storedVerification.code_hash !== hashVerificationCode(code)) {
      await incrementVerificationAttempts(storedVerification.id, storedVerification.attempts + 1);
      return res.status(400).json({ error: 'Invalid verification code.' });
    }

    const serviceClient = createSupabaseClient({ useServiceRole: true });
    const passwordUpdatedAt = new Date().toISOString();
    const { data: existingUserData, error: existingUserError } = await serviceClient.auth.admin.getUserById(storedVerification.user_id);
    if (existingUserError || !existingUserData?.user) {
      return sendSupabaseError(res, existingUserError || { message: 'Unable to load user for password reset.' }, 400);
    }

    const { error } = await serviceClient.auth.admin.updateUserById(storedVerification.user_id, {
      password: newPassword,
      user_metadata: mergeUserMetadata(existingUserData.user, {
        password_updated_at: passwordUpdatedAt,
      }),
    });
    if (error) return sendSupabaseError(res, error, 400);

    await deleteVerificationRecord({
      purpose: VERIFICATION_PURPOSE.PASSWORD_RESET,
      email: resolvedEmail,
    });

    return res.json({
      message: 'Password updated successfully.',
      email: resolvedEmail,
      passwordUpdatedAt,
    });
  } catch (error) {
    return sendSupabaseError(res, error, 500);
  }
});

router.post('/update-email', requireAccessToken, async (req, res) => {
  try {
    if (!config.supabaseServiceRoleKey) {
      return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is required for email updates.' });
    }

    const nextEmail = normalizeString(req.body?.email).toLowerCase();
    if (!nextEmail) {
      return res.status(400).json({ error: 'email is required.' });
    }
    if (!EMAIL_PATTERN.test(nextEmail)) {
      return res.status(400).json({ error: 'Invalid email format.' });
    }

    const requesterClient = createSupabaseClient({ accessToken: req.accessToken });
    const { data: requesterUserData, error: requesterUserError } = await requesterClient.auth.getUser();
    if (requesterUserError || !requesterUserData?.user?.id) {
      return sendSupabaseError(res, requesterUserError || { message: 'Unable to resolve authenticated user.' }, 401);
    }

    const currentEmail = normalizeString(requesterUserData.user.email).toLowerCase();
    if (currentEmail === nextEmail) {
      return res.json({ message: 'Email unchanged.', email: nextEmail });
    }

    await updateEmailForUser({
      userId: requesterUserData.user.id,
      email: nextEmail,
    });

    return res.json({
      message: 'Email updated successfully.',
      email: nextEmail,
    });
  } catch (error) {
    return sendSupabaseError(res, error, 500);
  }
});

router.post('/request-email-change-code', requireAccessToken, async (req, res) => {
  try {
    if (!config.supabaseServiceRoleKey) {
      return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is required for email updates.' });
    }

    const nextEmail = normalizeString(req.body?.email).toLowerCase();
    if (!nextEmail) {
      return res.status(400).json({ error: 'email is required.' });
    }
    if (!EMAIL_PATTERN.test(nextEmail)) {
      return res.status(400).json({ error: 'Invalid email format.' });
    }
    if (!isSmtpConfigured()) {
      return res.status(500).json({ error: 'SMTP is not configured for verification emails.' });
    }

    const requesterClient = createSupabaseClient({ accessToken: req.accessToken });
    const { data: requesterUserData, error: requesterUserError } = await requesterClient.auth.getUser();
    if (requesterUserError || !requesterUserData?.user?.id) {
      return sendSupabaseError(res, requesterUserError || { message: 'Unable to resolve authenticated user.' }, 401);
    }

    const currentEmail = normalizeString(requesterUserData.user.email).toLowerCase();
    if (currentEmail === nextEmail) {
      return res.status(400).json({ error: 'Please enter a different email address.' });
    }

    const serviceClient = createSupabaseClient({ useServiceRole: true });
    const { data: existingProfiles, error: existingProfilesError } = await serviceClient
      .from('staff_profiles')
      .select('user_id, email')
      .eq('email', nextEmail)
      .neq('user_id', requesterUserData.user.id)
      .limit(1);
    if (existingProfilesError) {
      return sendSupabaseError(res, existingProfilesError, 500);
    }
    if (Array.isArray(existingProfiles) && existingProfiles.length > 0) {
      return res.status(409).json({ error: 'That email is already being used by another account.' });
    }

    const code = createSixDigitCode();

    await storeVerificationRecord({
      purpose: VERIFICATION_PURPOSE.EMAIL_CHANGE,
      userId: requesterUserData.user.id,
      email: nextEmail,
      code,
      expiresInMs: EMAIL_CHANGE_CODE_EXPIRY_MS,
    });

    await sendEmailChangeVerificationEmail({
      toEmail: nextEmail,
      code,
      requestedBy: requesterUserData.user.email || 'Smiles Dental Hub',
      expiresInMinutes: Math.round(EMAIL_CHANGE_CODE_EXPIRY_MS / 60000),
    });

    return res.json({
      message: 'Verification code sent to email.',
      email: nextEmail,
      expiresInMinutes: Math.round(EMAIL_CHANGE_CODE_EXPIRY_MS / 60000),
    });
  } catch (error) {
    return sendSupabaseError(res, error, 500);
  }
});

router.post('/verify-email-change-code', requireAccessToken, async (req, res) => {
  try {
    if (!config.supabaseServiceRoleKey) {
      return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is required for email updates.' });
    }

    const nextEmail = normalizeString(req.body?.email).toLowerCase();
    const code = normalizeString(req.body?.code);

    if (!nextEmail || !code) {
      return res.status(400).json({ error: 'email and code are required.' });
    }

    const requesterClient = createSupabaseClient({ accessToken: req.accessToken });
    const { data: requesterUserData, error: requesterUserError } = await requesterClient.auth.getUser();
    if (requesterUserError || !requesterUserData?.user?.id) {
      return sendSupabaseError(res, requesterUserError || { message: 'Unable to resolve authenticated user.' }, 401);
    }

    const storedVerification = await getVerificationRecord({
      purpose: VERIFICATION_PURPOSE.EMAIL_CHANGE,
      userId: requesterUserData.user.id,
    });
    if (!storedVerification) {
      return res.status(400).json({ error: 'No active email verification request found.' });
    }

    if (new Date(storedVerification.expires_at).getTime() < Date.now()) {
      await deleteVerificationRecord({
        purpose: VERIFICATION_PURPOSE.EMAIL_CHANGE,
        userId: requesterUserData.user.id,
      });
      return res.status(400).json({ error: 'Verification code expired. Please request a new one.' });
    }

    if (storedVerification.email !== nextEmail) {
      return res.status(400).json({ error: 'The email does not match the pending verification request.' });
    }

    if (storedVerification.attempts >= EMAIL_CHANGE_MAX_ATTEMPTS) {
      await deleteVerificationRecord({
        purpose: VERIFICATION_PURPOSE.EMAIL_CHANGE,
        userId: requesterUserData.user.id,
      });
      return res.status(400).json({ error: 'Too many invalid attempts. Please request a new code.' });
    }

    if (storedVerification.code_hash !== hashVerificationCode(code)) {
      await incrementVerificationAttempts(storedVerification.id, storedVerification.attempts + 1);
      return res.status(400).json({ error: 'Invalid verification code.' });
    }

    await updateEmailForUser({
      userId: requesterUserData.user.id,
      email: nextEmail,
    });

    await deleteVerificationRecord({
      purpose: VERIFICATION_PURPOSE.EMAIL_CHANGE,
      userId: requesterUserData.user.id,
    });

    return res.json({
      message: 'Email updated successfully.',
      email: nextEmail,
    });
  } catch (error) {
    return sendSupabaseError(res, error, 500);
  }
});

router.post('/start-staff-onboarding', requireAccessToken, async (req, res) => {
  try {
    if (!config.supabaseServiceRoleKey) {
      return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is required for onboarding verification.' });
    }

    const nextEmail = normalizeString(req.body?.email).toLowerCase();
    const birthDate = normalizeString(req.body?.birthDate) || null;
    const mobileNumber = normalizeString(req.body?.mobileNumber);
    const address = normalizeString(req.body?.address);
    const birthDateValue = birthDate ? new Date(`${birthDate}T00:00:00`) : null;
    const today = new Date();
    const minimumAdultDate = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate());

    if (!nextEmail || !birthDate || !mobileNumber || !address) {
      return res.status(400).json({ error: 'email, birthDate, mobileNumber, and address are required.' });
    }
    if (!EMAIL_PATTERN.test(nextEmail)) {
      return res.status(400).json({ error: 'Invalid email format.' });
    }
    if (!(birthDateValue instanceof Date) || Number.isNaN(birthDateValue.getTime())) {
      return res.status(400).json({ error: 'Invalid birth date.' });
    }
    if (birthDateValue > minimumAdultDate) {
      return res.status(400).json({ error: 'You must be at least 18 years old.' });
    }
    if (!/^\+639\d{9}$/.test(mobileNumber)) {
      return res.status(400).json({ error: 'Enter a valid Philippine mobile number.' });
    }
    if (isPlaceholderStaffEmail(nextEmail)) {
      return res.status(400).json({ error: 'Please enter your real email address.' });
    }
    if (!isSmtpConfigured()) {
      return res.status(500).json({ error: 'SMTP is not configured for verification emails.' });
    }

    const requesterContext = await requireAuthenticatedRequester(req.accessToken);
    if (requesterContext.errorResponse) {
      const { status, payload } = requesterContext.errorResponse;
      return payload?.error ? res.status(status).json(payload) : sendSupabaseError(res, payload, status);
    }

    const { requesterUserData, requesterProfile } = requesterContext;
    const existingAuthUser = await findAuthUserByEmail(requesterContext.serviceClient, nextEmail);

    if (existingAuthUser && existingAuthUser.id !== requesterUserData.user.id) {
      return res.status(409).json({
        error: 'This email already exists in Supabase Authentication. Use a different email or delete the old auth user first.',
      });
    }

    const code = createSixDigitCode();

    await storeVerificationRecord({
      purpose: VERIFICATION_PURPOSE.STAFF_ONBOARDING,
      userId: requesterUserData.user.id,
      email: nextEmail,
      code,
      expiresInMs: EMAIL_CHANGE_CODE_EXPIRY_MS,
      metadata: {
        birthDate,
        mobileNumber,
        address,
      },
    });

    await sendStaffOnboardingVerificationEmail({
      toEmail: nextEmail,
      code,
      requestedBy: requesterProfile.full_name || requesterUserData.user.email || 'Smiles Dental Hub',
      expiresInMinutes: Math.round(EMAIL_CHANGE_CODE_EXPIRY_MS / 60000),
    });

    return res.json({
      message: 'Verification code sent to email.',
      email: nextEmail,
      expiresInMinutes: Math.round(EMAIL_CHANGE_CODE_EXPIRY_MS / 60000),
    });
  } catch (error) {
    return sendSupabaseError(res, error, 500);
  }
});

router.post('/verify-staff-onboarding', requireAccessToken, async (req, res) => {
  try {
    if (!config.supabaseServiceRoleKey) {
      return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is required for onboarding verification.' });
    }

    const nextEmail = normalizeString(req.body?.email).toLowerCase();
    const code = normalizeString(req.body?.code);

    if (!nextEmail || !code) {
      return res.status(400).json({ error: 'email and code are required.' });
    }

    const requesterContext = await requireAuthenticatedRequester(req.accessToken);
    if (requesterContext.errorResponse) {
      const { status, payload } = requesterContext.errorResponse;
      return payload?.error ? res.status(status).json(payload) : sendSupabaseError(res, payload, status);
    }

    const { requesterUserData, serviceClient } = requesterContext;
    const storedVerification = await getVerificationRecord({
      purpose: VERIFICATION_PURPOSE.STAFF_ONBOARDING,
      userId: requesterUserData.user.id,
    });
    const storedMetadata = getVerificationMetadata(storedVerification);

    if (!storedVerification) {
      return res.status(400).json({ error: 'No pending onboarding verification found.' });
    }
    if (new Date(storedVerification.expires_at).getTime() < Date.now()) {
      await deleteVerificationRecord({
        purpose: VERIFICATION_PURPOSE.STAFF_ONBOARDING,
        userId: requesterUserData.user.id,
      });
      return res.status(400).json({ error: 'Verification code expired. Please request a new one.' });
    }
    if (storedVerification.email !== nextEmail) {
      return res.status(400).json({ error: 'The email does not match the pending verification request.' });
    }
    if (storedVerification.attempts >= EMAIL_CHANGE_MAX_ATTEMPTS) {
      await deleteVerificationRecord({
        purpose: VERIFICATION_PURPOSE.STAFF_ONBOARDING,
        userId: requesterUserData.user.id,
      });
      return res.status(400).json({ error: 'Too many invalid attempts. Please request a new code.' });
    }
    if (storedVerification.code_hash !== hashVerificationCode(code)) {
      await incrementVerificationAttempts(storedVerification.id, storedVerification.attempts + 1);
      return res.status(400).json({ error: 'Invalid verification code.' });
    }

    await updateEmailForUser({
      userId: requesterUserData.user.id,
      email: nextEmail,
    });

    const { error: profileUpdateError } = await serviceClient
      .from('staff_profiles')
      .update({
        birth_date: normalizeString(storedMetadata.birthDate) || null,
        mobile_number: normalizeString(storedMetadata.mobileNumber) || null,
        address: normalizeString(storedMetadata.address) || null,
      })
      .eq('user_id', requesterUserData.user.id);
    if (profileUpdateError) return sendSupabaseError(res, profileUpdateError);

    await deleteVerificationRecord({
      purpose: VERIFICATION_PURPOSE.STAFF_ONBOARDING,
      userId: requesterUserData.user.id,
    });

    return res.json({
      message: 'Staff onboarding completed successfully.',
      email: nextEmail,
    });
  } catch (error) {
    return sendSupabaseError(res, error, 500);
  }
});

router.post('/admin-update-user-email', requireAccessToken, async (req, res) => {
  try {
    if (!config.supabaseServiceRoleKey) {
      return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is required for admin email updates.' });
    }

    const userId = normalizeString(req.body?.userId);
    const nextEmail = normalizeString(req.body?.email).toLowerCase();

    if (!userId || !nextEmail) {
      return res.status(400).json({ error: 'userId and email are required.' });
    }

    const adminContext = await requireAdminRequester(req.accessToken);
    if (adminContext.errorResponse) {
      const { status, payload } = adminContext.errorResponse;
      return payload?.error ? res.status(status).json(payload) : sendSupabaseError(res, payload, status);
    }

    const { serviceClient } = adminContext;

    const { data: targetProfile, error: targetProfileError } = await serviceClient
      .from('staff_profiles')
      .select('user_id, email')
      .eq('user_id', userId)
      .maybeSingle();

    if (targetProfileError) return sendSupabaseError(res, targetProfileError);
    if (!targetProfile) {
      return res.status(404).json({ error: 'User profile not found.' });
    }

    if (String(targetProfile.email || '').toLowerCase() === nextEmail) {
      return res.json({ message: 'Email unchanged.' });
    }

    const { error: authUpdateError } = await serviceClient.auth.admin.updateUserById(userId, {
      email: nextEmail,
      email_confirm: true,
    });
    if (authUpdateError) return sendSupabaseError(res, authUpdateError);

    const { error: profileUpdateError } = await serviceClient
      .from('staff_profiles')
      .update({ email: nextEmail })
      .eq('user_id', userId);
    if (profileUpdateError) return sendSupabaseError(res, profileUpdateError);

    return res.json({ message: 'User email updated successfully.' });
  } catch (error) {
    return sendSupabaseError(res, error, 500);
  }
});

router.post('/admin-create-user', requireAccessToken, async (req, res) => {
  try {
    if (!config.supabaseServiceRoleKey) {
      return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is required for admin user creation.' });
    }

    const email = normalizeString(req.body?.email).toLowerCase();
    const password = normalizeString(req.body?.password);
    const fullName = normalizeString(req.body?.fullName);
    const username = normalizeString(req.body?.username).toLowerCase();
    const role = normalizeString(req.body?.role);
    const firstName = normalizeString(req.body?.firstName);
    const middleName = normalizeString(req.body?.middleName);
    const lastName = normalizeString(req.body?.lastName);
    const suffix = normalizeString(req.body?.suffix);
    const birthDate = normalizeString(req.body?.birthDate) || null;
    const mobileNumber = normalizeString(req.body?.mobileNumber) || null;
    const address = normalizeString(req.body?.address) || null;

    if (!email || !password || !fullName || !username || !role) {
      return res.status(400).json({ error: 'email, password, fullName, username, and role are required.' });
    }
    if (!isLetterOnlyName(firstName) || !isLetterOnlyName(lastName) || !isLetterOnlyName(middleName, { allowEmpty: true })) {
      return res.status(400).json({ error: 'First name, last name, and middle name must contain letters only.' });
    }
    if (!EMAIL_PATTERN.test(email)) {
      return res.status(400).json({ error: 'Invalid email format.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    if (!['admin', 'receptionist', 'associate_dentist'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role.' });
    }

    const adminContext = await requireAdminRequester(req.accessToken);
    if (adminContext.errorResponse) {
      const { status, payload } = adminContext.errorResponse;
      return payload?.error ? res.status(status).json(payload) : sendSupabaseError(res, payload, status);
    }

    const { serviceClient } = adminContext;

    const { data: existingUsername, error: existingUsernameError } = await serviceClient
      .from('staff_profiles')
      .select('user_id')
      .eq('username', username)
      .maybeSingle();
    if (existingUsernameError) return sendSupabaseError(res, existingUsernameError);
    if (existingUsername) {
      return res.status(409).json({ error: 'Username already exists.' });
    }

    const { data: createdUserData, error: createUserError } = await serviceClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        role,
        full_name: fullName,
        username,
      },
      app_metadata: {
        provider: 'email',
        providers: ['email'],
      },
    });
    if (createUserError || !createdUserData?.user?.id) {
      if (createUserError && /already been registered|user already registered|email address has already been registered/i.test(createUserError.message || '')) {
        return res.status(409).json({
          error: 'This email still exists in Supabase Authentication. Delete the user from Authentication > Users, not only from your app tables.',
          code: createUserError.code || null,
          details: createUserError.details || null,
          hint: createUserError.hint || null,
        });
      }
      return sendSupabaseError(res, createUserError || { message: 'Unable to create user.' });
    }

    const { error: profileUpdateError } = await serviceClient
      .from('staff_profiles')
      .update({
        full_name: fullName,
        first_name: firstName || null,
        middle_name: middleName || null,
        last_name: lastName || null,
        suffix: suffix || null,
        birth_date: birthDate,
        mobile_number: mobileNumber,
        address,
        username,
        email,
        role,
        is_active: true,
      })
      .eq('user_id', createdUserData.user.id);

    if (profileUpdateError) {
      return sendSupabaseError(res, profileUpdateError);
    }

    return res.status(201).json({
      message: 'User created successfully.',
      userId: createdUserData.user.id,
    });
  } catch (error) {
    return sendSupabaseError(res, error, 500);
  }
});

router.post('/admin-send-user-welcome-email', requireAccessToken, async (req, res) => {
  try {
    const email = normalizeString(req.body?.email).toLowerCase();

    if (!email) {
      return res.status(400).json({ error: 'email is required.' });
    }
    if (!EMAIL_PATTERN.test(email)) {
      return res.status(400).json({ error: 'Invalid email format.' });
    }

    const adminContext = await requireAdminRequester(req.accessToken);
    if (adminContext.errorResponse) {
      const { status, payload } = adminContext.errorResponse;
      return payload?.error ? res.status(status).json(payload) : sendSupabaseError(res, payload, status);
    }

    const { requesterUserData, requesterProfile } = adminContext;

    if (!isSmtpConfigured()) {
      return res.status(500).json({
        error: 'SMTP is not configured on backend. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM_EMAIL in backend/.env.',
      });
    }

    await sendWelcomeTestEmail({
      toEmail: email,
      requestedBy: requesterProfile.full_name || requesterUserData.user.email || 'Admin',
    });

    return res.json({
      message: 'Test email sent.',
      email,
    });
  } catch (error) {
    return sendSupabaseError(res, error, 500);
  }
});

router.post('/logout', async (req, res) => {
  try {
    const accessToken = getBearerToken(req);
    if (!accessToken) {
      return res.status(400).json({
        error: 'Missing bearer token. Add Authorization: Bearer <access_token>.',
      });
    }

    const { userId, sessionId } = getSessionClaims(accessToken);
    const serviceClient = createSupabaseClient({ useServiceRole: true });
    await clearActiveStaffSession(serviceClient, userId, sessionId);

    const client = createSupabaseClient({ accessToken });
    const { error } = await client.auth.signOut();
    if (error) return sendSupabaseError(res, error);

    return res.json({ message: 'Logged out.' });
  } catch (error) {
    return sendSupabaseError(res, error, 500);
  }
});

module.exports = router;
