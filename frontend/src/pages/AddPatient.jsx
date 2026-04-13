import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { isValidLetterName, sanitizeLetterNameInput } from '../utils/nameValidation'

const STEPS = ['Patient Information', 'Medical History', 'Dental History', 'Authorization']
const SEX_OPTIONS = ['Male', 'Female']
const CIVIL_STATUS_OPTIONS = ['Single', 'Married', 'Widowed', 'Divorced', 'Separated']

const MEDICAL_QUESTIONS = [
  { text: 'Are you in a good health?' },
  { text: 'Are you under medical treatment now?', note: 'If so, what is the condition being treated?' },
  { text: 'Have you ever had serious illness or surgical operation?' },
  { text: 'Have you ever been hospitalized?', note: 'If so, when and why?' },
  { text: 'Are you taking any prescription/non-prescription medication?', note: 'If so, please specify:' },
  { text: 'Do you use tobacco products?' },
  { text: 'Do you use alcohol, cocaine or other dangerous drugs?' },
  { text: 'Are you pregnant?' },
  { text: 'Are you breastfeeding?' },
  { text: 'Are you taking birth control pills?' },
]

const DENTAL_QUESTIONS = [
  { text: 'Do you feel pain in any of your teeth?' },
  { text: 'Are you under medical treatment now?', note: 'If so, what is the condition being treated?' },
  { text: 'Are your teeth sensitive to hot/cold liquids/food?' },
  { text: 'Are your teeth sensitive to sweet/sour liquids/food?' },
  { text: 'Do your gums bleed while brushing/flossing?' },
  { text: 'Do you have sores/lumps in/near your mouth?' },
  { text: 'Have you had orthodontic work in the past? (Braces, retainers, etc.)' },
  { text: 'Do you have any exposure to local anesthesia?' },
  { text: 'Have you had unfavorable reaction from anesthesia (eg. Lidocaine)?' },
  { text: 'Have you had problems after tooth extraction?' },
  { text: 'Have you had serious problems associated with dental treatment?' },
  { text: 'Have you had any head, neck or jaw injury?' },
  { text: 'Do you have any oral habit? (thumb sucking, mouth breathing, tongue thrusting, teeth clenching or grinding)' },
  { text: 'Do you have difficulty opening/closing your mouth?' },
  { text: 'Are you satisfied with the appearance of your teeth?' },
  { text: 'Have you had tooth bleaching/whitening done in the past?' },
  { text: 'Does dental treatment make you nervous?' },
  { text: 'Would you like to have regular recall appointments every 6 months?' },
]

const CHECKBOX_CONDITIONS = [
  'Low Blood Pressure',
  'Severe Headaches',
  'High Blood Pressure',
  'Weight Loss',
  'Heart Disease',
  'Stroke',
  'Asthma',
  'Tuberculosis',
  'Diabetes',
  'Radiation Therapy',
  'Respiratory Problems',
  'Anemia/Blood Disease',
  'Hay Fever/Allergies',
  'Arthritis/Rheumatism',
  'Epilepsy/Convulsions',
  'Bleeding Problems',
  'Fainting/Seizures',
  'Heart Murmur',
  'Rheumatic Fever',
  'Kidney Disease',
  'Stomach Trouble/Ulcers',
  'Heart Surgery/Heart Attack',
  'Angina pectoris, chest pain',
  'Sexually Transmitted Disease',
  'Joint Replacement/Implant',
  'Hepatitis/Liver Disease',
  'Thyroid Problems',
  'Cancer/Tumors',
  'Head Injuries',
  'AIDS or HIV Infection',
  'Others',
]

const INITIAL_ALLERGEN_INFO = {
  localAnesthetic: false,
  penicillin: false,
  sulfaDrugs: false,
  latex: false,
  aspirin: false,
  others: false,
  othersText: '',
}

const ALLERGEN_FIELD_MAP = {
  'Local Anesthetic (ex. Lidocaine)': 'localAnesthetic',
  'Penicillin/Antibiotics': 'penicillin',
  'Sulfa Drugs': 'sulfaDrugs',
  'Latex/Rubber': 'latex',
  Aspirin: 'aspirin',
}

const INITIAL_PATIENT_INFO = {
  lastName: '',
  firstName: '',
  middleName: '',
  suffix: '',
  birthdate: '',
  sex: '',
  age: '',
  nickname: '',
  email: '',
  civilStatus: '',
  currentAddress: '',
  mobileNumber: '',
  occupation: '',
  officeAddress: '',
  guardianName: '',
  guardianMobileNumber: '',
  guardianOccupation: '',
  guardianOfficeAddress: '',
}

const INITIAL_MEDICAL_DETAILS = {
  physicianName: '',
  specialty: '',
  address: '',
}

const INITIAL_DENTAL_DETAILS = {
  previousDentist: '',
  lastExamDate: '',
  consultationReason: '',
}

const INITIAL_CHECKBOX_CONDITIONS = CHECKBOX_CONDITIONS.reduce((accumulator, condition) => {
  accumulator[condition] = false
  return accumulator
}, {})
const INITIAL_CHECKBOX_CONDITIONS_OTHER_TEXT = ''

const ADD_PATIENT_DRAFT_KEY = 'dent22.addPatientDraft.v1'

const clampStep = (value, maxStep) => {
  if (!Number.isInteger(value)) return 0
  return Math.max(0, Math.min(value, maxStep))
}

const calculateAgeFromBirthdate = (birthdate) => {
  const raw = `${birthdate || ''}`.trim()
  if (!raw) return ''
  const dob = new Date(raw)
  if (Number.isNaN(dob.getTime())) return ''
  const now = new Date()
  let age = now.getFullYear() - dob.getFullYear()
  const monthDelta = now.getMonth() - dob.getMonth()
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < dob.getDate())) age -= 1
  return age >= 0 ? String(age) : ''
}

