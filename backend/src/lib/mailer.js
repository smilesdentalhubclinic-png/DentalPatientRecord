const nodemailer = require('nodemailer');
const config = require('../config');
const EMAIL_TIME_ZONE = 'Asia/Manila';

function formatEmailTimestamp(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '');

  const formatter = new Intl.DateTimeFormat('en-PH', {
    timeZone: EMAIL_TIME_ZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });

  return formatter.format(date);
}

function isSmtpConfigured() {
  return Boolean(config.smtpHost && config.smtpPort && config.smtpUser && config.smtpPass && config.smtpFromEmail);
}

function isGmailHost(host) {
  const normalizedHost = String(host || '').trim().toLowerCase();
  return normalizedHost === 'smtp.gmail.com' || normalizedHost.endsWith('.gmail.com');
}

function buildTransportOptions() {
  const useGmailSslFallback = isGmailHost(config.smtpHost) && !config.smtpSecure && config.smtpPort === 587;

  return {
    host: config.smtpHost,
    port: useGmailSslFallback ? 465 : config.smtpPort,
    secure: useGmailSslFallback ? true : config.smtpSecure,
    auth: {
      user: config.smtpUser,
      pass: config.smtpPass,
    },
    family: 4,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
    tls: {
      servername: config.smtpHost,
    },
  };
}

function createTransporter() {
  if (!isSmtpConfigured()) {
    throw new Error('SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM_EMAIL.');
  }

  return nodemailer.createTransport(buildTransportOptions());
}

function normalizeMailerError(error) {
  if (!error) return error;

  if (['ECONNRESET', 'ETIMEDOUT'].includes(error.code) || /timeout|ECONNRESET|socket closed/i.test(error.message || '')) {
    const normalized = new Error('Unable to deliver verification email right now. Please check the SMTP settings or try again in a moment.');
    normalized.status = 502;
    normalized.code = error.code || 'SMTP_DELIVERY_FAILED';
    normalized.cause = error;
    return normalized;
  }

  return error;
}

async function sendMail(message) {
  const transporter = createTransporter();

  try {
    return await transporter.sendMail(message);
  } catch (error) {
    throw normalizeMailerError(error);
  }
}

