import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import ErrorModal from '../components/ErrorModal'
import { supabase } from '../lib/supabaseClient'

const PATIENT_TEMPLATE_PATH = '/templates/patient-information-template.csv'
const RECORDS_TEMPLATE_PATH = '/templates/dental-and-service-records-template.csv'

const classifyLogLine = (line) => {
  if (line.startsWith('[error]') || line.startsWith('[row-error]')) return 'error'
  if (line.startsWith('[success]') || line.startsWith('[ok]')) return 'success'
  if (line.startsWith('[run]')) return 'running'
  if (line.startsWith('[file]')) return 'file'
  return 'info'
}

const formatLogLine = (line) => line.replace(/^\[[^\]]+\]\s*/, '')

function ImportCard({
  title,
  description,
  helper,
  fileName,
  inputRef,
  isImporting,
  onChoose,
  onImport,
  actionLabel,
  templateHref,
  templateLabel,
  templateDownloadName,
}) {
  return (
    <section className="admin-import-workspace-card">
      <div className="admin-import-section-head">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="admin-import-actions admin-import-actions-rich">
        <input ref={inputRef} type="file" accept=".csv,text/csv" onChange={onChoose} />
        <button type="button" className="ghost" onClick={() => inputRef.current?.click()}>Choose CSV File</button>
        <span>{fileName || 'No file selected yet.'}</span>
      </div>
      <p className="admin-import-helper">{helper}</p>
      <div className="admin-import-card-actions">
        <a className="ghost admin-import-download-btn" href={templateHref} download={templateDownloadName}>
          {templateLabel}
        </a>
        <button type="button" className="success-btn" onClick={onImport} disabled={isImporting}>
          {isImporting ? 'Importing...' : actionLabel}
        </button>
      </div>
    </section>
  )
}

