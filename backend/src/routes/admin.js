const express = require('express');
const { createSupabaseClient } = require('../supabase');

const router = express.Router();

const HEALTH_CONDITIONS = [
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
];

const ALLERGENS = [
  'Local Anesthetic (ex. Lidocaine)',
  'Penicillin/Antibiotics',
  'Sulfa Drugs',
  'Latex/Rubber',
  'Aspirin',
];

const PERIODONTAL_FIELDS = [
  ['dental_record_periodontal_gingivitis', 'Gingivitis'],
  ['dental_record_periodontal_moderate_periodontitis', 'Moderate Periodontitis'],
  ['dental_record_periodontal_early_periodontitis', 'Early Periodontitis'],
  ['dental_record_periodontal_advanced_periodontitis', 'Advanced Periodontitis'],
];

const OCCLUSION_FIELDS = [
  ['dental_record_occlusion_class_i_molar', 'Class I molar'],
  ['dental_record_occlusion_overbite', 'Overbite'],
  ['dental_record_occlusion_overjet', 'Overjet'],
  ['dental_record_occlusion_midline_deviation', 'Midline Deviation'],
];

const MAX_SERVICE_IMPORT_COLUMNS = 10;

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toTitleCase(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  return raw
    .toLowerCase()
    .replace(/\b[a-z]/g, (match) => match.toUpperCase());
}

function normalizeSex(value) {
  const raw = normalizeString(value).toLowerCase();
  if (raw === 'male' || raw === 'm') return 'Male';
  if (raw === 'female' || raw === 'f') return 'Female';
  if (raw === 'other') return 'Other';
  return '';
}

function normalizeCivilStatus(value) {
  const raw = normalizeString(value).toLowerCase();
  if (raw === 'single') return 'Single';
  if (raw === 'married') return 'Married';
  if (raw === 'widowed') return 'Widowed';
  if (raw === 'divorced') return 'Divorced';
  if (raw === 'separated') return 'Separated';
  return '';
}

function normalizeBoolean(value) {
  const raw = normalizeString(value).toLowerCase();
  if (!raw) return null;
  if (['true', 'yes', 'y', '1'].includes(raw)) return true;
  if (['false', 'no', 'n', '0'].includes(raw)) return false;
  return null;
}

function normalizeYesNo(value) {
  const raw = normalizeString(value).toUpperCase();
  if (raw === 'YES' || raw === 'NO') return raw;
  if (raw === 'TRUE') return 'YES';
  if (raw === 'FALSE') return 'NO';
  return '';
}

function resolveAnswerWithOptionalNote(answerValue, noteValue) {
  const normalizedAnswer = normalizeYesNo(answerValue);
  const normalizedNote = normalizeString(noteValue);

  if (normalizedAnswer) {
    return normalizedAnswer;
  }

  if (normalizedNote) {
    return 'YES';
  }

  return '';
}

function resolveCompactAnswerAndNote(value) {
  const raw = normalizeString(value);
  if (!raw) {
    return { answer: '', note: '' };
  }

  const normalizedAnswer = normalizeYesNo(raw);
  if (normalizedAnswer) {
    return { answer: normalizedAnswer, note: '' };
  }

  return {
    answer: 'YES',
    note: raw,
  };
}

function resolveHistoryField(row, compactKey, answerKey, noteKey) {
  const explicitNote = normalizeString(row[noteKey]);
  const explicitAnswer = normalizeYesNo(row[answerKey]);

  if (explicitAnswer || explicitNote) {
    return {
      answer: resolveAnswerWithOptionalNote(explicitAnswer, explicitNote),
      note: explicitNote,
    };
  }

  return resolveCompactAnswerAndNote(row[compactKey]);
}

function normalizePhone(value) {
  const digits = `${value ?? ''}`.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('63') && digits.length === 12) return `+${digits}`;
  if (digits.startsWith('09') && digits.length === 11) return `+63${digits.slice(1)}`;
  if (digits.startsWith('9') && digits.length === 10) return `+63${digits}`;
  return normalizeString(value) || null;
}

