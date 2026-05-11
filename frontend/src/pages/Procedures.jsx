import { useEffect, useMemo, useState } from 'react'
import ErrorModal from '../components/ErrorModal'
import { supabase } from '../lib/supabaseClient'
import useSessionStorageState, { UI_SESSION_STORAGE_PREFIX } from '../hooks/useSessionStorageState'
import { recordSystemAudit } from '../utils/auditLog'

const formatPrice = (value) => Number(value || 0).toLocaleString('en-PH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const parsePrice = (value) => {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue) || numericValue < 0) return null
  return numericValue
}

const toTitleCase = (value) => {
  const raw = `${value ?? ''}`
  if (!raw.trim()) return raw
  return raw
    .toLowerCase()
    .replace(/\b[a-z]/g, (match) => match.toUpperCase())
}

const sanitizeServiceNameInput = (value) => {
  const raw = `${value ?? ''}`
  return raw.replace(/[^a-zA-Z\s&'-]/g, '')
}

const sanitizeMoneyInput = (value) => {
  const raw = `${value ?? ''}`.replace(/[^0-9.]/g, '')
  const firstDotIndex = raw.indexOf('.')
  if (firstDotIndex === -1) return raw
  return `${raw.slice(0, firstDotIndex + 1)}${raw.slice(firstDotIndex + 1).replace(/\./g, '')}`
}

const normalizeLegendCode = (value) => `${value ?? ''}`.trim().toUpperCase()
const normalizeConditionName = (value) => `${value ?? ''}`.trim().replace(/\s+/g, ' ').toLowerCase()
const sanitizeLegendCodeInput = (value) => `${value ?? ''}`.toUpperCase().slice(0, 3)
const PROCEDURES_UI_STORAGE_PREFIX = `${UI_SESSION_STORAGE_PREFIX}procedures.`

function Procedures({ currentProfile }) {
  const [tab, setTab] = useSessionStorageState(`${PROCEDURES_UI_STORAGE_PREFIX}tab`, 'services')
  const [services, setServices] = useState([])
  const [legends, setLegends] = useState([])
  const [serviceSearchTerm, setServiceSearchTerm] = useState('')
  const [legendSearchTerm, setLegendSearchTerm] = useState('')
  const [addServiceName, setAddServiceName] = useState('')
  const [addServicePrice, setAddServicePrice] = useState('')
  const [addConditionName, setAddConditionName] = useState('')
  const [addLegendCode, setAddLegendCode] = useState('')
  const [modal, setModal] = useSessionStorageState(`${PROCEDURES_UI_STORAGE_PREFIX}modal`, null)
  const [selectedItem, setSelectedItem] = useSessionStorageState(`${PROCEDURES_UI_STORAGE_PREFIX}selectedItem`, null)
  const [editServiceName, setEditServiceName] = useSessionStorageState(`${PROCEDURES_UI_STORAGE_PREFIX}editServiceName`, '')
  const [editServicePrice, setEditServicePrice] = useSessionStorageState(`${PROCEDURES_UI_STORAGE_PREFIX}editServicePrice`, '')
  const [editCondition, setEditCondition] = useSessionStorageState(`${PROCEDURES_UI_STORAGE_PREFIX}editCondition`, '')
  const [editLegendCode, setEditLegendCode] = useSessionStorageState(`${PROCEDURES_UI_STORAGE_PREFIX}editLegendCode`, '')
  const [successMessage, setSuccessMessage] = useSessionStorageState(`${PROCEDURES_UI_STORAGE_PREFIX}successMessage`, '')
  const [errorMessage, setErrorMessage] = useSessionStorageState(`${PROCEDURES_UI_STORAGE_PREFIX}errorMessage`, '')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const isAdmin = currentProfile?.role === 'admin'

  const closeModal = () => {
    setModal(null)
    setSelectedItem(null)
    setErrorMessage('')
  }

  const showSuccess = (message) => {
    setSuccessMessage(message)
    setModal('success')
  }

  const showErrorModal = (message) => {
    setErrorMessage(message)
    setModal('error')
  }

  const loadData = async () => {
    setLoading(true)
    setError('')

    const [{ data: serviceData, error: serviceError }, { data: legendData, error: legendError }] = await Promise.all([
      supabase.from('services').select('id, service_name, price, is_active, created_at').order('service_name', { ascending: true }),
      supabase.from('tooth_conditions').select('id, code, condition_name, is_active, created_at').order('code', { ascending: true }),
    ])

    if (serviceError || legendError) {
      setError(serviceError?.message ?? legendError?.message ?? 'Unable to load procedures.')
      setServices([])
      setLegends([])
      setLoading(false)
      return
    }

    setServices(serviceData ?? [])
    setLegends(legendData ?? [])
    setLoading(false)
  }

  useEffect(() => {
    const bootstrapTimer = setTimeout(() => {
      void loadData()
    }, 0)

    return () => clearTimeout(bootstrapTimer)
  }, [])

  const activeServices = useMemo(() => services.filter((item) => item.is_active), [services])
  const activeLegends = useMemo(() => legends.filter((item) => item.is_active), [legends])
  const filteredServices = useMemo(() => {
    const query = serviceSearchTerm.trim().toLowerCase()
    if (!query) return activeServices
    return activeServices.filter((item) => `${item.service_name || ''}`.toLowerCase().includes(query))
  }, [activeServices, serviceSearchTerm])
  const filteredLegends = useMemo(() => {
    const query = legendSearchTerm.trim().toLowerCase()
    if (!query) return activeLegends
    return activeLegends.filter((item) => {
      const condition = `${item.condition_name || ''}`.toLowerCase()
      const code = `${item.code || ''}`.toLowerCase()
      return condition.includes(query) || code.includes(query)
    })
  }, [activeLegends, legendSearchTerm])
  const normalizeServiceName = (value) => `${value ?? ''}`.trim().replace(/\s+/g, ' ').toLowerCase()
  const findServiceDuplicate = ({ name, excludeId = null }) => {
    const normalizedName = normalizeServiceName(name)
    return services.find((item) => {
      if (excludeId && item.id === excludeId) return false
      return normalizeServiceName(item.service_name) === normalizedName
    })
  }
  const findLegendDuplicate = ({ code, condition, excludeId = null }) => {
    const normalizedCode = normalizeLegendCode(code)
    const normalizedCondition = normalizeConditionName(condition)

    return legends.find((item) => {
      if (excludeId && item.id === excludeId) return false
      return normalizeLegendCode(item.code) === normalizedCode || normalizeConditionName(item.condition_name) === normalizedCondition
    })
  }

  const migrateLegendCodeInDentalRecords = async ({ fromCode, toCode, actorId }) => {
    if (!fromCode || !toCode || fromCode === toCode) return

    const { data: records, error: recordsError } = await supabase
      .from('dental_records')
      .select('id, chart_data')
      .is('archived_at', null)

    if (recordsError) throw recordsError

    const updates = (records ?? []).flatMap((row) => {
      const chartData = row.chart_data && typeof row.chart_data === 'object' ? row.chart_data : {}
      const toothMap = chartData.toothMap && typeof chartData.toothMap === 'object' ? chartData.toothMap : null
      if (!toothMap) return []

      let changed = false
      const nextToothMap = { ...toothMap }
      Object.entries(nextToothMap).forEach(([position, code]) => {
        if (code === fromCode) {
          nextToothMap[position] = toCode
          changed = true
        }
      })

      if (!changed) return []

      return [supabase
        .from('dental_records')
        .update({
          chart_data: {
            ...chartData,
            toothMap: nextToothMap,
          },
          updated_by: actorId,
        })
        .eq('id', row.id)]
    })

    if (!updates.length) return
    const results = await Promise.all(updates)
    const firstError = results.find((result) => result.error)?.error
    if (firstError) throw firstError
  }

  const openEdit = (item) => {
    setSelectedItem(item)
    if (tab === 'services') {
      setEditServiceName(item.service_name)
      setEditServicePrice(`${item.price ?? ''}`)
      setModal('edit-service')
      return
    }
    setEditCondition(item.condition_name)
    setEditLegendCode(sanitizeLegendCodeInput(item.code))
    setModal('edit-legend')
  }

  const openArchive = (item) => {
    if (!isAdmin) {
      showErrorModal('Only admins can archive procedures and dental chart legends.')
      return
    }
    setSelectedItem(item)
    setModal('archive')
  }

  const addService = async () => {
    const serviceName = toTitleCase(sanitizeServiceNameInput(addServiceName).trim())
    const price = parsePrice(addServicePrice)
    if (!serviceName || price === null) {
      showErrorModal('Enter a valid service name and non-negative price.')
      return
    }

    const duplicateService = findServiceDuplicate({ name: serviceName })
    if (duplicateService) {
      showErrorModal(`Service already exists (${duplicateService.service_name}). It was not added.`)
      return
    }

    const { error: insertError } = await supabase
      .from('services')
      .insert({ service_name: serviceName, price, description: serviceName })

    if (insertError) {
      if (insertError.code === '23505') {
        showErrorModal('Service already exists. It was not added.')
        return
      }
      showErrorModal(insertError.message)
      return
    }

    setAddServiceName('')
    setAddServicePrice('')
    await recordSystemAudit({
      action: 'service_created',
      entityType: 'service_catalog',
      entityLabel: serviceName,
      details: `Created service "${serviceName}".`,
      metadata: { price },
    })
    await loadData()
    showSuccess('Added successfully')
  }

  const handleAddCondition = async () => {
    const normalizedCode = normalizeLegendCode(addLegendCode)
    const normalizedCondition = toTitleCase(addConditionName.trim())
    if (!normalizedCondition || !normalizedCode) {
      showErrorModal('Enter both legend code and tooth condition.')
      return
    }
    if (normalizedCode.length > 3) {
      showErrorModal('Legend code must be at most 3 characters.')
      return
    }

    const duplicateLegend = findLegendDuplicate({ code: normalizedCode, condition: normalizedCondition })
    if (duplicateLegend) {
      showErrorModal(`Condition already exists (${duplicateLegend.code} - ${duplicateLegend.condition_name}). It was not added.`)
      return
    }

    const { error: insertError } = await supabase
      .from('tooth_conditions')
      .insert({ code: normalizedCode, condition_name: normalizedCondition, description: normalizedCondition })

    if (insertError) {
      if (insertError.code === '23505') {
        showErrorModal('Condition already exists. It was not added.')
        return
      }
      showErrorModal(insertError.message)
      return
    }

    setAddConditionName('')
    setAddLegendCode('')
    await recordSystemAudit({
      action: 'tooth_condition_created',
      entityType: 'tooth_condition',
      entityLabel: `${normalizedCode} - ${normalizedCondition}`,
      details: `Created tooth condition "${normalizedCondition}".`,
      metadata: { code: normalizedCode },
    })
    await loadData()
    showSuccess('Added successfully')
  }

  const updateSelected = async () => {
    if (!selectedItem) return

    if (tab === 'services') {
      const nextName = toTitleCase(sanitizeServiceNameInput(editServiceName).trim())
      const nextPrice = parsePrice(editServicePrice)
      if (!nextName || nextPrice === null) {
        showErrorModal('Enter a valid service name and non-negative price.')
        return
      }

      const duplicateService = findServiceDuplicate({ name: nextName, excludeId: selectedItem.id })
      if (duplicateService) {
        showErrorModal(`Service already exists (${duplicateService.service_name}). Update was not applied.`)
        return
      }

      const { error: updateError } = await supabase
        .from('services')
        .update({
          service_name: nextName,
          price: nextPrice,
          description: nextName,
          updated_by: (await supabase.auth.getUser()).data.user?.id ?? null,
        })
        .eq('id', selectedItem.id)

      if (updateError) {
        if (updateError.code === '23505') {
          showErrorModal('Service already exists. Update was not applied.')
          return
        }
        showErrorModal(updateError.message)
        return
      }
    } else {
      const oldCode = normalizeLegendCode(selectedItem.code)
      const nextCode = normalizeLegendCode(editLegendCode)
      const nextCondition = toTitleCase(editCondition.trim())
      if (!nextCode || !nextCondition) {
        showErrorModal('Enter both legend code and tooth condition.')
        return
      }
      if (nextCode.length > 3) {
        showErrorModal('Legend code must be at most 3 characters.')
        return
      }

      const duplicateLegend = findLegendDuplicate({
        code: nextCode,
        condition: nextCondition,
        excludeId: selectedItem.id,
      })
      if (duplicateLegend) {
        showErrorModal(`Condition already exists (${duplicateLegend.code} - ${duplicateLegend.condition_name}). Update was not applied.`)
        return
      }

      const { error: updateError } = await supabase
        .from('tooth_conditions')
        .update({ code: nextCode, condition_name: nextCondition, description: nextCondition, updated_by: (await supabase.auth.getUser()).data.user?.id ?? null })
        .eq('id', selectedItem.id)

      if (updateError) {
        if (updateError.code === '23505') {
          showErrorModal('Condition already exists. Update was not applied.')
          return
        }
        showErrorModal(updateError.message)
        return
      }

      if (oldCode !== nextCode) {
        const { data: authData } = await supabase.auth.getUser()
        const actorId = authData?.user?.id ?? null
        try {
          await migrateLegendCodeInDentalRecords({ fromCode: oldCode, toCode: nextCode, actorId })
        } catch (migrationError) {
          showErrorModal(migrationError?.message || 'Legend updated but failed to migrate dental chart records.')
          return
        }
      }
    }

    await loadData()
    await recordSystemAudit({
      action: tab === 'services' ? 'service_updated' : 'tooth_condition_updated',
      entityType: tab === 'services' ? 'service_catalog' : 'tooth_condition',
      entityId: selectedItem.id,
      entityLabel: tab === 'services' ? editServiceName : `${editLegendCode} - ${editCondition}`,
      details: tab === 'services' ? 'Updated service catalog entry.' : 'Updated dental chart legend entry.',
    })
    closeModal()
    showSuccess('Updated successfully')
  }

  const confirmArchive = async () => {
    if (!selectedItem) return
    if (!isAdmin) {
      showErrorModal('Only admins can archive procedures and dental chart legends.')
      return
    }

    if (tab === 'services') {
      const { error: updateError } = await supabase
        .from('services')
        .update({ is_active: false, updated_by: (await supabase.auth.getUser()).data.user?.id ?? null })
        .eq('id', selectedItem.id)

      if (updateError) {
        showErrorModal(updateError.message)
        return
      }
    } else {
      const { error: updateError } = await supabase
        .from('tooth_conditions')
        .update({ is_active: false, updated_by: (await supabase.auth.getUser()).data.user?.id ?? null })
        .eq('id', selectedItem.id)

      if (updateError) {
        showErrorModal(updateError.message)
        return
      }
    }

    await loadData()
    await recordSystemAudit({
      action: tab === 'services' ? 'service_archived' : 'tooth_condition_archived',
      entityType: tab === 'services' ? 'service_catalog' : 'tooth_condition',
      entityId: selectedItem.id,
      entityLabel: tab === 'services' ? selectedItem.service_name : `${selectedItem.code} - ${selectedItem.condition_name}`,
      details: tab === 'services' ? 'Archived service catalog entry.' : 'Archived dental chart legend entry.',
    })
    closeModal()
    showSuccess('Archived successfully')
  }

  return (
    <>
      <header className="page-header">
        <h1>Procedures</h1>
      </header>

      <section className="panel tabs-panel procedures-panel fixed-table-page">
        <div className="panel-tabs large add-patient-tabs compact-tabs">
          <button type="button" className={`tab ${tab === 'services' ? 'active' : ''}`} onClick={() => setTab('services')}>
            Services
          </button>
          <button type="button" className={`tab ${tab === 'legend' ? 'active' : ''}`} onClick={() => setTab('legend')}>
            Dental Chart Legend
          </button>
        </div>

        <ErrorModal message={error} onClose={() => setError('')} />
        {loading ? <p>Loading procedures...</p> : null}

        <div className="grid-two procedures-grid">
          <div className="panel-card procedures-list-card">
            <h2>{tab === 'services' ? 'List of Services' : 'Dental Chart Legends'}</h2>
            <div className="search-box procedures-search-box">
              <span className="search-icon" aria-hidden />
              <input
                type="search"
                value={tab === 'services' ? serviceSearchTerm : legendSearchTerm}
                onChange={(event) => {
                  if (tab === 'services') {
                    setServiceSearchTerm(event.target.value)
                    return
                  }
                  setLegendSearchTerm(event.target.value)
                }}
                placeholder={tab === 'services' ? 'Search by service name' : 'Search by tooth condition'}
              />
            </div>
            <div className="simple-table">
              <div className="simple-head">
                {tab === 'services' ? (
                  <>
                    <span>Service name</span>
                    <span>Price (PHP)</span>
                    <span>Actions</span>
                  </>
                ) : (
                  <>
                    <span>Legend</span>
                    <span>Tooth Condition</span>
                    <span>Actions</span>
                  </>
                )}
              </div>
              <div className="simple-body">
                {(tab === 'services' ? filteredServices : filteredLegends).map((item) => (
                  <div key={item.id} className="simple-row">
                    <span>{tab === 'services' ? item.service_name : sanitizeLegendCodeInput(item.code)}</span>
                    <span>{tab === 'services' ? formatPrice(item.price) : item.condition_name}</span>
                    <span className="row-actions">
                      <button type="button" className="icon-btn" title="Update" onClick={() => openEdit(item)}>&#9998;</button>
                      {isAdmin ? <button type="button" className="icon-btn danger" title="Archive" onClick={() => openArchive(item)}>&#8681;</button> : null}
                    </span>
                  </div>
                ))}
                {!loading && (tab === 'services' ? filteredServices.length : filteredLegends.length) === 0 ? <p>No entries found.</p> : null}
              </div>
            </div>
          </div>

          <div className="panel-card procedures-form-card">
            <h2>{tab === 'services' ? 'Add Service' : 'Add a Condition'}</h2>
            <div className="stack">
              <label>
                {tab === 'services' ? 'Service Name' : <><span>Tooth condition</span><span className="required-asterisk">*</span></>}
                <input
                  type="text"
                  value={tab === 'services' ? addServiceName : addConditionName}
                  onChange={(event) =>
                    tab === 'services'
                      ? setAddServiceName(toTitleCase(sanitizeServiceNameInput(event.target.value)))
                      : setAddConditionName(toTitleCase(event.target.value))
                  }
                />
              </label>
              {tab === 'services' ? (
                <label>
                  Price (PHP)
                  <input
                    type="text"
                    inputMode="decimal"
                    pattern="[0-9]*[.]?[0-9]*"
                    value={addServicePrice}
                    onChange={(event) => setAddServicePrice(sanitizeMoneyInput(event.target.value))}
                  />
                </label>
              ) : null}
              {tab === 'legend' ? (
                <label>
                  <><span>Legend</span><span className="required-asterisk">*</span></>
                  <input
                    type="text"
                    maxLength={3}
                    value={addLegendCode}
                    onChange={(event) => setAddLegendCode(sanitizeLegendCodeInput(event.target.value))}
                  />
                </label>
              ) : null}
              <button type="button" className="primary wide" onClick={() => { void (tab === 'services' ? addService() : handleAddCondition()) }}>
                Add
              </button>
            </div>
          </div>
        </div>
      </section>

      {modal ? <div className="modal-backdrop" onClick={closeModal} /> : null}

      {modal === 'edit-service' ? (
        <div className="pr-modal procedures-modal">
          <div className="pr-modal-head"><h2>Update</h2><button type="button" onClick={closeModal}>X</button></div>
          <div className="pr-modal-body">
            <div className="stack">
              <label>Service Name<input type="text" value={editServiceName} onChange={(e) => setEditServiceName(toTitleCase(sanitizeServiceNameInput(e.target.value)))} /></label>
              <label>
                Price (PHP)
                <input
                  type="text"
                  inputMode="decimal"
                  pattern="[0-9]*[.]?[0-9]*"
                  value={editServicePrice}
                  onChange={(event) => setEditServicePrice(sanitizeMoneyInput(event.target.value))}
                />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="danger-btn" onClick={closeModal}>Cancel</button>
              <button type="button" className="success-btn" onClick={() => { void updateSelected() }}>Update</button>
            </div>
          </div>
        </div>
      ) : null}

      {modal === 'edit-legend' ? (
        <div className="pr-modal procedures-modal">
          <div className="pr-modal-head"><h2>Update</h2><button type="button" onClick={closeModal}>X</button></div>
          <div className="pr-modal-body">
            <div className="stack">
              <label>Tooth Condition<input type="text" value={editCondition} onChange={(e) => setEditCondition(toTitleCase(e.target.value))} /></label>
              <label>
                Legend
                <input
                  type="text"
                  maxLength={3}
                  value={editLegendCode}
                  onChange={(e) => setEditLegendCode(sanitizeLegendCodeInput(e.target.value))}
                />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="danger-btn" onClick={closeModal}>Cancel</button>
              <button type="button" className="success-btn" onClick={() => { void updateSelected() }}>Update</button>
            </div>
          </div>
        </div>
      ) : null}

      {modal === 'archive' ? (
        <div className="pr-modal procedures-modal archive-modal">
          <div className="pr-modal-head"><h2>Archive</h2></div>
          <div className="pr-modal-body">
            <p>
              {tab === 'services'
                ? 'Are you sure you want to archive this service?'
                : 'Are you sure you want to archive this tooth condition?'}
            </p>
            <div className="modal-actions">
              <button type="button" className="danger-btn" onClick={closeModal}>No</button>
              <button type="button" className="success-btn" onClick={() => { void confirmArchive() }}>Yes</button>
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

      {modal === 'error' ? (
        <div className="pr-modal procedures-modal procedures-error-modal">
          <div className="pr-modal-head"><h2>Notice</h2></div>
          <div className="pr-modal-body">
            <p>{errorMessage}</p>
            <div className="modal-actions center">
              <button type="button" className="success-btn" onClick={closeModal}>OK</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

export default Procedures
