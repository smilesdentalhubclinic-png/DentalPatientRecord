const { createSupabaseClient } = require('../supabase');

function getBearerToken(req) {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') return null;

  const [scheme, token] = header.split(' ');
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== 'bearer') return null;

  const normalizedToken = token.trim();
  return normalizedToken || null;
}

function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;

  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf-8'));
  } catch {
    return null;
  }
}

function getSessionClaims(accessToken) {
  const payload = decodeJwtPayload(accessToken);
  return {
    userId: typeof payload?.sub === 'string' ? payload.sub : '',
    sessionId: typeof payload?.session_id === 'string' ? payload.session_id : '',
  };
}

async function assertActiveStaffSession(accessToken) {
  const { userId, sessionId } = getSessionClaims(accessToken);
  if (!userId || !sessionId) {
    return {
      ok: false,
      status: 401,
      payload: { error: 'Invalid session token.' },
    };
  }

  const serviceClient = createSupabaseClient({ useServiceRole: true });
  const { data: profile, error } = await serviceClient
    .from('staff_profiles')
    .select('user_id, is_active, active_session_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      status: 500,
      payload: { error: error.message || 'Unable to validate active session.' },
    };
  }

  if (!profile?.user_id || !profile.is_active) {
    return {
      ok: false,
      status: 401,
      payload: { error: 'Account is not provisioned for system access.' },
    };
  }

  if (!profile.active_session_id || profile.active_session_id !== sessionId) {
    return {
      ok: false,
      status: 401,
      payload: {
        error: 'This account was logged in on another device or browser. Please log in again.',
        code: 'SESSION_REPLACED',
      },
    };
  }

  return {
    ok: true,
    userId,
    sessionId,
    profile,
  };
}

async function requireAccessToken(req, res, next) {
  const accessToken = getBearerToken(req);

  if (!accessToken) {
    return res.status(401).json({
      error: 'Missing bearer token. Add Authorization: Bearer <access_token>.',
    });
  }

  const activeSession = await assertActiveStaffSession(accessToken);
  if (!activeSession.ok) {
    return res.status(activeSession.status).json(activeSession.payload);
  }

  req.accessToken = accessToken;
  req.authenticatedUserId = activeSession.userId;
  req.authenticatedSessionId = activeSession.sessionId;
  return next();
}

module.exports = {
  assertActiveStaffSession,
  decodeJwtPayload,
  getBearerToken,
  getSessionClaims,
  requireAccessToken,
};