function parseDateValue(value) {
  const raw = normalizeString(value);
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, month, day, year] = slashMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function parseTimestampValue(value) {
  const raw = normalizeString(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function parseIntegerValue(value, fallback = 1) {
  const raw = normalizeString(value);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function parseNumericValue(value, fallback = null) {
  const raw = normalizeString(value);
  if (!raw) return fallback;
  const normalized = raw.replace(/,/g, '');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function createBooleanMap(items, value = false) {
  return Object.fromEntries(items.map((item) => [item, value]));
}

function createAnswerMap(size) {
  return Object.fromEntries(Array.from({ length: size }, (_, index) => [`${index}`, '']));
}

function parseCsv(content) {
  const rows = [];
  const normalized = `${content ?? ''}`.replace(/^\uFEFF/, '');
  let currentValue = '';
  let currentRow = [];
  let inQuotes = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        currentValue += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ',') {
      currentRow.push(currentValue);
      currentValue = '';
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') index += 1;
      currentRow.push(currentValue);
      currentValue = '';
      if (currentRow.some((cell) => normalizeString(cell))) {
        rows.push(currentRow);
      }
      currentRow = [];
      continue;
    }

    currentValue += char;
  }

  currentRow.push(currentValue);
  if (currentRow.some((cell) => normalizeString(cell))) {
    rows.push(currentRow);
  }

  if (rows.length === 0) return [];

  const [headers, ...dataRows] = rows;
  return dataRows.map((row) => {
    const record = {};
    headers.forEach((header, index) => {
      record[normalizeString(header)] = row[index] ?? '';
    });
    return record;
  });
}

async function requireAdminRequester(accessToken) {
  const requesterClient = createSupabaseClient({ accessToken });
  const { data: requesterUserData, error: requesterUserError } = await requesterClient.auth.getUser();
  if (requesterUserError || !requesterUserData?.user?.id) {
    return {
      errorResponse: {
        status: 401,
        payload: requesterUserError || { error: 'Unable to resolve authenticated user.' },
      },
    };
  }

  const serviceClient = createSupabaseClient({ useServiceRole: true });
  const { data: requesterProfile, error: requesterProfileError } = await serviceClient
    .from('staff_profiles')
    .select('user_id, role, is_active')
    .eq('user_id', requesterUserData.user.id)
    .maybeSingle();

  if (requesterProfileError) {
    return {
      errorResponse: {
        status: 403,
        payload: requesterProfileError,
      },
    };
  }

  if (!requesterProfile || !requesterProfile.is_active || requesterProfile.role !== 'admin') {
    return {
      errorResponse: {
        status: 403,
        payload: { error: 'Forbidden: admin role required.' },
      },
    };
  }

  return {
    serviceClient,
    requesterUserId: requesterUserData.user.id,
  };
}

function buildAllergenInfo(rawAllergies) {
  const tokens = normalizeString(rawAllergies)
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);

  const values = createBooleanMap(ALLERGENS, false);
  const others = [];

  tokens.forEach((token) => {
    const normalizedToken = token.toLowerCase();
    if (normalizedToken.includes('local')) {
      values['Local Anesthetic (ex. Lidocaine)'] = true;
      return;
    }
    if (normalizedToken.includes('penicillin') || normalizedToken.includes('antibiotic')) {
      values['Penicillin/Antibiotics'] = true;
      return;
    }
    if (normalizedToken.includes('sulfa')) {
      values['Sulfa Drugs'] = true;
      return;
    }
    if (normalizedToken.includes('latex') || normalizedToken.includes('rubber')) {
      values['Latex/Rubber'] = true;
      return;
    }
    if (normalizedToken.includes('aspirin')) {
      values.Aspirin = true;
      return;
    }
    if (!['none', 'n/a', 'na'].includes(normalizedToken)) {
      others.push(token);
    }
  });

  return {
    values,
    others: others.join('; '),
  };
}

function buildMedicalHistory(row) {
  const fieldKeys = [
    'good_health',
    'under_treatment',
    'serious_illness_or_surgery',
    'hospitalized',
    'medications',
    'tobacco',
    'alcohol_or_drugs',
    'pregnant',
    'breastfeeding',
    'birth_control_pills',
  ];
  const answers = createAnswerMap(10);
  const notes = {};
  const noteEnabledIndexes = new Set([1, 3, 4]);

  for (let index = 1; index <= 10; index += 1) {
    const fieldKey = fieldKeys[index - 1];
    const compactKey = `medical_q${index}_${fieldKey}`;
    const answerKey = `medical_q${index}_${fieldKey}_answer`;
    const noteKey = `medical_q${index}_${fieldKey}_note`;
    const resolved = noteEnabledIndexes.has(index - 1)
      ? resolveHistoryField(row, compactKey, answerKey, noteKey)
      : {
        answer: normalizeYesNo(row[answerKey] || row[compactKey]),
        note: normalizeString(row[noteKey]),
      };

    answers[`${index - 1}`] = resolved.answer;

    if (resolved.note) {
      notes[`${index - 1}`] = resolved.note;
    }
  }

  return {
    physician: toTitleCase(row.medical_physician),
    specialty: toTitleCase(row.medical_specialty),
    address: toTitleCase(row.medical_address),
    answers,
    notes,
  };
}

function buildDentalHistory(row) {
  const fieldNames = [
    'tooth_pain',
    'under_treatment',
    'hot_cold_sensitivity',
    'sweet_sour_sensitivity',
    'gum_bleeding',
    'sores_or_lumps',
    'orthodontic_work',
    'local_anesthesia_exposure',
    'anesthesia_reaction',
    'post_extraction_problems',
    'serious_dental_treatment_problems',
    'head_neck_jaw_injury',
    'oral_habits',
    'difficulty_opening_closing_mouth',
    'satisfied_with_teeth_appearance',
    'bleaching_history',
    'nervous_about_treatment',
    'regular_recall',
  ];

  const answers = createAnswerMap(18);
  const notes = {};

  fieldNames.forEach((name, index) => {
    const compactKey = `dental_q${index + 1}_${name}`;
    const answerKey = `dental_q${index + 1}_${name}_answer`;
    const noteKey = `dental_q${index + 1}_${name}_note`;
    const resolved = index === 1
      ? resolveHistoryField(row, compactKey, answerKey, noteKey)
      : {
        answer: normalizeYesNo(row[answerKey] || row[compactKey]),
        note: normalizeString(row[noteKey]),
      };

    answers[`${index}`] = resolved.answer;
    if (resolved.note) {
      notes[`${index}`] = resolved.note;
    }
  });

  return {
    previous: toTitleCase(row.dental_previous_dentist),
    lastExam: parseDateValue(row.dental_last_exam) || '',
    reason: toTitleCase(row.dental_consultation_reason),
    answers,
    notes,
  };
}

function buildPatientPayload(row, requesterUserId) {
  return {
    first_name: toTitleCase(row.first_name),
    last_name: toTitleCase(row.last_name),
    middle_name: toTitleCase(row.middle_name) || null,
    suffix: toTitleCase(row.suffix) || null,
    sex: normalizeSex(row.sex),
    birth_date: parseDateValue(row.birth_date),
    phone: normalizePhone(row.phone),
    email: normalizeString(row.email).toLowerCase() || null,
    address: toTitleCase(row.address) || null,
    nickname: toTitleCase(row.nickname) || null,
    civil_status: normalizeCivilStatus(row.civil_status) || null,
    occupation: toTitleCase(row.occupation) || null,
    office_address: toTitleCase(row.office_address) || null,
    guardian_name: toTitleCase(row.guardian_name) || null,
    guardian_mobile_number: normalizePhone(row.guardian_mobile_number),
    guardian_occupation: toTitleCase(row.guardian_occupation) || null,
    guardian_office_address: toTitleCase(row.guardian_office_address) || null,
    emergency_contact_name: toTitleCase(row.emergency_contact_name) || null,
    emergency_contact_phone: normalizePhone(row.emergency_contact_phone),
    health_conditions: {
      ...createBooleanMap(HEALTH_CONDITIONS, false),
      othersText: '',
    },
    allergen_info: buildAllergenInfo(row.allergies),
    medical_history: buildMedicalHistory(row),
    dental_history: buildDentalHistory(row),
    authorization_accepted: normalizeBoolean(row.authorization_accepted) ?? false,
    is_active: normalizeBoolean(row.is_active) ?? true,
    updated_by: requesterUserId,
  };
}

function hasDentalRecordData(row) {
  return [
    'dental_record_recorded_at',
    'dental_record_tooth_number',
    'dental_record_findings',
    'dental_record_treatment',
    'dental_record_dentist',
    'dental_record_prescriptions',
    'dental_record_notes',
    'dental_record_top_tooth_chart',
    'dental_record_bottom_tooth_chart',
    'dental_record_tooth_map_json',
  ].some((field) => normalizeString(row[field]));
}

function hasServiceRecordData(row) {
  return [
    'service_record_service_name',
    'service_record_service_id',
    'service_record_visit_at',
    'service_record_quantity',
    'service_record_unit_price',
    'service_record_discount_amount',
    'service_record_amount',
    'service_record_notes',
    ...Array.from({ length: MAX_SERVICE_IMPORT_COLUMNS }, (_, index) => {
      const serviceIndex = index + 1;
      return [
        `service_${serviceIndex}_name`,
        `service_${serviceIndex}_id`,
        `service_${serviceIndex}_visit_at`,
        `service_${serviceIndex}_quantity`,
        `service_${serviceIndex}_unit_price`,
        `service_${serviceIndex}_discount_amount`,
        `service_${serviceIndex}_amount`,
        `service_${serviceIndex}_notes`,
      ];
    }).flat(),
  ].some((field) => normalizeString(row[field]));
}

function buildChartBooleanGroup(row, fieldMap) {
  return Object.fromEntries(fieldMap.map(([fieldName, label]) => [label, normalizeBoolean(row[fieldName]) ?? false]));
}

function parseJsonObject(rawValue, fallback = {}) {
  const raw = normalizeString(rawValue);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    return fallback;
  }
  return fallback;
}

