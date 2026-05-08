-- Allow patient registration email verification codes in verification_codes.

alter table public.verification_codes
  drop constraint if exists verification_codes_purpose_check;

alter table public.verification_codes
  add constraint verification_codes_purpose_check
  check (
    purpose in (
      'email_change',
      'staff_onboarding',
      'password_reset',
      'patient_registration'
    )
  );
