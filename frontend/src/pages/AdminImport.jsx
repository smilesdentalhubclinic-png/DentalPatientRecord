import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import ErrorModal from '../components/ErrorModal'
import { supabase } from '../lib/supabaseClient'
import {
  downloadPatientTemplateWorkbook,
  downloadRecordsTemplateWorkbook,
  readImportFileAsCsv,
} from '../utils/patientImportTemplate'

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
  inputAccept = '.csv,text/csv',
  templateHref,
  templateLabel,
  templateDownloadName,
  onTemplateDownload,
}) {
  return (
    <section className="admin-import-workspace-card">
      <div className="admin-import-section-head">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="admin-import-actions admin-import-actions-rich">
        <input ref={inputRef} type="file" accept={inputAccept} onChange={onChoose} />
        <button type="button" className="ghost" onClick={() => inputRef.current?.click()}>Choose File</button>
        <span>{fileName || 'No file selected yet.'}</span>
      </div>
      <p className="admin-import-helper">{helper}</p>
      <div className="admin-import-card-actions">
        {onTemplateDownload ? (
          <button type="button" className="ghost admin-import-download-btn" onClick={() => { void onTemplateDownload() }}>
            {templateLabel}
          </button>
        ) : (
          <a className="ghost admin-import-download-btn" href={templateHref} download={templateDownloadName}>
            {templateLabel}
          </a>
        )}
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
    '[ready] Import workspace initialized. Choose a patient Excel file or a CSV file to begin.',
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
      if (type === 'patients') {
        const text = await readImportFileAsCsv(file)
        setPatientImportCsvContent(text)
        setPatientImportFileName(file.name)
        setPatientImportSummary(null)
        appendLogLines([`[file] Patient file selected: ${file.name}`])
      } else {
        const text = await readImportFileAsCsv(file)
        setRecordsImportCsvContent(text)
        setRecordsImportFileName(file.name)
        setRecordsImportSummary(null)
        appendLogLines([`[file] Records file selected: ${file.name}`])
      }
      setImportError('')
    } catch {
      setImportError('Unable to read the selected file.')
      appendLogLines(['[error] Unable to read the selected file.'])
    }
  }

  const importPatientMigration = async () => {
    if (!patientImportCsvContent.trim()) {
      setImportError('Please choose the patient information file first.')
      appendLogLines(['[error] Patient import was blocked because no patient file was selected.'])
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
        setImportError(payload?.error || 'Unable to import the patient file.')
        appendLogLines([`[error] Patient import failed: ${payload?.error || 'Unable to import the patient file.'}`])
        return
      }

      setPatientImportSummary(payload?.summary || null)
      appendLogLines(buildSummaryLogLines('Patient', payload?.summary || null))
    } catch {
      setImportError('Unable to import the patient file.')
      appendLogLines(['[error] Patient import failed because the request could not be completed.'])
    } finally {
      setIsImportingPatients(false)
    }
  }

  const importPatientRecords = async () => {
    if (!recordsImportCsvContent.trim()) {
      setImportError('Please choose the dental and service records file first.')
      appendLogLines(['[error] Records import was blocked because no records file was selected.'])
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
        setImportError(payload?.error || 'Unable to import the dental and service records file.')
        appendLogLines([`[error] Records import failed: ${payload?.error || 'Unable to import the dental and service records file.'}`])
        return
      }

      setRecordsImportSummary(payload?.summary || null)
      appendLogLines(buildSummaryLogLines('Records', payload?.summary || null))
    } catch {
      setImportError('Unable to import the dental and service records file.')
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
            <p>This page is for uploading patient files that were taken from physical paper records and transferring them into the system. Use the patient information file and the dental and service records file to move the encoded data into the digital patient record database.</p>
          </div>
        </div>

        <div className="admin-import-submission-column">
          <section className="admin-import-column-header">
            <h2>Submission Fields</h2>
            <p>Choose the file, review the expected format, and run the import when ready.</p>
          </section>

          <div className="admin-import-card-row">
            <ImportCard
              title="Patient Information File"
              helper="Download the Excel template, fill in the Patient Information sheet, then upload the completed .xlsx file. CSV is still accepted if needed."
              fileName={patientImportFileName}
              inputRef={patientImportFileInputRef}
              isImporting={isImportingPatients}
              onChoose={(event) => { void handleImportFileChange(event, 'patients') }}
              onImport={() => { void importPatientMigration() }}
              inputAccept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              actionLabel="Process Patient File"
              templateLabel="Download Patient Template"
              onTemplateDownload={downloadPatientTemplateWorkbook}
            />

            <ImportCard
              title="Dental and Service Records File"
              helper="Download the Excel template, fill in the Dental and Service Records sheet, then upload the completed .xlsx file. The second sheet contains sample examples only."
              fileName={recordsImportFileName}
              inputRef={recordsImportFileInputRef}
              isImporting={isImportingRecords}
              onChoose={(event) => { void handleImportFileChange(event, 'records') }}
              onImport={() => { void importPatientRecords() }}
              inputAccept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              actionLabel="Process Records File"
              templateLabel="Download Records Template"
              onTemplateDownload={downloadRecordsTemplateWorkbook}
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