function parseToothChartEntries(rawValue, rowPrefix) {
  const raw = normalizeString(rawValue);
  if (!raw) return {};

  return raw
    .split(/[;\n|]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((accumulator, entry) => {
      const [rawToothNumber, rawCode] = entry.split(':').map((item) => item?.trim?.() || '');
      const toothNumber = Number.parseInt(rawToothNumber, 10);
      const code = normalizeString(rawCode);

      if (!Number.isInteger(toothNumber) || toothNumber < 1 || toothNumber > 32 || !code) {
        return accumulator;
      }

      accumulator[`${rowPrefix}-${toothNumber}`] = code;
      return accumulator;
    }, {});
}

function collectToothChartValidationIssues(rawValue, fieldName, validLegendCodes) {
  const raw = normalizeString(rawValue);
  if (!raw) return [];

  return raw
    .split(/[;\n|]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const [rawToothNumber, rawCode] = entry.split(':').map((item) => item?.trim?.() || '');
      const toothNumber = Number.parseInt(rawToothNumber, 10);
      const code = normalizeString(rawCode).toUpperCase();

      if (!Number.isInteger(toothNumber) || toothNumber < 1 || toothNumber > 32 || !code) {
        return [`${fieldName} has an invalid tooth chart entry "${entry}". Use toothNumber:LegendCode.`];
      }

      if (!validLegendCodes.has(code)) {
        return [`${fieldName} uses unknown legend code "${code}" on tooth ${toothNumber}.`];
      }

      return [];
    });
}