async function sendWelcomeTestEmail({ toEmail, requestedBy }) {
  const fromName = config.smtpFromName || 'Smiles Dental Hub';
  const from = `"${fromName}" <${config.smtpFromEmail}>`;
  const by = requestedBy || 'Admin';
  const sentAt = formatEmailTimestamp();

  const subject = 'Smiles Dental Hub - Email Delivery Test';
  const text = [
    'Hello,',
    '',
    'This is a test email from Smiles Dental Hub.',
    'If you received this, your email delivery is working.',
    '',
    `Requested by: ${by}`,
    `Sent at: ${sentAt}`,
    '',
    'No action is required.',
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937;line-height:1.6">
      <p>Hello,</p>
      <p>This is a test email from <strong>Smiles Dental Hub</strong>.</p>
      <p>If you received this, your email delivery is working.</p>
      <p style="margin-top:16px">
        <strong>Requested by:</strong> ${String(by)}<br />
        <strong>Sent at:</strong> ${sentAt}
      </p>
      <p style="margin-top:16px">No action is required.</p>
    </div>
  `;

  const info = await sendMail({
    from,
    to: toEmail,
    subject,
    text,
    html,
  });

  return info;
}

async function sendEmailChangeVerificationEmail({ toEmail, code, requestedBy, expiresInMinutes = 10 }) {
  const fromName = config.smtpFromName || 'Smiles Dental Hub';
  const from = `"${fromName}" <${config.smtpFromEmail}>`;
  const by = requestedBy || 'Smiles Dental Hub';

  const subject = 'Smiles Dental Hub - Email Change Verification Code';
  const text = [
    'Hello,',
    '',
    'We received a request to change the email address for your Smiles Dental Hub account.',
    '',
    `Verification code: ${code}`,
    `This code expires in ${expiresInMinutes} minutes.`,
    '',
    `Requested by: ${by}`,
    '',
    'If you did not request this change, you can ignore this email.',
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937;line-height:1.6">
      <p>Hello,</p>
      <p>We received a request to change the email address for your <strong>Smiles Dental Hub</strong> account.</p>
      <div style="margin:20px 0;padding:16px;border-radius:12px;background:#f4fafb;border:1px solid #d7e8ef;text-align:center">
        <div style="font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#4c6b7a;margin-bottom:6px">Verification Code</div>
        <div style="font-size:32px;font-weight:800;letter-spacing:0.18em;color:#0f6f96">${String(code)}</div>
      </div>
      <p><strong>This code expires in ${expiresInMinutes} minutes.</strong></p>
      <p style="margin-top:16px"><strong>Requested by:</strong> ${String(by)}</p>
      <p style="margin-top:16px">If you did not request this change, you can ignore this email.</p>
    </div>
  `;

  const info = await sendMail({
    from,
    to: toEmail,
    subject,
    text,
    html,
  });

  return info;
}

async function sendStaffOnboardingVerificationEmail({ toEmail, code, requestedBy, expiresInMinutes = 10 }) {
  const fromName = config.smtpFromName || 'Smiles Dental Hub';
  const from = `"${fromName}" <${config.smtpFromEmail}>`;
  const by = requestedBy || 'Smiles Dental Hub';

  const subject = 'Smiles Dental Hub - Staff Onboarding Verification Code';
  const text = [
    'Hello,',
    '',
    'We received a request to verify your email for staff onboarding in Smiles Dental Hub.',
    '',
    `Verification code: ${code}`,
    `This code expires in ${expiresInMinutes} minutes.`,
    '',
    `Requested by: ${by}`,
    '',
    'If you did not request this verification, you can ignore this email.',
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937;line-height:1.6">
      <p>Hello,</p>
      <p>We received a request to verify your email for <strong>staff onboarding</strong> in <strong>Smiles Dental Hub</strong>.</p>
      <p>Enter the code below to continue setting up your account details.</p>
      <div style="margin:20px 0;padding:16px;border-radius:12px;background:#f4fafb;border:1px solid #d7e8ef;text-align:center">
        <div style="font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#4c6b7a;margin-bottom:6px">Verification Code</div>
        <div style="font-size:32px;font-weight:800;letter-spacing:0.18em;color:#0f6f96">${String(code)}</div>
      </div>
      <p><strong>This code expires in ${expiresInMinutes} minutes.</strong></p>
      <p style="margin-top:16px"><strong>Requested by:</strong> ${String(by)}</p>
      <p style="margin-top:16px">If you did not request this verification, you can ignore this email.</p>
    </div>
  `;

  const info = await sendMail({
    from,
    to: toEmail,
    subject,
    text,
    html,
  });

  return info;
}

async function sendPatientRegistrationVerificationEmail({
  toEmail,
  code,
  requestedBy,
  expiresInMinutes = 10,
  changes = [],
  mode = 'registration',
}) {
  const fromName = config.smtpFromName || 'Smiles Dental Hub';
  const from = `"${fromName}" <${config.smtpFromEmail}>`;
  const by = requestedBy || 'Smiles Dental Hub';
  const isUpdateFlow = mode === 'update';

  const validChanges = Array.isArray(changes)
    ? changes.filter((c) => c && typeof c.label === 'string')
    : [];

  const changesTextBlock = validChanges.length > 0
    ? [
        '',
        'Changes being requested:',
        ...validChanges.map((c) => `  • ${c.label}: ${c.oldValue} → ${c.newValue}`),
      ].join('\n')
    : '';

  const changesHtmlBlock = validChanges.length > 0
    ? `<div style="margin:16px 0">
        <p style="font-weight:700;margin:0 0 8px">Changes being requested:</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:#eef4f7">
              <th style="text-align:left;padding:6px 10px;border:1px solid #d7e8ef">Field</th>
              <th style="text-align:left;padding:6px 10px;border:1px solid #d7e8ef">Old Value</th>
              <th style="text-align:left;padding:6px 10px;border:1px solid #d7e8ef">New Value</th>
            </tr>
          </thead>
          <tbody>
            ${validChanges.map((c, i) => `
              <tr style="background:${i % 2 === 0 ? '#fff' : '#f9fcfd'}">
                <td style="padding:6px 10px;border:1px solid #d7e8ef;font-weight:600">${String(c.label)}</td>
                <td style="padding:6px 10px;border:1px solid #d7e8ef;color:#6b8899">${String(c.oldValue)}</td>
                <td style="padding:6px 10px;border:1px solid #d7e8ef;color:#0f6f96;font-weight:600">${String(c.newValue)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`
    : '';

  const subject = isUpdateFlow
    ? 'Smiles Dental Hub - Patient Record Update Verification'
    : 'Smiles Dental Hub - New Patient Record Verification';
  const text = [
    'Hello,',
    '',
    isUpdateFlow
      ? 'A patient record update in Smiles Dental Hub is waiting for your email confirmation.'
      : 'A new patient record in Smiles Dental Hub is waiting for your email confirmation.',
    changesTextBlock,
    '',
    `Verification code: ${code}`,
    `This code expires in ${expiresInMinutes} minutes.`,
    '',
    `Requested by: ${by}`,
    '',
    isUpdateFlow
      ? 'Give this code to the clinic staff to authorize the update.'
      : 'Give this code to the clinic staff to authorize the new patient record.',
    'If you did not request this, you can ignore this email.',
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937;line-height:1.6">
      <p>Hello,</p>
      <p>${isUpdateFlow
        ? 'A patient record update in <strong>Smiles Dental Hub</strong> is waiting for your email confirmation.'
        : 'A new patient record in <strong>Smiles Dental Hub</strong> is waiting for your email confirmation.'}</p>
      ${changesHtmlBlock}
      <p>${isUpdateFlow
        ? 'Enter the verification code below to authorize these changes:'
        : 'Enter the verification code below to authorize this new patient record:'}</p>
      <div style="margin:20px 0;padding:16px;border-radius:12px;background:#f4fafb;border:1px solid #d7e8ef;text-align:center">
        <div style="font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#4c6b7a;margin-bottom:6px">Verification Code</div>
        <div style="font-size:32px;font-weight:800;letter-spacing:0.18em;color:#0f6f96">${String(code)}</div>
      </div>
      <p><strong>This code expires in ${expiresInMinutes} minutes.</strong></p>
      <p style="margin-top:16px"><strong>Requested by:</strong> ${String(by)}</p>
      <p style="margin-top:16px">${isUpdateFlow
        ? 'Give this code to the clinic staff to authorize the update to your patient record.'
        : 'Give this code to the clinic staff to authorize creation of your new patient record.'}</p>
      <p style="margin-top:8px;color:#dc2626"><strong>If you did not request this change, please contact the clinic immediately.</strong></p>
    </div>
  `;

  const info = await sendMail({
    from,
    to: toEmail,
    subject,
    text,
    html,
  });

  return info;
}

async function sendPasswordResetVerificationEmail({ toEmail, code, expiresInMinutes = 10 }) {
  const fromName = config.smtpFromName || 'Smiles Dental Hub';
  const from = `"${fromName}" <${config.smtpFromEmail}>`;

  const subject = 'Smiles Dental Hub - Password Reset Verification Code';
  const text = [
    'Hello,',
    '',
    'Use this code to reset your Smiles Dental Hub password:',
    '',
    `${code}`,
    '',
    `This code expires in ${expiresInMinutes} minutes.`,
    '',
    'If you did not request a password reset, you can ignore this email.',
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937;line-height:1.6">
      <p>Hello,</p>
      <p>Use this code to reset your <strong>Smiles Dental Hub</strong> password:</p>
      <div style="margin:20px 0;padding:16px;border-radius:12px;background:#f4fafb;border:1px solid #d7e8ef;text-align:center">
        <div style="font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#4c6b7a;margin-bottom:6px">Reset Code</div>
        <div style="font-size:32px;font-weight:800;letter-spacing:0.18em;color:#0f6f96">${String(code)}</div>
      </div>
      <p><strong>This code expires in ${expiresInMinutes} minutes.</strong></p>
      <p style="margin-top:16px">If you did not request a password reset, you can ignore this email.</p>
    </div>
  `;

  const info = await sendMail({
    from,
    to: toEmail,
    subject,
    text,
    html,
  });

  return info;
}

async function sendFailedLoginAlertEmail({ toEmail, attemptedAt, failedAttempts = 4 }) {
  const fromName = config.smtpFromName || 'Smiles Dental Hub';
  const from = `"${fromName}" <${config.smtpFromEmail}>`;
  const formattedAttemptedAt = formatEmailTimestamp(attemptedAt || new Date());

  const subject = 'Smiles Dental Hub - Security Alert for Failed Login Attempts';
  const text = [
    'Hello,',
    '',
    `We noticed ${failedAttempts} unsuccessful password attempts on your Smiles Dental Hub account.`,
    'This may mean that someone is trying to access your account.',
    '',
    `Time detected: ${formattedAttemptedAt}`,
    '',
    'If this was you, you can safely disregard this message.',
    'If this was not you, we recommend changing your password as soon as possible and checking your account activity.',
    '',
    'Your account was not unlocked by this email. It is only a security notice.',
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937;line-height:1.6">
      <p>Hello,</p>
      <p>We noticed <strong>${Number(failedAttempts)}</strong> unsuccessful password attempts on your <strong>Smiles Dental Hub</strong> account.</p>
      <p>This may mean that someone is trying to access your account.</p>
      <div style="margin:20px 0;padding:16px;border-radius:12px;background:#fff7ed;border:1px solid #fed7aa">
        <div style="font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#9a3412;margin-bottom:6px">Security Notice</div>
        <div><strong>Time detected:</strong> ${String(formattedAttemptedAt)}</div>
      </div>
      <p>If this was you, you can safely disregard this message.</p>
      <p>If this was not you, we recommend changing your password as soon as possible and checking your account activity.</p>
      <p style="margin-top:16px">This email does not unlock the account. It is only a warning for suspicious login activity.</p>
    </div>
  `;

  const info = await sendMail({
    from,
    to: toEmail,
    subject,
    text,
    html,
  });

  return info;
}

module.exports = {
  isSmtpConfigured,
  sendEmailChangeVerificationEmail,
  sendFailedLoginAlertEmail,
  sendPatientRegistrationVerificationEmail,
  sendPasswordResetVerificationEmail,
  sendStaffOnboardingVerificationEmail,
  sendWelcomeTestEmail,
};