function AdminImport() {
  const patientImportFileInputRef = useRef(null)
  const recordsImportFileInputRef = useRef(null)
  const [patientImportFileName, setPatientImportFileName] = useState('')
  const [patientImportCsvContent, setPatientImportCsvContent] = useState('')
  const [patientImportSummary, setPatientImportSummary] = useState(null)
  const [recordsImportFileName, setRecordsImportFileName] = useState('')
  const [recordsImportCsvContent, setRecordsImportCsvContent] = useState('')
  const [recordsImportSummary, setRecordsImportSummary] = useState(null)
  const [importError, setImportError] = useState('')
  const [isImportingPatients, setIsImportingPatients] = useState(false)
  const [isImportingRecords, setIsImportingRecords] = useState(false)
  const [importLogLines, setImportLogLines] = useState([
    '[ready] Import workspace initialized. Choose a CSV file to begin.',
  ])

  const appendLogLines = (lines) => {
    setImportLogLines((previous) => [...previous, ...lines])
  }

  const buildSummaryLogLines = (label, summary) => {
    const lines = [
      `[success] ${label} import finished for ${summary?.fileName || 'uploaded file'}.`,
      `[info] total rows: ${summary?.totalRows ?? 0}, skipped rows: ${summary?.skippedRows ?? 0}.`,
    ]

    if ('patientsCreated' in (summary || {})) {
      lines.push(`[info] patients created: ${summary?.patientsCreated ?? 0}, patients updated: ${summary?.patientsUpdated ?? 0}.`)
    }

    if ('dentalRecordsCreated' in (summary || {})) {
      lines.push(`[info] dental created: ${summary?.dentalRecordsCreated ?? 0}, dental updated: ${summary?.dentalRecordsUpdated ?? 0}.`)
    }

    if ('serviceRecordsCreated' in (summary || {})) {
      lines.push(`[info] service created: ${summary?.serviceRecordsCreated ?? 0}, service updated: ${summary?.serviceRecordsUpdated ?? 0}.`)
    }

    if (Array.isArray(summary?.errors) && summary.errors.length > 0) {
      summary.errors.forEach((item) => {
        lines.push(`[row-error] ${item}`)
      })
    } else {
      lines.push('[ok] No row errors found.')
    }

    return lines
  }

  const handleImportFileChange = async (event, type) => {
    const file = event.target.files?.[0]
    if (!file) {
      if (type === 'patients') {
        setPatientImportCsvContent('')
        setPatientImportFileName('')
      } else {
        setRecordsImportCsvContent('')
        setRecordsImportFileName('')
      }
      return
    }

    try {
      const text = await file.text()
      if (type === 'patients') {
        setPatientImportCsvContent(text)
        setPatientImportFileName(file.name)
        setPatientImportSummary(null)
        appendLogLines([`[file] Patient CSV selected: ${file.name}`])
      } else {
        setRecordsImportCsvContent(text)
        setRecordsImportFileName(file.name)
        setRecordsImportSummary(null)
        appendLogLines([`[file] Records CSV selected: ${file.name}`])
      }
      setImportError('')
    } catch {
      setImportError('Unable to read the selected CSV file.')
      appendLogLines(['[error] Unable to read the selected CSV file.'])
    }
  }

  const importPatientMigration = async () => {
    if (!patientImportCsvContent.trim()) {
      setImportError('Please choose the patient information CSV first.')
      appendLogLines(['[error] Patient import was blocked because no patient CSV was selected.'])
      return
    }

    setIsImportingPatients(true)
    setImportError('')
    setPatientImportSummary(null)
    appendLogLines([`[run] Starting patient import for ${patientImportFileName || 'unnamed file'}...`])

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      const accessToken = sessionData?.session?.access_token || ''
      if (sessionError || !accessToken) {
        setImportError('Unable to verify your session. Please log in again.')
        appendLogLines(['[error] Patient import failed because the current session could not be verified.'])
        return
      }

      const response = await fetch('/api/admin/import-patient-migration', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          fileName: patientImportFileName,
          csvContent: patientImportCsvContent,
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setImportError(payload?.error || 'Unable to import the patient CSV.')
        appendLogLines([`[error] Patient import failed: ${payload?.error || 'Unable to import the patient CSV.'}`])
        return
      }

      setPatientImportSummary(payload?.summary || null)
      appendLogLines(buildSummaryLogLines('Patient', payload?.summary || null))
    } catch {
      setImportError('Unable to import the patient CSV.')
      appendLogLines(['[error] Patient import failed because the request could not be completed.'])
    } finally {
      setIsImportingPatients(false)
    }
  }

  const importPatientRecords = async () => {
    if (!recordsImportCsvContent.trim()) {
      setImportError('Please choose the dental and service records CSV first.')
      appendLogLines(['[error] Records import was blocked because no records CSV was selected.'])
      return
    }

    setIsImportingRecords(true)
    setImportError('')
    setRecordsImportSummary(null)
    appendLogLines([`[run] Starting records import for ${recordsImportFileName || 'unnamed file'}...`])

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      const accessToken = sessionData?.session?.access_token || ''
      if (sessionError || !accessToken) {
        setImportError('Unable to verify your session. Please log in again.')
        appendLogLines(['[error] Records import failed because the current session could not be verified.'])
        return
      }

      const response = await fetch('/api/admin/import-patient-records', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          fileName: recordsImportFileName,
          csvContent: recordsImportCsvContent,
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setImportError(payload?.error || 'Unable to import the dental and service records CSV.')
        appendLogLines([`[error] Records import failed: ${payload?.error || 'Unable to import the dental and service records CSV.'}`])
        return
      }

      setRecordsImportSummary(payload?.summary || null)
      appendLogLines(buildSummaryLogLines('Records', payload?.summary || null))
    } catch {
      setImportError('Unable to import the dental and service records CSV.')
      appendLogLines(['[error] Records import failed because the request could not be completed.'])
    } finally {
      setIsImportingRecords(false)
    }
  }

  return (
    <>
      <ErrorModal message={importError} onClose={() => setImportError('')} />
      <header className="page-header">
        <div>
          <h1>Admin</h1>
        </div>
        <div className="page-header-actions">
          <Link className="ghost admin-import-back-btn" to="/admin">Back to Admin</Link>
        </div>
      </header>

      <section className="admin-import-page-shell">
        <div className="admin-import-hero">
          <div className="admin-import-hero-copy">
            <h2>Patient Migration</h2>
            <p>This page is for uploading patient files that were taken from physical paper records and transferring them into the system. Use the patient information CSV and the dental and service records CSV to move the encoded data into the digital patient record database.</p>
          </div>
        </div>

        <div className="admin-import-submission-column">
          <section className="admin-import-column-header">
            <h2>Submission Fields</h2>
            <p>Choose the CSV, review the expected format, and run the import when ready.</p>
          </section>

          <div className="admin-import-card-row">
            <ImportCard
              title="Patient Information CSV"
              helper="Please ensure that there is no existing patient in the system before importing, and make sure that all patient details you entered are complete and correct."
              fileName={patientImportFileName}
              inputRef={patientImportFileInputRef}
              isImporting={isImportingPatients}
              onChoose={(event) => { void handleImportFileChange(event, 'patients') }}
              onImport={() => { void importPatientMigration() }}
              actionLabel="Process Patient CSV"
              templateHref={PATIENT_TEMPLATE_PATH}
              templateLabel="Download Patient Template"
              templateDownloadName="patient-information-template.csv"
            />

            <ImportCard
              title="Dental and Service Records CSV"
              helper="Make sure the patient already exists and all record details are correct before importing."
              fileName={recordsImportFileName}
              inputRef={recordsImportFileInputRef}
              isImporting={isImportingRecords}
              onChoose={(event) => { void handleImportFileChange(event, 'records') }}
              onImport={() => { void importPatientRecords() }}
              actionLabel="Process Records CSV"
              templateHref={RECORDS_TEMPLATE_PATH}
              templateLabel="Download Records Template"
              templateDownloadName="dental-and-service-records-template.csv"
            />
          </div>
        </div>

        <section className="admin-import-results-panel">
          <div className="admin-import-column-header">
            <h2>Results Field</h2>
            <p>See every import result in one place, including success messages and the exact rows that need fixing.</p>
          </div>

          <div className="admin-import-results-card">
            <div className="admin-import-results-head">
              <div>
                <h3>Import Results</h3>
                <p>Latest file actions, import summaries, and row-level issues.</p>
              </div>
            </div>
            <div className="admin-import-results-body" role="log" aria-live="polite">
              {importLogLines.map((line, index) => (
                <div key={`${index}-${line}`} className={`admin-import-result-line admin-import-result-line-${classifyLogLine(line)}`}>
                  <span className={`admin-import-result-badge admin-import-result-badge-${classifyLogLine(line)}`}>
                    {classifyLogLine(line)}
                  </span>
                  <p>{formatLogLine(line)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </section>
    </>
  )
}

export default AdminImport