function collectToothMapJsonValidationIssues(rawValue, validLegendCodes) {
  const raw = normalizeString(rawValue);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return ['dental_record_tooth_map_json must be a JSON object.'];
    }

    return Object.entries(parsed).flatMap(([toothKey, rawCode]) => {
      const code = normalizeString(rawCode).toUpperCase();
      if (!code) {
        return [`dental_record_tooth_map_json has an empty legend code for "${toothKey}".`];
      }

      if (!validLegendCodes.has(code)) {
        return [`dental_record_tooth_map_json uses unknown legend code "${code}" on "${toothKey}".`];
      }

      return [];
    });
  } catch {
    return ['dental_record_tooth_map_json is not valid JSON.'];
  }
}

function validateDentalRecordLegendCodes(row, validLegendCodes) {
  const hasExplicitCharts = Boolean(
    normalizeString(row.dental_record_top_tooth_chart) || normalizeString(row.dental_record_bottom_tooth_chart),
  );

  if (hasExplicitCharts) {
    return [
      ...collectToothChartValidationIssues(row.dental_record_top_tooth_chart, 'dental_record_top_tooth_chart', validLegendCodes),
      ...collectToothChartValidationIssues(row.dental_record_bottom_tooth_chart, 'dental_record_bottom_tooth_chart', validLegendCodes),
    ];
  }

  return collectToothMapJsonValidationIssues(row.dental_record_tooth_map_json, validLegendCodes);
}

