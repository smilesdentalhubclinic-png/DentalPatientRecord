export const PERSON_NAME_PATTERN = /^[A-Za-z]+(?: [A-Za-z]+)*$/

export const sanitizeLetterNameInput = (value) => (
  `${value ?? ''}`
    .replace(/[^A-Za-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^\s+/g, '')
)

export const isValidLetterName = (value, { allowEmpty = false } = {}) => {
  const normalized = sanitizeLetterNameInput(value).trim()
  if (!normalized) return allowEmpty
  return PERSON_NAME_PATTERN.test(normalized)
}
