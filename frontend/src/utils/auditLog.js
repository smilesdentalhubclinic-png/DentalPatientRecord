import { supabase } from '../lib/supabaseClient'

export async function recordSystemAudit({
  action,
  entityType,
  entityId = null,
  entityLabel = '',
  details = '',
  metadata = {},
  source = 'ui',
} = {}) {
  const normalizedAction = `${action ?? ''}`.trim()
  const normalizedEntityType = `${entityType ?? ''}`.trim()

  if (!normalizedAction || !normalizedEntityType) return

  try {
    const { error } = await supabase
      .from('system_audit_logs')
      .insert({
        action: normalizedAction,
        source,
        entity_type: normalizedEntityType,
        entity_id: entityId ? String(entityId) : null,
        entity_label: `${entityLabel ?? ''}`.trim() || null,
        details: `${details ?? ''}`.trim() || null,
        metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {},
      })

    if (error) {
      console.error('Unable to record audit log:', error)
    }
  } catch (error) {
    console.error('Unable to record audit log:', error)
  }
}