function roundCurrency(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function buildToothMap(row) {
  const topChart = parseToothChartEntries(row.dental_record_top_tooth_chart, 'top');
  const bottomChart = parseToothChartEntries(row.dental_record_bottom_tooth_chart, 'bottom');
  const explicitChart = { ...topChart, ...bottomChart };

  if (Object.keys(explicitChart).length > 0) {
    return explicitChart;
  }

  return parseJsonObject(row.dental_record_tooth_map_json, {});
}

function buildDentalRecordPayload(row, patientId, requesterUserId) {
  const notes = normalizeString(row.dental_record_notes);
  const dentist = normalizeString(row.dental_record_dentist);

  return {
    patient_id: patientId,
    tooth_number: normalizeString(row.dental_record_tooth_number) || 'ALL',
    findings: normalizeString(row.dental_record_findings) || null,
    treatment: normalizeString(row.dental_record_treatment) || null,
    recorded_at: parseTimestampValue(row.dental_record_recorded_at) || new Date().toISOString(),
    chart_data: {
      toothMap: buildToothMap(row),
      periodontal: buildChartBooleanGroup(row, PERIODONTAL_FIELDS),
      occlusion: buildChartBooleanGroup(row, OCCLUSION_FIELDS),
      prescriptions: normalizeString(row.dental_record_prescriptions),
      notes,
      dentist: dentist || '',
    },
    created_by: requesterUserId,
    updated_by: requesterUserId,
  };
}

function buildServiceRecordPayload(row, patientId, serviceId, requesterUserId) {
  const quantity = Math.max(1, parseIntegerValue(row.service_record_quantity, 1));
  const unitPrice = parseNumericValue(row.service_record_unit_price, null);
  const discountAmount = Math.max(0, parseNumericValue(row.service_record_discount_amount, 0) ?? 0);
  const providedAmount = parseNumericValue(row.service_record_amount, null);
  const computedAmount = unitPrice == null
    ? providedAmount
    : Math.max((unitPrice * quantity) - discountAmount, 0);

  return {
    patient_id: patientId,
    service_id: serviceId,
    quantity,
    unit_price: unitPrice,
    discount_amount: discountAmount,
    performed_by: requesterUserId,
    notes: normalizeString(row.service_record_notes) || null,
    amount: providedAmount ?? computedAmount,
    visit_at: parseTimestampValue(row.service_record_visit_at) || new Date().toISOString(),
    created_by: requesterUserId,
    updated_by: requesterUserId,
  };
}

function buildIndexedServiceRecordPayload(serviceEntry, patientId, serviceId, requesterUserId) {
  const quantity = Math.max(1, parseIntegerValue(serviceEntry.quantity, 1));
  const unitPrice = parseNumericValue(serviceEntry.unitPrice, null);
  const discountAmount = Math.max(0, parseNumericValue(serviceEntry.discountAmount, 0) ?? 0);
  const providedAmount = parseNumericValue(serviceEntry.amount, null);
  const computedAmount = unitPrice == null
    ? providedAmount
    : Math.max((unitPrice * quantity) - discountAmount, 0);

  return {
    patient_id: patientId,
    service_id: serviceId,
    quantity,
    unit_price: unitPrice,
    discount_amount: discountAmount,
    performed_by: requesterUserId,
    notes: normalizeString(serviceEntry.notes) || null,
    amount: providedAmount ?? computedAmount,
    visit_at: parseTimestampValue(serviceEntry.visitAt) || new Date().toISOString(),
    created_by: requesterUserId,
    updated_by: requesterUserId,
  };
}

function extractPatientImportIdentifier(row) {
  return normalizeString(row.patient_id || row.patient_code || row.patient_identifier);
}

function extractPatientLastName(row) {
  return toTitleCase(row.patient_last_name || row.last_name || row.dental_record_last_name);
}

function extractPatientFirstName(row) {
  return toTitleCase(row.patient_first_name || row.first_name || row.dental_record_first_name);
}

function extractServiceLookupValue(row) {
  return normalizeString(row.service_record_service_name || row.service_name || row.service_record_service_id);
}

async function loadImportValidationLookups(serviceClient) {
  const [{ data: legendRows, error: legendError }, { data: serviceRows, error: serviceError }] = await Promise.all([
    serviceClient
      .from('tooth_conditions')
      .select('code, is_active'),
    serviceClient
      .from('services')
      .select('id, service_name, price, is_active'),
  ]);

  if (legendError) throw legendError;
  if (serviceError) throw serviceError;

  const activeLegendCodes = new Set(
    (legendRows ?? [])
      .filter((row) => row?.is_active !== false)
      .map((row) => normalizeString(row.code).toUpperCase())
      .filter(Boolean),
  );

  const serviceById = new Map();
  const serviceByName = new Map();

  (serviceRows ?? [])
    .filter((row) => row?.is_active !== false)
    .forEach((row) => {
      const normalizedName = normalizeString(row.service_name).toLowerCase();
      if (row?.id) serviceById.set(row.id, row);
      if (normalizedName) serviceByName.set(normalizedName, row);
    });

  return {
    activeLegendCodes,
    serviceById,
    serviceByName,
  };
}

function extractServiceEntries(row) {
  const indexedEntries = Array.from({ length: MAX_SERVICE_IMPORT_COLUMNS }, (_, index) => {
    const serviceIndex = index + 1;
    const name = normalizeString(row[`service_${serviceIndex}_name`]);
    const id = normalizeString(row[`service_${serviceIndex}_id`]);
    const visitAt = normalizeString(row[`service_${serviceIndex}_visit_at`]);
    const quantity = normalizeString(row[`service_${serviceIndex}_quantity`]);
    const unitPrice = normalizeString(row[`service_${serviceIndex}_unit_price`]);
    const discountAmount = normalizeString(row[`service_${serviceIndex}_discount_amount`]);
    const amount = normalizeString(row[`service_${serviceIndex}_amount`]);
    const notes = normalizeString(row[`service_${serviceIndex}_notes`]);

    if (![name, id, visitAt, quantity, unitPrice, discountAmount, amount, notes].some(Boolean)) {
      return null;
    }

    return {
      slot: serviceIndex,
      lookupValue: normalizeString(name || id),
      visitAt,
      quantity,
      unitPrice,
      discountAmount,
      amount,
      notes,
    };
  }).filter(Boolean);

  if (indexedEntries.length > 0) {
    return indexedEntries;
  }

  const fallbackLookupValue = extractServiceLookupValue(row);
  if (!fallbackLookupValue
    && ![
      row.service_record_visit_at,
      row.service_record_quantity,
      row.service_record_unit_price,
      row.service_record_discount_amount,
      row.service_record_amount,
      row.service_record_notes,
    ].some((value) => normalizeString(value))) {
    return [];
  }

  return [{
    slot: 1,
    lookupValue: fallbackLookupValue,
    visitAt: row.service_record_visit_at,
    quantity: row.service_record_quantity,
    unitPrice: row.service_record_unit_price,
    discountAmount: row.service_record_discount_amount,
    amount: row.service_record_amount,
    notes: row.service_record_notes,
  }];
}

async function resolvePatientForRecordImport(serviceClient, patientCache, patientIdentifier) {
  const cacheKey = patientIdentifier.toLowerCase();
  if (patientCache.has(cacheKey)) {
    return patientCache.get(cacheKey);
  }

  let query = serviceClient
    .from('patients')
    .select('id, patient_code, first_name, last_name')
    .limit(1);

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(patientIdentifier)) {
    query = query.eq('id', patientIdentifier);
  } else {
    query = query.eq('patient_code', patientIdentifier.toUpperCase());
  }

  const { data, error } = await query;
  if (error) throw error;

  const patient = data?.[0] || null;
  if (!patient) {
    throw new Error(`Patient ID "${patientIdentifier}" was not found.`);
  }

  patientCache.set(cacheKey, patient);
  return patient;
}

