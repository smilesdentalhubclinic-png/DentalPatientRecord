const { createSupabaseClient } = require('../supabase');

function normalizeAuditValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function writeSystemAuditLog({
  action,
  entityType,
  entityId = null,
  entityLabel = null,
  details = '',
  metadata = {},
  actorUserId = null,
  actorIdentifier = '',
  source = 'api',
} = {}) {
  const normalizedAction = normalizeAuditValue(action);
  const normalizedEntityType = normalizeAuditValue(entityType);

  if (!normalizedAction || !normalizedEntityType) return;

  try {
    const serviceClient = createSupabaseClient({ useServiceRole: true });
    const { error } = await serviceClient
      .from('system_audit_logs')
      .insert({
        action: normalizedAction,
        source: normalizeAuditValue(source) || 'api',
        entity_type: normalizedEntityType,
        entity_id: entityId ? String(entityId) : null,
        entity_label: normalizeAuditValue(entityLabel) || null,
        details: normalizeAuditValue(details) || null,
        metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {},
        actor_user_id: actorUserId || null,
        actor_identifier: normalizeAuditValue(actorIdentifier) || null,
      });

    if (error) {
      console.error('Failed to write system audit log:', error);
    }
  } catch (error) {
    console.error('Failed to write system audit log:', error);
  }
}

module.exports = {
  writeSystemAuditLog,
};
