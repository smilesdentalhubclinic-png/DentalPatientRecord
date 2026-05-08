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

function createTransporter() {
  if (!isSmtpConfigured()) {
    throw new Error('SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM_EMAIL.');
  }

  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: {
      user: config.smtpUser,
      pass: config.smtpPass,
    },
  });
}

async function sendWelcomeTestEmail({ toEmail, requestedBy }) {
  const transporter = createTransporter();
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

  const info = await transporter.sendMail({
    from,
    to: toEmail,
    subject,
    text,
    html,
  });

  return info;
}

async function sendEmailChangeVerificationEmail({ toEmail, code, requestedBy, expiresInMinutes = 10 }) {
  const transporter = createTransporter();
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

  const info = await transporter.sendMail({
    from,
    to: toEmail,
    subject,
    text,
    html,
  });

  return info;
}

async function sendStaffOnboardingVerificationEmail({ toEmail, code, requestedBy, expiresInMinutes = 10 }) {
  const transporter = createTransporter();
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

  const info = await transporter.sendMail({
    from,
    to: toEmail,
    subject,
    text,
    html,
  });

  return info;
}

async function sendPatientRegistrationVerificationEmail({ toEmail, code, requestedBy, expiresInMinutes = 10 }) {
  const transporter = createTransporter();
  const fromName = config.smtpFromName || 'Smiles Dental Hub';
  const from = `"${fromName}" <${config.smtpFromEmail}>`;
  const by = requestedBy || 'Smiles Dental Hub';

  const subject = 'Smiles Dental Hub - Patient Registration Verification Code';
  const text = [
    'Hello,',
    '',
    'A patient registration in Smiles Dental Hub is waiting for your email confirmation.',
    '',
    `Verification code: ${code}`,
    `This code expires in ${expiresInMinutes} minutes.`,
    '',
    `Requested by: ${by}`,
    '',
    'If you are currently reviewing your patient record, give this code to the clinic staff or enter it on the clinic device.',
    'If you did not request this verification, you can ignore this email.',
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937;line-height:1.6">
      <p>Hello,</p>
      <p>A patient registration in <strong>Smiles Dental Hub</strong> is waiting for your email confirmation.</p>
      <p>Enter the code below to confirm the patient details before the clinic saves the record.</p>
      <div style="margin:20px 0;padding:16px;border-radius:12px;background:#f4fafb;border:1px solid #d7e8ef;text-align:center">
        <div style="font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#4c6b7a;margin-bottom:6px">Verification Code</div>
        <div style="font-size:32px;font-weight:800;letter-spacing:0.18em;color:#0f6f96">${String(code)}</div>
      </div>
      <p><strong>This code expires in ${expiresInMinutes} minutes.</strong></p>
      <p style="margin-top:16px"><strong>Requested by:</strong> ${String(by)}</p>
      <p style="margin-top:16px">If you are currently reviewing your patient record, give this code to the clinic staff or enter it on the clinic device.</p>
      <p style="margin-top:16px">If you did not request this verification, you can ignore this email.</p>
    </div>
  `;

  const info = await transporter.sendMail({
    from,
    to: toEmail,
    subject,
    text,
    html,
  });

  return info;
}

async function sendPasswordResetVerificationEmail({ toEmail, code, expiresInMinutes = 10 }) {
  const transporter = createTransporter();
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

  const info = await transporter.sendMail({
    from,
    to: toEmail,
    subject,
    text,
    html,
  });

  return info;
}

async function sendFailedLoginAlertEmail({ toEmail, attemptedAt, failedAttempts = 4 }) {
  const transporter = createTransporter();
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

  const info = await transporter.sendMail({
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