async function resolveServiceForImport(serviceClient, serviceCache, serviceLookupValue, validationLookups = null) {
  const cacheKey = serviceLookupValue.toLowerCase();
  if (serviceCache.has(cacheKey)) {
    return serviceCache.get(cacheKey);
  }

  if (validationLookups) {
    const catalogMatch = validationLookups.serviceById.get(serviceLookupValue)
      || validationLookups.serviceByName.get(serviceLookupValue.toLowerCase());
    if (!catalogMatch) {
      throw new Error(`Service "${serviceLookupValue}" was not found.`);
    }

    serviceCache.set(cacheKey, catalogMatch);
    return catalogMatch;
  }

  let query = serviceClient
    .from('services')
    .select('id, service_name, price, is_active')
    .limit(1);

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(serviceLookupValue)) {
    query = query.eq('id', serviceLookupValue);
  } else {
    query = query.ilike('service_name', serviceLookupValue);
  }

  const { data, error } = await query;
  if (error) throw error;

  const service = data?.[0] || null;
  if (!service || service.is_active === false) {
    throw new Error(`Service "${serviceLookupValue}" was not found.`);
  }

  serviceCache.set(cacheKey, service);
  return service;
}

async function resolvePatient(serviceClient, patientCache, patientPayload, requesterUserId) {
  const cacheKey = [
    patientPayload.last_name.toLowerCase(),
    patientPayload.first_name.toLowerCase(),
    patientPayload.birth_date || '',
    patientPayload.sex,
  ].join('|');

  if (patientCache.has(cacheKey)) {
    return {
      ...patientCache.get(cacheKey),
      mode: 'cached',
    };
  }

  let patientQuery = serviceClient
    .from('patients')
    .select('id, patient_code')
    .ilike('last_name', patientPayload.last_name)
    .ilike('first_name', patientPayload.first_name)
    .eq('sex', patientPayload.sex)
    .limit(1);

  patientQuery = patientPayload.birth_date
    ? patientQuery.eq('birth_date', patientPayload.birth_date)
    : patientQuery.is('birth_date', null);

  const { data: existingPatients, error: fetchError } = await patientQuery;

  if (fetchError) throw fetchError;

  if (existingPatients?.[0]?.id) {
    const existingPatient = existingPatients[0];
    const { error: updateError } = await serviceClient
      .from('patients')
      .update({
        ...patientPayload,
        updated_by: requesterUserId,
      })
      .eq('id', existingPatient.id);

    if (updateError) throw updateError;

    const resolved = { id: existingPatient.id, patient_code: existingPatient.patient_code, mode: 'updated' };
    patientCache.set(cacheKey, resolved);
    return resolved;
  }

  const { data: insertedPatient, error: insertError } = await serviceClient
    .from('patients')
    .insert({
      ...patientPayload,
      created_by: requesterUserId,
      updated_by: requesterUserId,
    })
    .select('id, patient_code')
    .single();

  if (insertError) throw insertError;

  const resolved = { id: insertedPatient.id, patient_code: insertedPatient.patient_code, mode: 'created' };
  patientCache.set(cacheKey, resolved);
  return resolved;
}

