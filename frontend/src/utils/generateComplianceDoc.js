const today = () => {
  const d = new Date()
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

const SECTIONS = [
  {
    title: '1. Access Control (Role-Based)',
    rows: [
      ['Role-based access control (RBAC)', 'Admin, Receptionist, Associate Dentist — each with distinct permissions'],
      ['Role-specific navigation', 'Each role only sees and accesses pages relevant to their function'],
      ['Role-specific dashboards', 'Admin: full analytics & revenue. Receptionist: queue & registrations. Dentist: clinical load'],
      ['Admin-only route guards', '/admin and /admin/import blocked for non-admin at both frontend and backend'],
      ['DB-level Row Level Security', 'Supabase RLS enforced on all sensitive tables — no direct table access without role check'],
      ['Queue acceptance restriction', 'Only Admin and Associate Dentist can accept patients from the queue'],
      ['Service record restriction', 'Only Admin and Associate Dentist can create service and dental records'],
      ['Receptionist discount-only', 'Receptionists can only adjust discounts on existing records, not create new ones'],
      ['Role identity visibility', 'Staff always sees their own role label in the sidebar (Admin / Receptionist / Associate Dentist)'],
    ],
  },
  {
    title: '2. Audit Trail & Accountability',
    rows: [
      ['System audit logs', 'All key actions recorded in system_audit_logs with actor, timestamp, and metadata'],
      ['Patient-specific logs', 'All patient changes recorded in patient_logs (create, update, archive, retrieve)'],
      ['Queue action logs', 'Add, accept, and cancel queue entries are individually audited'],
      ['OTP request logs', 'Every verification code request is logged with patient ID and requesting staff'],
      ['Import audit logs', 'Every real import (not dry runs) logged with file name, row counts, and error summary'],
      ['Patient update request logs', 'Admin approval, decline, and submission actions are logged with timestamps'],
      ['Archive event logs', 'All archive and retrieve operations tracked in archive_events table'],
      ['Actor tracking', 'Every audit entry records the user ID and identifier of who performed the action'],
    ],
  },
  {
    title: '3. Record Integrity',
    rows: [
      ['Soft delete only', 'Patients are archived (archived_at set), never permanently deleted from the database'],
      ['FIFO queue enforcement', 'Database trigger prevents accepting patients out of order — first-in, first-out strictly enforced'],
      ['Unique patient identity', 'Database constraint prevents duplicate records with the same name, sex, and birth date'],
      ['Conflict detection on OTP save', 'System detects if another user modified the record while OTP was pending — blocks stale saves'],
      ['Pending request auto-cancel', 'When OTP saves directly, any stale pending admin requests for that patient are automatically declined'],
      ['Stale request warning', 'Warning shown to staff when a pending admin request already exists before choosing OTP or admin route'],
      ['Patient active status required', 'Queue acceptance fails if the patient has been set to inactive'],
      ['Import dry run validation', 'All CSV rows are validated before any database writes — partial imports are prevented'],
    ],
  },
  {
    title: '4. Patient Consent & Privacy (RA 10173)',
    rows: [
      ['Authorization consent field', 'authorization_accepted is required on all patient registrations — must be TRUE'],
      ['OTP verification for updates', "Patient's registered email must verify changes before they are saved to the database"],
      ['Changes shown in OTP email', 'Patient sees a table of exactly which fields are being changed before authorizing with OTP'],
      ['Admin approval alternative', 'Updates can be submitted for admin review and approval instead of OTP verification'],
      ['"No email" fallback', 'Admin approval is available when patient has no registered email on file'],
      ['N/A email handling', 'Blank, N/A, NA, none, or nil entries in the email column are treated as "no email" — not stored as data'],
    ],
  },
  {
    title: '5. Authentication & Session Security',
    rows: [
      ['Supabase authentication', 'Secure login using email/username and password via Supabase Auth'],
      ['Password reset via OTP', '6-digit OTP sent to registered email required to complete password reset'],
      ['Session validation', 'Active session checked and validated on every protected API request'],
      ['Staff onboarding OTP', 'New staff accounts verified by email OTP before first login is allowed'],
      ['Navigation guard', 'Password confirmation required when navigating away from the Add Patient form'],
    ],
  },
  {
    title: '6. Data Validation & Quality',
    rows: [
      ['Philippine mobile format', 'All phone numbers validated to Philippine format (+639XXXXXXXXX) at all entry points'],
      ['Email format validation', 'Import and registration reject malformed email addresses (must contain @ and domain)'],
      ['Future date blocked', 'Birth dates in the future are rejected at both import and patient form level'],
      ['Minimum age enforcement', 'Patient must be at least 6 months old — enforced at registration and import'],
      ['Discount cap validation', 'Service discount amount cannot exceed unit_price × quantity — enforced at import'],
      ['Required field enforcement', 'All required fields validated before save or import — rows with missing fields are rejected'],
      ['Import field guide', 'Downloadable Excel template includes a Field Rules sheet listing accepted values per column'],
    ],
  },
  {
    title: '7. System-wide Settings & Real-time',
    rows: [
      ['Queue toggle synced to DB', 'Admin can toggle queue features — stored in clinic_settings table, synced to all devices'],
      ['Real-time queue updates', 'All staff see queue changes instantly via Supabase WebSocket — no manual refresh needed'],
      ['Multi-device consistency', 'clinic_settings table ensures all logged-in staff see the same queue state regardless of device'],
    ],
  },
]

const STANDARDS_TABLE = [
  ['RA 10173 (Data Privacy Act)', 'Patient consent, access control, audit trail, minimum necessary access, data breach handling'],
  ['DOH EMR Guidelines', 'Record integrity, soft delete, role-based access, complete audit trail'],
  ['PRC Dental Records Requirements', 'Complete patient records, clinical history, dental and service records, staff accountability'],
]

export function generateComplianceDocHtml() {
  const sectionHtml = SECTIONS.map((section) => `
    <div class="section">
      <h2>${section.title}</h2>
      <table>
        <thead>
          <tr>
            <th style="width:35%">Feature</th>
            <th style="width:65%">Implementation</th>
          </tr>
        </thead>
        <tbody>
          ${section.rows.map(([feature, impl], i) => `
            <tr class="${i % 2 === 0 ? 'even' : 'odd'}">
              <td class="feature">${feature}</td>
              <td>${impl}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `).join('')

  const standardsHtml = STANDARDS_TABLE.map(([std, cov], i) => `
    <tr class="${i % 2 === 0 ? 'even' : 'odd'}">
      <td class="feature">${std}</td>
      <td>${cov}</td>
    </tr>
  `).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>EMR Compliance Report — Smiles Dental Hub</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 11pt;
    color: #1a2a35;
    background: #fff;
    padding: 40px 60px;
    max-width: 1000px;
    margin: 0 auto;
  }
  .cover {
    text-align: center;
    padding: 60px 0 40px;
    border-bottom: 3px solid #0b76a2;
    margin-bottom: 40px;
  }
  .cover h1 {
    font-size: 26pt;
    color: #0b76a2;
    margin-bottom: 8px;
  }
  .cover h2 {
    font-size: 14pt;
    font-weight: 400;
    color: #4f7284;
    margin-bottom: 20px;
  }
  .cover .meta {
    font-size: 10pt;
    color: #697985;
    line-height: 2;
  }
  .intro {
    background: #f0f8fc;
    border-left: 4px solid #0b76a2;
    padding: 16px 20px;
    margin-bottom: 36px;
    border-radius: 0 8px 8px 0;
    font-size: 10.5pt;
    line-height: 1.7;
    color: #2d4a5a;
  }
  .section {
    margin-bottom: 36px;
    page-break-inside: avoid;
  }
  .section h2 {
    font-size: 13pt;
    color: #0b76a2;
    border-bottom: 2px solid #d7eef6;
    padding-bottom: 6px;
    margin-bottom: 12px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10pt;
    margin-bottom: 4px;
  }
  thead tr {
    background: #0b76a2;
    color: #fff;
  }
  thead th {
    padding: 8px 12px;
    text-align: left;
    font-weight: 600;
    font-size: 9.5pt;
    letter-spacing: 0.03em;
  }
  tbody tr.even { background: #f8fbfd; }
  tbody tr.odd  { background: #ffffff; }
  tbody td {
    padding: 7px 12px;
    border-bottom: 1px solid #e4eef3;
    vertical-align: top;
    line-height: 1.5;
  }
  td.feature {
    font-weight: 600;
    color: #1d4863;
  }
  .standards-section {
    margin-top: 40px;
    page-break-inside: avoid;
  }
  .standards-section h2 {
    font-size: 13pt;
    color: #0b76a2;
    border-bottom: 2px solid #d7eef6;
    padding-bottom: 6px;
    margin-bottom: 12px;
  }
  .footer {
    margin-top: 50px;
    padding-top: 16px;
    border-top: 1px solid #d7eef6;
    font-size: 9pt;
    color: #697985;
    text-align: center;
  }
  .print-btn {
    position: fixed;
    top: 20px;
    right: 20px;
    background: #0b76a2;
    color: #fff;
    border: none;
    padding: 10px 20px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(11,118,162,0.25);
  }
  .print-btn:hover { background: #0a6890; }
  @media print {
    .print-btn { display: none; }
    body { padding: 20px 40px; }
    .section { page-break-inside: avoid; }
  }
</style>
</head>
<body>

<button class="print-btn" onclick="window.print()">🖨️ Print / Save as PDF</button>

<div class="cover">
  <h1>EMR Compliance Report</h1>
  <h2>Smiles Dental Hub — Information System for Digitizing<br/>Dental Patient Record Keeping and Monitoring</h2>
  <div class="meta">
    <div>Clinic Location: Bulacan, Philippines</div>
    <div>Applicable Standard: RA 10173 (Data Privacy Act) · DOH EMR Guidelines · PRC Dental Records</div>
    <div>Report Date: ${today()}</div>
  </div>
</div>

<div class="intro">
  This document lists all Electronic Medical Records (EMR) compliance features implemented in the Smiles Dental Hub system.
  The system has been designed in alignment with Philippine healthcare data standards, covering access control,
  accountability, record integrity, and patient privacy as required under RA 10173 and DOH EMR guidelines.
</div>

${sectionHtml}

<div class="standards-section">
  <h2>8. Mapped to Philippine Standards</h2>
  <table>
    <thead>
      <tr>
        <th style="width:35%">Standard</th>
        <th style="width:65%">Coverage</th>
      </tr>
    </thead>
    <tbody>${standardsHtml}</tbody>
  </table>
</div>

<div class="footer">
  Smiles Dental Hub · EMR Compliance Report · Generated ${today()} · Confidential
</div>

</body>
</html>`
}

export function downloadComplianceDoc() {
  const html = generateComplianceDocHtml()
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `Smiles-Dental-Hub-EMR-Compliance-Report-${new Date().toISOString().slice(0, 10)}.html`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