const getMaxBirthdateIso = () => {
  const maxBirthdate = new Date()
  maxBirthdate.setFullYear(maxBirthdate.getFullYear() - 2)
  return maxBirthdate.toISOString().slice(0, 10)
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const formatBirthdateDisplay = (isoDate) => {
  const raw = `${isoDate || ''}`.trim()
  if (!raw) return ''
  const parts = raw.split('-')
  if (parts.length !== 3) return ''
  const [year, month, day] = parts
  if (!year || !month || !day) return ''
  return `${day}/${month}/${year}`
}

const formatBirthdateLongDisplay = (isoDate) => {
  const raw = `${isoDate || ''}`.trim()
  if (!raw) return ''
  const parts = raw.split('-')
  if (parts.length !== 3) return ''
  const [year, month, day] = parts
  const monthIndex = Number(month) - 1
  const dayNumber = Number(day)
  if (!year || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11 || !Number.isInteger(dayNumber)) return ''
  return `${MONTH_NAMES[monthIndex]} ${dayNumber}, ${year}`
}

const parseBirthdateDisplay = (displayDate) => {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(`${displayDate || ''}`.trim())
  if (!match) return null

  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const formatPatientCode = (patientCode, patientId) => {
  const raw = `${patientCode || ''}`.trim()
  if (/^PT-\d{6}$/.test(raw)) return raw

  const digits = raw.replace(/\D/g, '')
  if (digits) return `PT-${digits.slice(-6).padStart(6, '0')}`

  const fallbackDigits = `${patientId || ''}`.replace(/\D/g, '').slice(-6)
  return `PT-${fallbackDigits.padStart(6, '0')}`
}

const normalizeBirthdateTyping = (value) => {
  const digits = `${value || ''}`.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

const normalizePhilippineLocalMobile = (value = '') => `${value}`.replace(/\D/g, '').slice(0, 10)

const formatPhilippineE164 = (value = '') => {
  const digits = normalizePhilippineLocalMobile(value)
  return digits ? `+63${digits}` : null
}

const normalizeObject = (value, fallback) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...fallback }
  return { ...fallback, ...value }
}

const normalizeBooleanMap = (value, fallback) => {
  const normalized = { ...fallback }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return normalized
  for (const key of Object.keys(fallback)) {
    normalized[key] = Boolean(value[key])
  }
  return normalized
}

function YesNoQuestion({
  index,
  item,
  prefix,
  answerValue,
  noteValue,
  onAnswerChange,
  onNoteChange,
  hasError = false,
  noteError = false,
}) {
  const fieldName = `${prefix}-${index}`
  const showFollowup = answerValue === 'YES'

  return (
    <div className={`yes-no-item ${hasError || noteError ? 'input-error' : ''}`}>
      <p>
        <span className="required-label">
          {item.text}
          <span className="required-asterisk">*</span>
        </span>
      </p>
      <div className="yes-no-row">
        <label>
          <input
            type="radio"
            name={fieldName}
            checked={answerValue === 'YES'}
            onClick={() => {
              if (answerValue === 'YES') onAnswerChange?.('')
            }}
            onChange={() => onAnswerChange?.('YES')}
          />
          Yes
        </label>
        <label>
          <input
            type="radio"
            name={fieldName}
            checked={answerValue === 'NO'}
            onClick={() => {
              if (answerValue === 'NO') onAnswerChange?.('')
            }}
            onChange={() => onAnswerChange?.('NO')}
          />
          No
        </label>
        {item.note && showFollowup ? (
          <label className="note-field">
            <span>{item.note}</span>
            <input className={noteError ? 'input-error' : ''} type="text" value={noteValue || ''} onChange={(e) => onNoteChange?.(e.target.value)} />
          </label>
        ) : null}
      </div>
    </div>
  )
}

function AddPatient() {
  const [activeStep, setActiveStep] = useState(0)
  const [maxReachedStep, setMaxReachedStep] = useState(0)
  const [medicalAnswers, setMedicalAnswers] = useState({})
  const [medicalNotes, setMedicalNotes] = useState({})
  const [dentalAnswers, setDentalAnswers] = useState({})
  const [dentalNotes, setDentalNotes] = useState({})
  const [authorizationAccepted, setAuthorizationAccepted] = useState(false)
  const [isSubmitConfirmOpen, setIsSubmitConfirmOpen] = useState(false)
  const [isSubmitSuccessOpen, setIsSubmitSuccessOpen] = useState(false)
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [validationMessage, setValidationMessage] = useState('')
  const [allergenInfo, setAllergenInfo] = useState(INITIAL_ALLERGEN_INFO)
  const [patientInfo, setPatientInfo] = useState(INITIAL_PATIENT_INFO)
  const [medicalDetails, setMedicalDetails] = useState(INITIAL_MEDICAL_DETAILS)
  const [dentalDetails, setDentalDetails] = useState(INITIAL_DENTAL_DETAILS)
  const [checkedConditions, setCheckedConditions] = useState(INITIAL_CHECKBOX_CONDITIONS)
  const [checkedConditionsOtherText, setCheckedConditionsOtherText] = useState(INITIAL_CHECKBOX_CONDITIONS_OTHER_TEXT)
  const [isDraftHydrated, setIsDraftHydrated] = useState(false)
  const [birthdateInput, setBirthdateInput] = useState('')
  const [invalidPatientFields, setInvalidPatientFields] = useState({})
  const [invalidMedicalAnswers, setInvalidMedicalAnswers] = useState({})
  const [invalidMedicalNotes, setInvalidMedicalNotes] = useState({})
  const [invalidDentalAnswers, setInvalidDentalAnswers] = useState({})
  const [invalidDentalNotes, setInvalidDentalNotes] = useState({})
  const [invalidAuthorization, setInvalidAuthorization] = useState(false)
  const maxBirthdateIso = getMaxBirthdateIso()
  const birthdatePickerRef = useRef(null)

  const isMinor = Number(patientInfo.age) > 0 && Number(patientInfo.age) < 18

  useEffect(() => {
    try {
      const serializedDraft = sessionStorage.getItem(ADD_PATIENT_DRAFT_KEY)
      if (!serializedDraft) {
        setIsDraftHydrated(true)
        return
      }

      const parsedDraft = JSON.parse(serializedDraft)
      const restoredActiveStep = clampStep(parsedDraft.activeStep, STEPS.length - 1)
      const restoredMaxStep = Math.max(
        restoredActiveStep,
        clampStep(parsedDraft.maxReachedStep, STEPS.length - 1),
      )

      setActiveStep(restoredActiveStep)
      setMaxReachedStep(restoredMaxStep)
      setMedicalAnswers(normalizeObject(parsedDraft.medicalAnswers, {}))
      setMedicalNotes(normalizeObject(parsedDraft.medicalNotes, {}))
      setDentalAnswers(normalizeObject(parsedDraft.dentalAnswers, {}))
      setDentalNotes(normalizeObject(parsedDraft.dentalNotes, {}))
      setAuthorizationAccepted(Boolean(parsedDraft.authorizationAccepted))
      setAllergenInfo(normalizeObject(parsedDraft.allergenInfo, INITIAL_ALLERGEN_INFO))
      setPatientInfo(normalizeObject(parsedDraft.patientInfo, INITIAL_PATIENT_INFO))
      setMedicalDetails(normalizeObject(parsedDraft.medicalDetails, INITIAL_MEDICAL_DETAILS))
      setDentalDetails(normalizeObject(parsedDraft.dentalDetails, INITIAL_DENTAL_DETAILS))
      setCheckedConditions(
        normalizeBooleanMap(parsedDraft.checkedConditions, INITIAL_CHECKBOX_CONDITIONS),
      )
      setCheckedConditionsOtherText(`${parsedDraft.checkedConditionsOtherText || ''}`)
    } catch {
      sessionStorage.removeItem(ADD_PATIENT_DRAFT_KEY)
    } finally {
      setIsDraftHydrated(true)
    }
  }, [])

  useEffect(() => {
    if (!isDraftHydrated) return

    const draft = {
      activeStep,
      maxReachedStep,
      medicalAnswers,
      medicalNotes,
      dentalAnswers,
      dentalNotes,
      authorizationAccepted,
      allergenInfo,
      patientInfo,
      medicalDetails,
      dentalDetails,
      checkedConditions,
      checkedConditionsOtherText,
    }

    sessionStorage.setItem(ADD_PATIENT_DRAFT_KEY, JSON.stringify(draft))
  }, [
    activeStep,
    allergenInfo,
    authorizationAccepted,
    checkedConditions,
    dentalAnswers,
    dentalDetails,
    dentalNotes,
    isDraftHydrated,
    maxReachedStep,
    medicalAnswers,
    medicalDetails,
    medicalNotes,
    patientInfo,
    checkedConditionsOtherText,
  ])

  useEffect(() => {
    const nextAge = calculateAgeFromBirthdate(patientInfo.birthdate)
    setPatientInfo((previous) => {
      if (previous.age === nextAge) return previous
      return { ...previous, age: nextAge }
    })
  }, [patientInfo.birthdate])

  useEffect(() => {
    setBirthdateInput(formatBirthdateLongDisplay(patientInfo.birthdate))
  }, [patientInfo.birthdate])

  useEffect(() => {
    if (isMinor) return
    setInvalidPatientFields((previous) => {
      if (!previous.guardianName && !previous.guardianMobileNumber && !previous.guardianOccupation) return previous
      const next = { ...previous }
      delete next.guardianName
      delete next.guardianMobileNumber
      delete next.guardianOccupation
      return next
    })
  }, [isMinor])

  const clearPatientFieldError = (field) => {
    setInvalidPatientFields((previous) => {
      if (!previous[field]) return previous
      const next = { ...previous }
      delete next[field]
      return next
    })
  }

  const setPatientField = (field, value) => {
    setPatientInfo((previous) => ({ ...previous, [field]: value }))
    clearPatientFieldError(field)
  }

  const validatePatientInformationStep = () => {
    const requiredFields = [
      'lastName',
      'firstName',
      'birthdate',
      'sex',
      'age',
      'civilStatus',
      'currentAddress',
      'mobileNumber',
      'occupation',
    ]
    const minorRequiredFields = ['guardianName', 'guardianMobileNumber', 'guardianOccupation']
    const fieldsToValidate = isMinor ? [...requiredFields, ...minorRequiredFields] : requiredFields
    const nextInvalidFields = {}
    fieldsToValidate.forEach((field) => {
      if (`${patientInfo[field]}`.trim() === '') nextInvalidFields[field] = true
    })
    const hasMissingRequiredField = fieldsToValidate.some((field) => nextInvalidFields[field])
    const hasInvalidMobile = !/^9\d{9}$/.test(`${patientInfo.mobileNumber || ''}`)
    const hasInvalidGuardianMobile = isMinor && !/^9\d{9}$/.test(`${patientInfo.guardianMobileNumber || ''}`)
    const hasInvalidBirthdateAge = Boolean(patientInfo.birthdate && patientInfo.birthdate > maxBirthdateIso)
    const hasInvalidFirstName = !isValidLetterName(patientInfo.firstName)
    const hasInvalidLastName = !isValidLetterName(patientInfo.lastName)
    const hasInvalidMiddleName = !isValidLetterName(patientInfo.middleName, { allowEmpty: true })
    const hasInvalidOccupation = !isValidLetterName(patientInfo.occupation)
    const hasInvalidGuardianOccupation = isMinor && !isValidLetterName(patientInfo.guardianOccupation)

    if (hasInvalidMobile) nextInvalidFields.mobileNumber = true
    if (hasInvalidGuardianMobile) nextInvalidFields.guardianMobileNumber = true
    if (hasInvalidBirthdateAge) nextInvalidFields.birthdate = true
    if (hasInvalidFirstName) nextInvalidFields.firstName = true
    if (hasInvalidLastName) nextInvalidFields.lastName = true
    if (hasInvalidMiddleName) nextInvalidFields.middleName = true
    if (hasInvalidOccupation) nextInvalidFields.occupation = true
    if (hasInvalidGuardianOccupation) nextInvalidFields.guardianOccupation = true
    setInvalidPatientFields(nextInvalidFields)

    if (hasMissingRequiredField) {
      setValidationMessage('Please complete all required fields marked with * before proceeding.')
      return false
    }

    if (hasInvalidMobile) {
      setValidationMessage('Mobile number must be a valid Philippine number after +63, like 9762911478.')
      return false
    }

    if (hasInvalidGuardianMobile) {
      setValidationMessage('Guardian mobile number must be a valid Philippine number after +63, like 9762911478.')
      return false
    }

    if (hasInvalidBirthdateAge) {
      setValidationMessage('Patient must be at least 2 years old.')
      return false
    }

    if (hasInvalidFirstName || hasInvalidLastName || hasInvalidMiddleName) {
      setValidationMessage('First name, last name, and middle name must contain letters only.')
      return false
    }

    if (hasInvalidOccupation || hasInvalidGuardianOccupation) {
      setValidationMessage('Occupation fields must contain letters only.')
      return false
    }

    return true
  }

  const clearIndexedError = (setter, index) => {
    setter((previous) => {
      if (!previous[index]) return previous
      const next = { ...previous }
      delete next[index]
      return next
    })
  }

  const validateYesNoQuestions = (questions, answers, notes, label, setInvalidAnswers, setInvalidNotes) => {
    const nextInvalidAnswers = {}
    const nextInvalidNotes = {}

    questions.forEach((item, index) => {
      if (!answers[index]) nextInvalidAnswers[index] = true
      if (item.note && answers[index] === 'YES' && `${notes[index] || ''}`.trim() === '') nextInvalidNotes[index] = true
    })

    setInvalidAnswers(nextInvalidAnswers)
    setInvalidNotes(nextInvalidNotes)
    const hasMissingAnswer = Object.keys(nextInvalidAnswers).length > 0
    if (hasMissingAnswer) {
      setValidationMessage(`Please answer all questions under ${label} before proceeding.`)
      return false
    }

    const hasMissingNote = Object.keys(nextInvalidNotes).length > 0
    if (hasMissingNote) {
      setValidationMessage(`Please complete all required follow-up details under ${label}.`)
      return false
    }
    return true
  }

  const findExistingPatientRecord = async () => {
    const normalizedLastName = `${patientInfo.lastName || ''}`.trim().replace(/\s+/g, ' ')
    const normalizedFirstName = `${patientInfo.firstName || ''}`.trim().replace(/\s+/g, ' ')
    const normalizedSex = `${patientInfo.sex || ''}`.trim()
    const normalizedBirthdate = `${patientInfo.birthdate || ''}`.trim()

    if (!normalizedLastName || !normalizedFirstName || !normalizedBirthdate || !normalizedSex) return null

    const { data, error: duplicateCheckError } = await supabase
      .from('patients')
      .select('id, patient_code, first_name, last_name, birth_date, sex, archived_at')
      .ilike('last_name', normalizedLastName)
      .ilike('first_name', normalizedFirstName)
      .eq('birth_date', normalizedBirthdate)
      .eq('sex', normalizedSex)
      .is('archived_at', null)
      .limit(1)

    if (duplicateCheckError) throw duplicateCheckError
    return data?.[0] ?? null
  }

  const nextStep = async () => {
    if (activeStep === 0) {
      if (!validatePatientInformationStep()) return

      try {
        const duplicatePatient = await findExistingPatientRecord()
        if (duplicatePatient) {
          setInvalidPatientFields((previous) => ({
            ...previous,
            lastName: true,
            firstName: true,
            birthdate: true,
            sex: true,
            age: true,
          }))
          setValidationMessage(
            `Existing record found (${formatPatientCode(duplicatePatient.patient_code, duplicatePatient.id)} - ${duplicatePatient.last_name}, ${duplicatePatient.first_name}).`,
          )
          return
        }
      } catch (duplicateCheckError) {
        setValidationMessage(duplicateCheckError?.message || 'Unable to validate existing records.')
        return
      }
    }

    if (activeStep === 1 && !validateYesNoQuestions(
      MEDICAL_QUESTIONS,
      medicalAnswers,
      medicalNotes,
      'Medical History',
      setInvalidMedicalAnswers,
      setInvalidMedicalNotes,
    )) return
    if (activeStep === 2 && !validateYesNoQuestions(
      DENTAL_QUESTIONS,
      dentalAnswers,
      dentalNotes,
      'Dental History',
      setInvalidDentalAnswers,
      setInvalidDentalNotes,
    )) return

    const nextIndex = Math.min(activeStep + 1, STEPS.length - 1)
    setActiveStep(nextIndex)
    setMaxReachedStep((prev) => Math.max(prev, nextIndex))
  }
  const prevStep = () => {
    setActiveStep((prev) => Math.max(prev - 1, 0))
  }
  const goToStep = (index) => {
    if (index <= maxReachedStep) {
      setActiveStep(index)
    }
  }
  const toggleAllergen = (key) => {
    setAllergenInfo((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      if (key === 'others' && prev.others) next.othersText = ''
      return next
    })
  }
  const toggleCondition = (condition) => {
    setCheckedConditions((prev) => {
      const nextValue = !prev[condition]
      if (condition === 'Others' && !nextValue) {
        setCheckedConditionsOtherText('')
      }
      return { ...prev, [condition]: nextValue }
    })
  }
  const handleFinalSubmit = () => {
    if (!authorizationAccepted) {
      setInvalidAuthorization(true)
      setValidationMessage('Please read and accept the authorization before submitting.')
      return
    }
    setInvalidAuthorization(false)
    setIsSubmitConfirmOpen(true)
  }
  const openDatePicker = (event) => {
    event.currentTarget.showPicker?.()
  }

  const openBirthdatePicker = () => {
    birthdatePickerRef.current?.showPicker?.()
    birthdatePickerRef.current?.focus?.()
  }

  const commitBirthdateFromInput = () => {
    const typedValue = `${birthdateInput || ''}`.trim()
    if (!typedValue) {
      setPatientField('birthdate', '')
      setBirthdateInput('')
      return
    }

    const parsedIso = parseBirthdateDisplay(typedValue)
    if (!parsedIso) {
      setValidationMessage('Birthdate must follow DD/MM/YYYY format.')
      setPatientField('birthdate', '')
      setInvalidPatientFields((previous) => ({ ...previous, birthdate: true }))
      return
    }

    if (parsedIso > maxBirthdateIso) {
      setValidationMessage('Patient must be at least 2 years old.')
      setPatientField('birthdate', '')
      setInvalidPatientFields((previous) => ({ ...previous, birthdate: true }))
      return
    }

    setPatientField('birthdate', parsedIso)
    setBirthdateInput(formatBirthdateLongDisplay(parsedIso))
  }

  const normalizeSex = (value) => {
    const normalized = `${value || ''}`.trim().toLowerCase()
    if (normalized === 'm' || normalized === 'male') return 'Male'
    if (normalized === 'f' || normalized === 'female') return 'Female'
    return null
  }

  const normalizeCivilStatus = (value) => {
    const normalized = `${value || ''}`.trim().toLowerCase()
    if (normalized === 'single') return 'Single'
    if (normalized === 'married') return 'Married'
    if (normalized === 'widowed') return 'Widowed'
    if (normalized === 'divorced') return 'Divorced'
    if (normalized === 'separated') return 'Separated'
    return null
  }

  const toTitleCase = (value) => {
    const raw = `${value ?? ''}`
    if (!raw.trim()) return raw
    return raw.toLowerCase().replace(/\b[a-z]/g, (match) => match.toUpperCase())
  }

  const formatLetterNameInput = (value) => toTitleCase(sanitizeLetterNameInput(value))

  const confirmSubmission = async () => {
    if (!validatePatientInformationStep()) return
    setIsSubmitting(true)
    const normalizedMedicalNotes = Object.fromEntries(
      Object.entries(medicalNotes || {}).map(([key, value]) => [key, toTitleCase(value)]),
    )
    const normalizedDentalNotes = Object.fromEntries(
      Object.entries(dentalNotes || {}).map(([key, value]) => [key, toTitleCase(value)]),
    )
    const patientPayload = {
      first_name: toTitleCase(patientInfo.firstName.trim()),
      last_name: toTitleCase(patientInfo.lastName.trim()),
      middle_name: toTitleCase(patientInfo.middleName.trim()) || null,
      suffix: toTitleCase(patientInfo.suffix.trim()) || null,
      sex: normalizeSex(patientInfo.sex),
      birth_date: patientInfo.birthdate || null,
      phone: formatPhilippineE164(patientInfo.mobileNumber),
      email: patientInfo.email.trim() || null,
      address: toTitleCase(patientInfo.currentAddress.trim()) || null,
      nickname: toTitleCase(patientInfo.nickname.trim()) || null,
      civil_status: normalizeCivilStatus(patientInfo.civilStatus),
      occupation: toTitleCase(patientInfo.occupation.trim()) || null,
      office_address: toTitleCase(patientInfo.officeAddress.trim()) || null,
      emergency_contact_name: toTitleCase((isMinor ? patientInfo.guardianName : '').trim()) || null,
      emergency_contact_phone: isMinor ? formatPhilippineE164(patientInfo.guardianMobileNumber) : null,
      guardian_name: toTitleCase((isMinor ? patientInfo.guardianName : '').trim()) || null,
      guardian_mobile_number: isMinor ? formatPhilippineE164(patientInfo.guardianMobileNumber) : null,
      guardian_occupation: toTitleCase((isMinor ? patientInfo.guardianOccupation : '').trim()) || null,
      guardian_office_address: toTitleCase((isMinor ? patientInfo.guardianOfficeAddress : '').trim()) || null,
      health_conditions: {
        ...checkedConditions,
        othersText: checkedConditions.Others ? toTitleCase(checkedConditionsOtherText.trim()) : '',
      },
      allergen_info: {
        values: Object.fromEntries(
          Object.entries(ALLERGEN_FIELD_MAP).map(([label, key]) => [label, Boolean(allergenInfo[key])]),
        ),
        others: allergenInfo.others ? toTitleCase(allergenInfo.othersText || '') : '',
      },
      medical_history: {
        physician: toTitleCase(medicalDetails.physicianName.trim()),
        specialty: toTitleCase(medicalDetails.specialty.trim()),
        address: toTitleCase(medicalDetails.address.trim()),
        answers: medicalAnswers,
        notes: normalizedMedicalNotes,
      },
      dental_history: {
        previous: toTitleCase(dentalDetails.previousDentist.trim()),
        lastExam: dentalDetails.lastExamDate.trim(),
        reason: toTitleCase(dentalDetails.consultationReason.trim()),
        answers: dentalAnswers,
        notes: normalizedDentalNotes,
      },
      authorization_accepted: authorizationAccepted,
      is_active: true,
    }

    const getFallbackPatientCode = async () => {
      const { data, error: fetchError } = await supabase
        .from('patients')
        .select('patient_code')
        .order('patient_code', { ascending: false })
        .limit(1)

      if (fetchError) throw fetchError

      const rawLatest = `${data?.[0]?.patient_code ?? 'PT-000000'}`
      const latestDigits = Number(rawLatest.replace(/\D/g, '')) || 0
      const nextNumber = latestDigits + 1
      if (nextNumber > 999999) {
        throw new Error('Patient code limit reached. Please contact administrator.')
      }
      return `PT-${String(nextNumber).padStart(6, '0')}`
    }

    const insertPatientWithRetry = async () => {
      let explicitPatientCode = null
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const payload = explicitPatientCode
          ? { ...patientPayload, patient_code: explicitPatientCode }
          : patientPayload

        const { data, error: insertError } = await supabase
          .from('patients')
          .insert(payload)
          .select('id')
          .single()

        if (!insertError) return data

        const errorText = `${insertError.message || ''} ${insertError.details || ''}`
        const isPatientCodeConflict = insertError.code === '23505' && errorText.includes('patients_patient_code_key')
        if (!isPatientCodeConflict) {
          throw insertError
        }

        explicitPatientCode = await getFallbackPatientCode()
      }

      throw new Error('Unable to generate a unique patient code. Please run patient code SQL hotfix and retry.')
    }

    try {
      const duplicatePatient = await findExistingPatientRecord()
      if (duplicatePatient) {
        setInvalidPatientFields((previous) => ({
          ...previous,
          lastName: true,
          firstName: true,
          birthdate: true,
          sex: true,
          age: true,
        }))
        setIsSubmitConfirmOpen(false)
        setValidationMessage(
          `Existing record found (${formatPatientCode(duplicatePatient.patient_code, duplicatePatient.id)} - ${duplicatePatient.last_name}, ${duplicatePatient.first_name}).`,
        )
        return
      }

      const insertedPatient = await insertPatientWithRetry()

      const { error: logError } = await supabase.from('patient_logs').insert({
        patient_id: insertedPatient.id,
        action: 'create_patient',
        details: 'Created via Add Patient form',
      })

      if (logError) throw logError

      sessionStorage.removeItem(ADD_PATIENT_DRAFT_KEY)
      setIsSubmitConfirmOpen(false)
      setIsSubmitSuccessOpen(true)
    } catch (submitError) {
      const fallback = 'Unable to save patient record.'
      setValidationMessage(submitError?.message || fallback)
    } finally {
      setIsSubmitting(false)
    }
  }
  const resetAddPatientForm = () => {
    setActiveStep(0)
    setMaxReachedStep(0)
    setMedicalAnswers({})
    setMedicalNotes({})
    setDentalAnswers({})
    setDentalNotes({})
    setAuthorizationAccepted(false)
    setAllergenInfo(INITIAL_ALLERGEN_INFO)
    setPatientInfo(INITIAL_PATIENT_INFO)
    setMedicalDetails(INITIAL_MEDICAL_DETAILS)
    setDentalDetails(INITIAL_DENTAL_DETAILS)
    setCheckedConditions(INITIAL_CHECKBOX_CONDITIONS)
    setCheckedConditionsOtherText(INITIAL_CHECKBOX_CONDITIONS_OTHER_TEXT)
    setBirthdateInput('')
    setInvalidPatientFields({})
    setInvalidMedicalAnswers({})
    setInvalidMedicalNotes({})
    setInvalidDentalAnswers({})
    setInvalidDentalNotes({})
    setInvalidAuthorization(false)
    setValidationMessage('')
    setIsSubmitConfirmOpen(false)
    setIsSubmitSuccessOpen(false)
    setIsClearConfirmOpen(false)
    sessionStorage.removeItem(ADD_PATIENT_DRAFT_KEY)
  }
  const handleSuccessAcknowledge = () => {
    setIsSubmitSuccessOpen(false)
    resetAddPatientForm()
  }

  return (
    <>
      <header className="page-header">
        <h1>Add Patient Record</h1>
      </header>

      <section className={`panel tabs-panel add-patient-prototype ${activeStep === 3 ? 'authorization-step-active' : ''}`}>
        <div className="panel-tabs add-patient-tabs">
          {STEPS.map((step, index) => (
            <button
              key={step}
              type="button"
              className={`tab ${activeStep === index ? 'active' : ''}`}
              onClick={() => goToStep(index)}
              disabled={index > maxReachedStep}
            >
              {step}
            </button>
          ))}
        </div>

        {activeStep === 0 ? (
          <>
            <div className="add-patient-title-row">
              <h2 className="panel-title">Patient Information</h2>
              <button
                type="button"
                className="ghost add-patient-clear-btn"
                onClick={() => setIsClearConfirmOpen(true)}
              >
                Clear All
              </button>
            </div>

            <div className="form-grid patient-info-grid">
              <label className="patient-span-3">
                <span className="required-label">Last Name<span className="required-asterisk">*</span></span>
                <input className={invalidPatientFields.lastName ? 'input-error' : ''} type="text" required value={patientInfo.lastName} onChange={(e) => setPatientField('lastName', formatLetterNameInput(e.target.value))} />
              </label>
              <label className="patient-span-3">
                <span className="required-label">First Name<span className="required-asterisk">*</span></span>
                <input className={invalidPatientFields.firstName ? 'input-error' : ''} type="text" required value={patientInfo.firstName} onChange={(e) => setPatientField('firstName', formatLetterNameInput(e.target.value))} />
              </label>
              <label className="patient-span-3">
                Middle Name
                <input className={invalidPatientFields.middleName ? 'input-error' : ''} type="text" value={patientInfo.middleName} onChange={(e) => setPatientField('middleName', formatLetterNameInput(e.target.value))} />
              </label>
              <label className="patient-span-3">
                Suffix
                <input type="text" value={patientInfo.suffix} onChange={(e) => setPatientInfo((p) => ({ ...p, suffix: toTitleCase(e.target.value) }))} />
              </label>
              <label className="patient-span-3">
                <span className="required-label">Birthdate<span className="required-asterisk">*</span></span>
                <div className="birthdate-input-wrap">
                  <input
                    className={invalidPatientFields.birthdate ? 'input-error' : ''}
                    type="text"
                    required
                    placeholder="DD/MM/YYYY"
                    maxLength={10}
                    style={{ color: birthdateInput ? '#111827' : '#9aa6af' }}
                    value={birthdateInput}
                    onChange={(e) => {
                      clearPatientFieldError('birthdate')
                      setBirthdateInput(normalizeBirthdateTyping(e.target.value))
                    }}
                    onFocus={() => {
                      if (patientInfo.birthdate) {
                        setBirthdateInput(formatBirthdateDisplay(patientInfo.birthdate))
                      }
                    }}
                    onBlur={commitBirthdateFromInput}
                  />
                  <button type="button" className="birthdate-picker-btn" onClick={openBirthdatePicker} aria-label="Open birthdate picker">
                    &#128197;
                  </button>
                  <input
                    ref={birthdatePickerRef}
                    type="date"
                    className="birthdate-picker-hidden"
                    max={maxBirthdateIso}
                    value={patientInfo.birthdate}
                    onChange={(e) => {
                      const iso = e.target.value
                      setPatientField('birthdate', iso)
                      setBirthdateInput(formatBirthdateLongDisplay(iso))
                    }}
                    tabIndex={-1}
                    aria-hidden="true"
                  />
                </div>
              </label>
              <label className="patient-span-3">
                <span className="required-label">Sex<span className="required-asterisk">*</span></span>
                <select
                  className={invalidPatientFields.sex ? 'input-error' : ''}
                  required
                  value={patientInfo.sex}
                  onChange={(e) => setPatientField('sex', e.target.value)}
                  style={{ color: patientInfo.sex ? '#111827' : '#9aa6af' }}
                >
                  <option value="">Select sex</option>
                  {SEX_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label className="patient-span-3">
                <span className="required-label">Age</span>
                <input className={`is-locked ${invalidPatientFields.age ? 'input-error' : ''}`.trim()} type="text" required value={patientInfo.age} readOnly />
              </label>
              <label className="patient-span-3">
                Nickname
                <input type="text" value={patientInfo.nickname} onChange={(e) => setPatientInfo((p) => ({ ...p, nickname: toTitleCase(e.target.value) }))} />
              </label>
              <label className="patient-span-5">
                Email Address
                <input type="text" value={patientInfo.email} onChange={(e) => setPatientInfo((p) => ({ ...p, email: e.target.value }))} />
              </label>
              <label className="patient-span-3">
                <span className="required-label">Civil Status<span className="required-asterisk">*</span></span>
                <select
                  className={invalidPatientFields.civilStatus ? 'input-error' : ''}
                  required
                  value={patientInfo.civilStatus}
                  onChange={(e) => setPatientField('civilStatus', e.target.value)}
                  style={{ color: patientInfo.civilStatus ? '#111827' : '#9aa6af' }}
                >
                  <option value="">Select civil status</option>
                  {CIVIL_STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label className="patient-span-4">
                <span className="required-label">Mobile Number<span className="required-asterisk">*</span></span>
                <div className={`ph-mobile-field ${invalidPatientFields.mobileNumber ? 'input-error' : ''}`}>
                  <span className="ph-mobile-prefix">+63</span>
                  <input
                    className={invalidPatientFields.mobileNumber ? 'input-error' : ''}
                    type="text"
                    required
                    inputMode="numeric"
                    placeholder="9762911478"
                    maxLength={10}
                    pattern="9[0-9]{9}"
                    value={patientInfo.mobileNumber}
                    onChange={(e) => {
                      const rawValue = e.target.value
                      if (/[^0-9]/.test(rawValue)) {
                        setValidationMessage('Only numeric digits are allowed for mobile number.')
                        return
                      }
                      setPatientField('mobileNumber', normalizePhilippineLocalMobile(rawValue))
                    }}
                  />
                </div>
              </label>
              <label className="patient-span-6">
                <span className="required-label">Current Address<span className="required-asterisk">*</span></span>
                <input className={invalidPatientFields.currentAddress ? 'input-error' : ''} type="text" required value={patientInfo.currentAddress} onChange={(e) => setPatientField('currentAddress', toTitleCase(e.target.value))} />
              </label>
              <label className="patient-span-3">
                <span className="required-label">Occupation<span className="required-asterisk">*</span></span>
                <input className={invalidPatientFields.occupation ? 'input-error' : ''} type="text" required value={patientInfo.occupation} onChange={(e) => setPatientField('occupation', formatLetterNameInput(e.target.value))} />
              </label>
              <label className="patient-span-3">
                Office Address
                <input type="text" value={patientInfo.officeAddress} onChange={(e) => setPatientInfo((p) => ({ ...p, officeAddress: toTitleCase(e.target.value) }))} />
              </label>
            </div>

            {isMinor ? (
              <div className="minor-block">
                <p>ADDITIONAL FIELD FOR MINORS</p>
                <div className="form-grid">
                  <label className="span-2">
                    <span className="required-label">Parent/Guardian Name<span className="required-asterisk">*</span></span>
                    <input className={invalidPatientFields.guardianName ? 'input-error' : ''} type="text" required value={patientInfo.guardianName} onChange={(e) => setPatientField('guardianName', toTitleCase(e.target.value))} />
                  </label>
                  <label className="span-2">
                    <span className="required-label">Mobile Number<span className="required-asterisk">*</span></span>
                    <div className={`ph-mobile-field ${invalidPatientFields.guardianMobileNumber ? 'input-error' : ''}`}>
                      <span className="ph-mobile-prefix">+63</span>
                      <input
                        className={invalidPatientFields.guardianMobileNumber ? 'input-error' : ''}
                        type="text"
                        required
                        inputMode="numeric"
                        placeholder="9762911478"
                        maxLength={10}
                        pattern="9[0-9]{9}"
                        value={patientInfo.guardianMobileNumber}
                        onChange={(e) => {
                          const rawValue = e.target.value
                          if (/[^0-9]/.test(rawValue)) {
                            setValidationMessage('Only numeric digits are allowed for mobile number.')
                            return
                          }
                          setPatientField('guardianMobileNumber', normalizePhilippineLocalMobile(rawValue))
                        }}
                      />
                    </div>
                  </label>
                  <label>
                    <span className="required-label">Occupation<span className="required-asterisk">*</span></span>
                    <input className={invalidPatientFields.guardianOccupation ? 'input-error' : ''} type="text" required value={patientInfo.guardianOccupation} onChange={(e) => setPatientField('guardianOccupation', formatLetterNameInput(e.target.value))} />
                  </label>
                  <label className="span-3">
                    Office Address
                    <input type="text" value={patientInfo.guardianOfficeAddress} onChange={(e) => setPatientInfo((p) => ({ ...p, guardianOfficeAddress: toTitleCase(e.target.value) }))} />
                  </label>
                </div>
              </div>
            ) : null}
          </>
        ) : null}

        {activeStep === 1 ? (
          <div className="history-wrapper">
            <h2 className="panel-title">Medical History</h2>

            <div className="history-top-grid">
              <label>
                Name of Physician/Medical Doctor
                <input
                  type="text"
                  value={medicalDetails.physicianName}
                  onChange={(e) => setMedicalDetails((prev) => ({ ...prev, physicianName: toTitleCase(e.target.value) }))}
                />
              </label>
              <label>
                Specialty (if available)
                <input
                  type="text"
                  value={medicalDetails.specialty}
                  onChange={(e) => setMedicalDetails((prev) => ({ ...prev, specialty: toTitleCase(e.target.value) }))}
                />
              </label>
              <label className="span-2">
                Address
                <input
                  type="text"
                  value={medicalDetails.address}
                  onChange={(e) => setMedicalDetails((prev) => ({ ...prev, address: toTitleCase(e.target.value) }))}
                />
              </label>
            </div>

            <section className="history-block">
              <h3>Answer the Following Questions:</h3>
              {MEDICAL_QUESTIONS.map((item, index) => (
                <YesNoQuestion
                  key={item.text}
                  item={item}
                  index={index}
                  prefix="medical"
                  answerValue={medicalAnswers[index]}
                  noteValue={medicalNotes[index]}
                  hasError={Boolean(invalidMedicalAnswers[index])}
                  noteError={Boolean(invalidMedicalNotes[index])}
                  onAnswerChange={(value) => {
                    setMedicalAnswers((p) => ({ ...p, [index]: value }))
                    clearIndexedError(setInvalidMedicalAnswers, index)
                    if (value !== 'YES') {
                      setMedicalNotes((p) => ({ ...p, [index]: '' }))
                      clearIndexedError(setInvalidMedicalNotes, index)
                    }
                  }}
                  onNoteChange={(value) => {
                    setMedicalNotes((p) => ({ ...p, [index]: toTitleCase(value) }))
                    clearIndexedError(setInvalidMedicalNotes, index)
                  }}
                />
              ))}
            </section>

            <section className="history-block allergen-block">
              <h3>Allergen Information</h3>
              <div className="check-group">
                <p>Are you allergic to any of the following?</p>
                <div className="checkbox-grid two-col">
                  <label><input type="checkbox" checked={allergenInfo.localAnesthetic} onChange={() => toggleAllergen('localAnesthetic')} />Local Anesthetic (ex. Lidocaine)</label>
                  <label><input type="checkbox" checked={allergenInfo.penicillin} onChange={() => toggleAllergen('penicillin')} />Penicillin/Antibiotics</label>
                  <label><input type="checkbox" checked={allergenInfo.sulfaDrugs} onChange={() => toggleAllergen('sulfaDrugs')} />Sulfa Drugs</label>
                  <label><input type="checkbox" checked={allergenInfo.others} onChange={() => toggleAllergen('others')} />Others, please specify:</label>
                  <label><input type="checkbox" checked={allergenInfo.latex} onChange={() => toggleAllergen('latex')} />Latex/Rubber</label>
                  <label className="other-field"><input type="text" className={allergenInfo.others ? '' : 'is-hidden'} value={allergenInfo.othersText} onChange={(e) => setAllergenInfo((p) => ({ ...p, othersText: toTitleCase(e.target.value) }))} /></label>
                  <label><input type="checkbox" checked={allergenInfo.aspirin} onChange={() => toggleAllergen('aspirin')} />Aspirin</label>
                </div>
              </div>
            </section>

            <section className="history-block">
              <h3>Check Which Apply:</h3>
              <div className="checkbox-grid four-col">
                {CHECKBOX_CONDITIONS.map((item) => (
                  <label key={item}>
                    <input type="checkbox" checked={Boolean(checkedConditions[item])} onChange={() => toggleCondition(item)} />
                    {item}
                  </label>
                ))}
              </div>
              {checkedConditions.Others ? (
                <div className="history-top-grid">
                  <label className="span-2">
                    Please specify
                    <input
                      type="text"
                      value={checkedConditionsOtherText}
                      onChange={(event) => setCheckedConditionsOtherText(toTitleCase(event.target.value))}
                      placeholder="Specify other condition"
                    />
                  </label>
                </div>
              ) : null}
            </section>
          </div>
        ) : null}

        {activeStep === 2 ? (
          <div className="history-wrapper">
            <h2 className="panel-title">Dental History</h2>

            <div className="history-top-grid">
              <label>
                Name of Previous Dentist
                <input
                  type="text"
                  value={dentalDetails.previousDentist}
                  onChange={(e) => setDentalDetails((prev) => ({ ...prev, previousDentist: toTitleCase(e.target.value) }))}
                />
              </label>
              <label>
                Date of Last Exam
                <input
                  type="date"
                  className="easy-date-input"
                  value={dentalDetails.lastExamDate}
                  onClick={openDatePicker}
                  onFocus={openDatePicker}
                  onChange={(e) => setDentalDetails((prev) => ({ ...prev, lastExamDate: e.target.value }))}
                />
              </label>
              <label className="span-2">
                What is the reason for Dental Consultation?
                <input
                  type="text"
                  value={dentalDetails.consultationReason}
                  onChange={(e) => setDentalDetails((prev) => ({ ...prev, consultationReason: toTitleCase(e.target.value) }))}
                />
              </label>
            </div>

            <section className="history-block">
              <h3>Answer the Following Questions:</h3>
              {DENTAL_QUESTIONS.map((item, index) => (
                <YesNoQuestion
                  key={item.text}
                  item={item}
                  index={index}
                  prefix="dental"
                  answerValue={dentalAnswers[index]}
                  noteValue={dentalNotes[index]}
                  hasError={Boolean(invalidDentalAnswers[index])}
                  noteError={Boolean(invalidDentalNotes[index])}
                  onAnswerChange={(value) => {
                    setDentalAnswers((p) => ({ ...p, [index]: value }))
                    clearIndexedError(setInvalidDentalAnswers, index)
                    if (value !== 'YES') {
                      setDentalNotes((p) => ({ ...p, [index]: '' }))
                      clearIndexedError(setInvalidDentalNotes, index)
                    }
                  }}
                  onNoteChange={(value) => {
                    setDentalNotes((p) => ({ ...p, [index]: toTitleCase(value) }))
                    clearIndexedError(setInvalidDentalNotes, index)
                  }}
                />
              ))}
            </section>
          </div>
        ) : null}

        {activeStep === 3 ? (
          <section className="authorization-wrap">
            <div className="authorization-card">
              <div className="authorization-card-head">
                <span className="authorization-kicker">Patient Consent</span>
                <h2>Authorization and Release</h2>
                <p>
                  Please review this statement carefully before submitting the patient record.
                </p>
              </div>

              <div className="authorization-card-body">
                <div className="authorization-copy">
                  <p>
                    I certify that I have read and understood the questionnaire to the best of my
                    knowledge. I will seek help from the dental staff if questions are difficult to
                    read or understand. I agree to disclose all previous illnesses, medical and dental
                    history. I understand that providing incorrect information regarding medication,
                    allergies or illnesses can be dangerous to my health.
                  </p>
                  <p>
                    If I ever have changes in my health, I will inform the dentist/dental staff at the
                    next appointment. I authorize the dentist to release any information including the
                    diagnosis and records of any treatment or examination rendered to myself or my
                    child during the period of dental care to third party payers, HMOs or health
                    practitioners.
                  </p>
                </div>

                <label className={`agree-line ${invalidAuthorization ? 'input-error' : ''}`}>
                  <input
                    type="radio"
                    name="authorization"
                    checked={authorizationAccepted}
                    onClick={() => {
                      if (authorizationAccepted) setAuthorizationAccepted(false)
                    }}
                    onChange={() => {
                      setAuthorizationAccepted(true)
                      setInvalidAuthorization(false)
                    }}
                  />
                  <span>
                    I have read, understood, and <strong>agree</strong> to the terms stated above.
                  </span>
                </label>
              </div>
            </div>
          </section>
        ) : null}

        <div className="panel-footer add-patient-footer">
          {activeStep > 0 ? (
            <button type="button" className="ghost step-btn" onClick={prevStep}>
              Back
            </button>
          ) : null}
          {activeStep < STEPS.length - 1 ? (
            <button type="button" className="submit step-btn" onClick={nextStep}>
              Next
            </button>
          ) : (
            <button type="button" className="submit step-btn final-submit" onClick={handleFinalSubmit}>
              Submit
            </button>
          )}
        </div>
      </section>

      {isSubmitConfirmOpen ? (
        <>
          <div className="modal-backdrop" onClick={() => setIsSubmitConfirmOpen(false)} />
          <div className="pr-modal add-patient-feedback-modal" role="dialog" aria-modal="true" aria-labelledby="add-patient-confirm-title">
            <div className="pr-modal-head">
              <h2 id="add-patient-confirm-title">Confirm Submission</h2>
            </div>
            <div className="pr-modal-body add-patient-feedback-body">
              <p>Are you sure you want to submit this patient record?</p>
              <div className="modal-actions center">
                <button type="button" className="danger-btn" onClick={() => setIsSubmitConfirmOpen(false)}>Cancel</button>
                <button type="button" className="success-btn" onClick={() => { void confirmSubmission() }} disabled={isSubmitting}>
                  {isSubmitting ? 'Submitting...' : 'Submit'}
                </button>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {isClearConfirmOpen ? (
        <>
          <div className="modal-backdrop" onClick={() => setIsClearConfirmOpen(false)} />
          <div className="pr-modal add-patient-feedback-modal" role="dialog" aria-modal="true" aria-labelledby="add-patient-clear-title">
            <div className="pr-modal-head">
              <h2 id="add-patient-clear-title">Clear All Details</h2>
            </div>
            <div className="pr-modal-body add-patient-feedback-body">
              <p>Are you sure you want to clear all unsaved patient details?</p>
              <div className="modal-actions center">
                <button type="button" className="danger-btn" onClick={() => setIsClearConfirmOpen(false)}>Cancel</button>
                <button type="button" className="success-btn" onClick={resetAddPatientForm}>Clear All</button>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {isSubmitSuccessOpen ? (
        <>
          <div className="modal-backdrop" onClick={() => setIsSubmitSuccessOpen(false)} />
          <div className="pr-modal add-patient-feedback-modal" role="dialog" aria-modal="true" aria-labelledby="add-patient-success-title">
            <div className="pr-modal-head">
              <h2 id="add-patient-success-title">Success</h2>
            </div>
            <div className="pr-modal-body add-patient-feedback-body">
              <p>Patient record submitted successfully.</p>
              <div className="modal-actions center">
                <button type="button" className="success-btn" onClick={handleSuccessAcknowledge}>OK</button>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {validationMessage ? (
        <>
          <div className="modal-backdrop" onClick={() => setValidationMessage('')} />
          <div className="pr-modal add-patient-feedback-modal" role="dialog" aria-modal="true" aria-labelledby="add-patient-notice-title">
            <div className="pr-modal-head">
              <h2 id="add-patient-notice-title">Notice</h2>
            </div>
            <div className="pr-modal-body add-patient-feedback-body">
              <p>{validationMessage}</p>
              <div className="modal-actions center">
                <button type="button" className="success-btn" onClick={() => setValidationMessage('')}>OK</button>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </>
  )
}

export default AddPatient