async function upsertDentalRecord(serviceClient, dentalPayload, requesterUserId) {
  const { data: existingRows, error: fetchError } = await serviceClient
    .from('dental_records')
    .select('id')
    .eq('patient_id', dentalPayload.patient_id)
    .eq('tooth_number', dentalPayload.tooth_number)
    .eq('recorded_at', dentalPayload.recorded_at)
    .limit(1);

  if (fetchError) throw fetchError;

  if (existingRows?.[0]?.id) {
    const { error: updateError } = await serviceClient
      .from('dental_records')
      .update({
        findings: dentalPayload.findings,
        treatment: dentalPayload.treatment,
        chart_data: dentalPayload.chart_data,
        updated_by: requesterUserId,
      })
      .eq('id', existingRows[0].id);

    if (updateError) throw updateError;
    return 'updated';
  }

  const { error: insertError } = await serviceClient
    .from('dental_records')
    .insert(dentalPayload);

  if (insertError) throw insertError;
  return 'created';
}

async function upsertServiceRecord(serviceClient, servicePayload, requesterUserId) {
  const { data: existingRows, error: fetchError } = await serviceClient
    .from('service_records')
    .select('id')
    .eq('patient_id', servicePayload.patient_id)
    .eq('service_id', servicePayload.service_id)
    .eq('visit_at', servicePayload.visit_at)
    .limit(1);

  if (fetchError) throw fetchError;

  if (existingRows?.[0]?.id) {
    const { error: updateError } = await serviceClient
      .from('service_records')
      .update({
        quantity: servicePayload.quantity,
        unit_price: servicePayload.unit_price,
        discount_amount: servicePayload.discount_amount,
        notes: servicePayload.notes,
        amount: servicePayload.amount,
        updated_by: requesterUserId,
      })
      .eq('id', existingRows[0].id);

    if (updateError) throw updateError;
    return 'updated';
  }

  const { error: insertError } = await serviceClient
    .from('service_records')
    .insert(servicePayload);

  if (insertError) throw insertError;
  return 'created';
}

router.post('/import-patient-migration', async (req, res) => {
  const accessToken = `${req.headers.authorization || ''}`.replace(/^Bearer\s+/i, '').trim();
  const adminContext = await requireAdminRequester(accessToken);

  if (adminContext.errorResponse) {
    return res.status(adminContext.errorResponse.status).json(adminContext.errorResponse.payload);
  }

  const { serviceClient, requesterUserId } = adminContext;
  const csvContent = typeof req.body?.csvContent === 'string' ? req.body.csvContent : '';
  const fileName = normalizeString(req.body?.fileName) || 'patients-record-migrate-template.csv';

  if (!csvContent.trim()) {
    return res.status(400).json({ error: 'CSV content is required.' });
  }

  const rows = parseCsv(csvContent);
  if (rows.length === 0) {
    return res.status(400).json({ error: 'CSV file has no data rows.' });
  }

  const patientCache = new Map();
  const summary = {
    fileName,
    totalRows: rows.length,
    patientsCreated: 0,
    patientsUpdated: 0,
    skippedRows: 0,
    errors: [],
  };

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const rowNumber = index + 2;

    try {
      const patientPayload = buildPatientPayload(row, requesterUserId);
      if (!patientPayload.first_name || !patientPayload.last_name || !patientPayload.sex || !patientPayload.birth_date) {
        summary.skippedRows += 1;
        summary.errors.push(`Row ${rowNumber}: first_name, last_name, sex, and birth_date are required.`);
        continue;
      }

      const resolvedPatient = await resolvePatient(serviceClient, patientCache, patientPayload, requesterUserId);
      if (resolvedPatient.mode === 'created') {
        summary.patientsCreated += 1;
      } else if (resolvedPatient.mode === 'updated') {
        summary.patientsUpdated += 1;
      }
    } catch (error) {
      summary.skippedRows += 1;
      summary.errors.push(`Row ${rowNumber}: ${error.message || 'Import failed.'}`);
    }
  }

  return res.json({
    ok: true,
    message: 'Patient migration import completed.',
    summary,
  });
});

