const express = require('express');
const { createSupabaseClient } = require('../supabase');
const { assertActiveStaffSession, getBearerToken } = require('../middleware/auth');
const { sendSupabaseError } = require('../lib/response');

const router = express.Router();

const RPC_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ANON_ALLOWED_RPC = new Set(['resolve_login_email']);

router.post('/:fn', async (req, res) => {
  try {
    const fn = (req.params.fn || '').trim();
    if (!RPC_PATTERN.test(fn)) {
      return res.status(400).json({ error: 'Invalid rpc function name.' });
    }

    const params = req.body?.params;
    const normalizedParams =
      params && typeof params === 'object' && !Array.isArray(params) ? params : {};

    const accessToken = getBearerToken(req);
    if (!accessToken && !ANON_ALLOWED_RPC.has(fn)) {
      return res.status(401).json({
        error:
          'This RPC requires authentication. Add Authorization: Bearer <access_token>.',
      });
    }

    if (accessToken) {
      const activeSession = await assertActiveStaffSession(accessToken);
      if (!activeSession.ok) {
        return res.status(activeSession.status).json(activeSession.payload);
      }
    }

    const client = createSupabaseClient({ accessToken });
    const { data, error } = await client.rpc(fn, normalizedParams);
    if (error) return sendSupabaseError(res, error);

    return res.json({ data });
  } catch (error) {
    return sendSupabaseError(res, error, 500);
  }
});

module.exports = router;