router.post('/import-patient-records', async (req, res) => {
  const accessToken = `${req.headers.authorization || ''}`.replace(/^Bearer\s+/i, '').trim();
  const adminContext = await requireAdminRequester(accessToken);

  if (adminContext.errorResponse) {
    return res.status(adminContext.errorResponse.status).json(adminContext.errorResponse.payload);
  }

  const { serviceClient, requesterUserId } = adminContext;
  const csvContent = typeof req.body?.csvContent === 'string' ? req.body.csvContent : '';
  const fileName = normalizeString(req.body?.fileName) || 'patient-records-migrate-template.csv';

  if (!csvContent.trim()) {
    return res.status(400).json({ error: 'CSV content is required.' });
  }

  const rows = parseCsv(csvContent);
  if (rows.length === 0) {
    return res.status(400).json({ error: 'CSV file has no data rows.' });
  }

  const patientCache = new Map();
  const serviceCache = new Map();
  const validationLookups = await loadImportValidationLookups(serviceClient);
  const summary = {
    fileName,
    totalRows: rows.length,
    dentalRecordsCreated: 0,
    dentalRecordsUpdated: 0,
    serviceRecordsCreated: 0,
    serviceRecordsUpdated: 0,
    skippedRows: 0,
    errors: [],
  };

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const rowNumber = index + 2;

    try {
      const patientIdentifier = extractPatientImportIdentifier(row);
      if (!patientIdentifier) {
        summary.skippedRows += 1;
        summary.errors.push(`Row ${rowNumber}: patient_id or patient_code is required.`);
        continue;
      }

      const hasDentalData = hasDentalRecordData(row);
      const hasServiceData = hasServiceRecordData(row);

      if (!hasDentalData && !hasServiceData) {
        summary.skippedRows += 1;
        summary.errors.push(`Row ${rowNumber}: no dental or service record data was found.`);
        continue;
      }

      const resolvedPatient = await resolvePatientForRecordImport(serviceClient, patientCache, patientIdentifier);

      const expectedLastName = extractPatientLastName(row);
      const expectedFirstName = extractPatientFirstName(row);

      if (!expectedLastName || !expectedFirstName) {
        throw new Error('Record rows require patient_last_name and patient_first_name together with patient_id.');
      }

      if (
        resolvedPatient.last_name.toLowerCase() !== expectedLastName.toLowerCase()
        || resolvedPatient.first_name.toLowerCase() !== expectedFirstName.toLowerCase()
      ) {
        throw new Error(
          `Patient validation failed for patient ID "${patientIdentifier}": first name or last name does not match.`,
        );
      }

      let dentalPayload = null;
      if (hasDentalData) {
        const dentalLegendIssues = validateDentalRecordLegendCodes(row, validationLookups.activeLegendCodes);
        if (dentalLegendIssues.length > 0) {
          throw new Error(dentalLegendIssues.join(' '));
        }

        dentalPayload = buildDentalRecordPayload(row, resolvedPatient.id, requesterUserId);
      }

      const servicePayloads = [];

      if (hasServiceData) {
        const serviceEntries = extractServiceEntries(row);
        if (serviceEntries.length === 0) {
          throw new Error('Service record rows require service data in service_record_* or service_1_* to service_10_* columns.');
        }

        for (const serviceEntry of serviceEntries) {
          if (!serviceEntry.lookupValue) {
            throw new Error(`Service slot ${serviceEntry.slot} requires service_${serviceEntry.slot}_name or service_${serviceEntry.slot}_id.`);
          }

          const resolvedService = await resolveServiceForImport(
            serviceClient,
            serviceCache,
            serviceEntry.lookupValue,
            validationLookups,
          );
          const providedUnitPrice = parseNumericValue(serviceEntry.unitPrice, null);
          const expectedUnitPrice = roundCurrency(Number(resolvedService.price ?? 0));

          if (providedUnitPrice === null) {
            throw new Error(`Service slot ${serviceEntry.slot} is missing unit_price.`);
          }

          if (roundCurrency(providedUnitPrice) !== expectedUnitPrice) {
            throw new Error(
              `Service slot ${serviceEntry.slot} price mismatch for "${resolvedService.service_name}": CSV has ${providedUnitPrice}, system price is ${expectedUnitPrice}.`,
            );
          }

          const normalizedServiceEntry = {
            ...serviceEntry,
            unitPrice: `${expectedUnitPrice}`,
          };

          const servicePayload = serviceEntry.slot === 1
            && !normalizeString(row.service_1_name)
            && !normalizeString(row.service_1_id)
            ? buildServiceRecordPayload(
              {
                ...row,
                service_record_unit_price: `${expectedUnitPrice}`,
              },
              resolvedPatient.id,
              resolvedService.id,
              requesterUserId,
            )
            : buildIndexedServiceRecordPayload(normalizedServiceEntry, resolvedPatient.id, resolvedService.id, requesterUserId);
          servicePayloads.push(servicePayload);
        }
      }

      if (dentalPayload) {
        const dentalMode = await upsertDentalRecord(serviceClient, dentalPayload, requesterUserId);
        if (dentalMode === 'created') {
          summary.dentalRecordsCreated += 1;
        } else {
          summary.dentalRecordsUpdated += 1;
        }
      }

      for (const servicePayload of servicePayloads) {
        const serviceMode = await upsertServiceRecord(serviceClient, servicePayload, requesterUserId);
        if (serviceMode === 'created') {
          summary.serviceRecordsCreated += 1;
        } else {
          summary.serviceRecordsUpdated += 1;
        }
      }
    } catch (error) {
      summary.skippedRows += 1;
      summary.errors.push(`Row ${rowNumber}: ${error.message || 'Import failed.'}`);
    }
  }

  return res.json({
    ok: true,
    message: 'Patient records import completed.',
    summary,
  });
});

module.exports = router;
