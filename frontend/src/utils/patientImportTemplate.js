const HEADER_FILL = '1F87A8'
const HEADER_TEXT = 'FFFFFFFF'
const SHEET_BACKGROUND = 'F8FAFC'
const LEGEND_TITLE_FILL = 'DBEAFE'
const LEGEND_BORDER = 'CBD5E1'
const SECONDARY_TEXT = '475569'
const WORKBOOK_PASSWORD = 'patient-template-view'
const BODY_BORDER = 'D7DEE8'
const HEADER_BORDER = 'E6F4F8'

const MEDICAL_QUESTIONS = [
  'Are you in a good health?',
  'Are you under medical treatment now?',
  'Have you ever had serious illness or surgical operation?',
  'Have you ever been hospitalized?',
  'Are you taking any prescription/non-prescription medication?',
  'Do you use tobacco products?',
  'Do you use alcohol, cocaine or other dangerous drugs?',
  'Are you pregnant?',
  'Are you breastfeeding?',
  'Are you taking birth control pills?',
]

const DENTAL_QUESTIONS = [
  'Do you feel pain in any of your teeth?',
  'Are you under medical treatment now?',
  'Are your teeth sensitive to hot/cold liquids/food?',
  'Are your teeth sensitive to sweet/sour liquids/food?',
  'Do your gums bleed while brushing/flossing?',
  'Do you have sores/lumps in/near your mouth?',
  'Have you had orthodontic work in the past? (Braces, retainers, etc.)',
  'Do you have any exposure to local anesthesia?',
  'Have you had unfavorable reaction from anesthesia (eg. Lidocaine)?',
  'Have you had problems after tooth extraction?',
  'Have you had serious problems associated with dental treatment?',
  'Have you had any head, neck or jaw injury?',
  'Do you have any oral habit? (thumb sucking, mouth breathing, tongue thrusting, teeth clenching or grinding)',
  'Do you have difficulty opening/closing your mouth?',
  'Are you satisfied with the appearance of your teeth?',
  'Have you had tooth bleaching/whitening done in the past?',
  'Does dental treatment make you nervous?',
  'Would you like to have regular recall appointments every 6 months?',
]

export const PATIENT_TEMPLATE_COLUMNS = [
  { key: 'first_name', width: 18 },
  { key: 'last_name', width: 18 },
  { key: 'middle_name', width: 18 },
  { key: 'suffix', width: 12 },
  { key: 'sex', width: 12 },
  { key: 'birth_date', width: 14 },
  { key: 'phone', width: 18, textFormat: true },
  { key: 'email', width: 34 },
  { key: 'address', width: 40 },
  { key: 'nickname', width: 16 },
  { key: 'civil_status', width: 16 },
  { key: 'occupation', width: 20 },
  { key: 'office_address', width: 34 },
  { key: 'guardian_name', width: 24 },
  { key: 'guardian_mobile_number', width: 22, textFormat: true },
  { key: 'guardian_occupation', width: 22 },
  { key: 'guardian_office_address', width: 34 },
  { key: 'emergency_contact_name', width: 24 },
  { key: 'emergency_contact_phone', width: 22, textFormat: true },
  { key: 'authorization_accepted', width: 20 },
  { key: 'is_active', width: 14 },
  { key: 'allergies', width: 28 },
  { key: 'medical_physician', width: 24 },
  { key: 'medical_specialty', width: 22 },
  { key: 'medical_address', width: 34 },
  { key: 'medical_q1', width: 14 },
  { key: 'medical_q2', width: 14 },
  { key: 'medical_q2_note', width: 30 },
  { key: 'medical_q3', width: 14 },
  { key: 'medical_q4', width: 14 },
  { key: 'medical_q4_note', width: 30 },
  { key: 'medical_q5', width: 14 },
  { key: 'medical_q5_note', width: 30 },
  { key: 'medical_q6', width: 14 },
  { key: 'medical_q7', width: 14 },
  { key: 'medical_q8', width: 14 },
  { key: 'medical_q9', width: 14 },
  { key: 'medical_q10', width: 14 },
  { key: 'dental_previous_dentist', width: 24 },
  { key: 'dental_last_exam', width: 16 },
  { key: 'dental_consultation_reason', width: 34 },
  { key: 'dental_q1', width: 14 },
  { key: 'dental_q2', width: 14 },
  { key: 'dental_q2_note', width: 30 },
  { key: 'dental_q3', width: 14 },
  { key: 'dental_q4', width: 14 },
  { key: 'dental_q5', width: 14 },
  { key: 'dental_q6', width: 14 },
  { key: 'dental_q7', width: 14 },
  { key: 'dental_q8', width: 14 },
  { key: 'dental_q9', width: 14 },
  { key: 'dental_q10', width: 14 },
  { key: 'dental_q11', width: 14 },
  { key: 'dental_q12', width: 14 },
  { key: 'dental_q13', width: 14 },
  { key: 'dental_q14', width: 14 },
  { key: 'dental_q15', width: 14 },
  { key: 'dental_q16', width: 14 },
  { key: 'dental_q17', width: 14 },
  { key: 'dental_q18', width: 14 },
]

const PATIENT_SAMPLE_ROWS = [
  {
    first_name: 'Juan',
    last_name: 'Dela Cruz',
    middle_name: 'Santos',
    suffix: '',
    sex: 'Male',
    birth_date: '06/15/1995',
    phone: '09171234567',
    email: 'juan.delacruz@example.com',
    address: 'Unit 8, Block 3, San Pedro Heights, San Pedro City, Laguna',
    nickname: 'Jun',
    civil_status: 'Single',
    occupation: 'Office Staff',
    office_address: 'Ayala Avenue, Makati City, Metro Manila',
    guardian_name: '',
    guardian_mobile_number: '',
    guardian_occupation: '',
    guardian_office_address: '',
    emergency_contact_name: 'Maria Dela Cruz',
    emergency_contact_phone: '09181234567',
    authorization_accepted: 'TRUE',
    is_active: 'TRUE',
    allergies: 'Penicillin; Dust',
    medical_physician: 'Dr. Maria Santos',
    medical_specialty: 'Family Medicine',
    medical_address: 'Binan Doctors Clinic, Binan City, Laguna',
    medical_q1: 'YES',
    medical_q2: 'YES',
    medical_q2_note: 'Asthma maintenance consultation',
    medical_q3: 'NO',
    medical_q4: 'YES',
    medical_q4_note: 'Admitted in 2022 for dengue',
    medical_q5: 'YES',
    medical_q5_note: 'Salbutamol inhaler as needed',
    medical_q6: 'NO',
    medical_q7: 'NO',
    medical_q8: 'NO',
    medical_q9: 'NO',
    medical_q10: 'NO',
    dental_previous_dentist: 'Dr. Lopez',
    dental_last_exam: '03/01/2026',
    dental_consultation_reason: 'Routine dental checkup and cleaning',
    dental_q1: 'NO',
    dental_q2: 'YES',
    dental_q2_note: 'Follow-up for mild jaw discomfort',
    dental_q3: 'NO',
    dental_q4: 'NO',
    dental_q5: 'YES',
    dental_q6: 'NO',
    dental_q7: 'NO',
    dental_q8: 'YES',
    dental_q9: 'NO',
    dental_q10: 'NO',
    dental_q11: 'NO',
    dental_q12: 'NO',
    dental_q13: 'NO',
    dental_q14: 'NO',
    dental_q15: 'YES',
    dental_q16: 'NO',
    dental_q17: 'NO',
    dental_q18: 'YES',
  },
  {
    first_name: 'Angela',
    last_name: 'Reyes',
    middle_name: 'Torres',
    suffix: '',
    sex: 'Female',
    birth_date: '11/02/1988',
    phone: '09190001111',
    email: 'angela.reyes@example.com',
    address: 'Rose Street, Santa Rosa City, Laguna',
    nickname: 'Gel',
    civil_status: 'Married',
    occupation: 'Accountant',
    office_address: 'BGC, Taguig City',
    guardian_name: '',
    guardian_mobile_number: '',
    guardian_occupation: '',
    guardian_office_address: '',
    emergency_contact_name: 'Marco Reyes',
    emergency_contact_phone: '09190002222',
    authorization_accepted: 'TRUE',
    is_active: 'TRUE',
    allergies: 'Latex',
    medical_physician: 'Dr. Paolo Lim',
    medical_specialty: 'Internal Medicine',
    medical_address: 'Sta. Rosa Medical Center',
    medical_q1: 'YES',
    medical_q2: 'NO',
    medical_q2_note: '',
    medical_q3: 'NO',
    medical_q4: 'NO',
    medical_q4_note: '',
    medical_q5: 'YES',
    medical_q5_note: 'Maintenance for hypertension',
    medical_q6: 'NO',
    medical_q7: 'NO',
    medical_q8: 'NO',
    medical_q9: 'NO',
    medical_q10: 'NO',
    dental_previous_dentist: 'Dr. Ramos',
    dental_last_exam: '02/15/2026',
    dental_consultation_reason: 'Tooth sensitivity check',
    dental_q1: 'NO',
    dental_q2: 'NO',
    dental_q2_note: '',
    dental_q3: 'YES',
    dental_q4: 'YES',
    dental_q5: 'NO',
    dental_q6: 'NO',
    dental_q7: 'NO',
    dental_q8: 'YES',
    dental_q9: 'NO',
    dental_q10: 'NO',
    dental_q11: 'NO',
    dental_q12: 'NO',
    dental_q13: 'NO',
    dental_q14: 'NO',
    dental_q15: 'YES',
    dental_q16: 'YES',
    dental_q17: 'YES',
    dental_q18: 'YES',
  },
  {
    first_name: 'Kylie',
    last_name: 'Rivera',
    middle_name: 'Lopez',
    suffix: '',
    sex: 'Female',
    birth_date: '07/13/2011',
    phone: '09182225555',
    email: '',
    address: 'Southville, Binan City, Laguna',
    nickname: 'Ky',
    civil_status: 'Single',
    occupation: 'Student',
    office_address: '',
    guardian_name: 'Rina Santos',
    guardian_mobile_number: '09187776666',
    guardian_occupation: 'Vendor',
    guardian_office_address: 'Southville Market, Binan City',
    emergency_contact_name: 'Rina Santos',
    emergency_contact_phone: '09187776666',
    authorization_accepted: 'TRUE',
    is_active: 'TRUE',
    allergies: 'Dust',
    medical_physician: 'Dr. Mia Flores',
    medical_specialty: 'Pediatrics',
    medical_address: 'Binan Pediatric Clinic',
    medical_q1: 'YES',
    medical_q2: 'YES',
    medical_q2_note: 'Asthma follow-up ongoing',
    medical_q3: 'NO',
    medical_q4: 'NO',
    medical_q4_note: '',
    medical_q5: 'YES',
    medical_q5_note: 'Inhaler as needed',
    medical_q6: 'NO',
    medical_q7: 'NO',
    medical_q8: 'NO',
    medical_q9: 'NO',
    medical_q10: 'NO',
    dental_previous_dentist: 'Dr. Keith San Miguel',
    dental_last_exam: '01/28/2026',
    dental_consultation_reason: 'Upper-right tooth pain',
    dental_q1: 'YES',
    dental_q2: 'NO',
    dental_q2_note: '',
    dental_q3: 'YES',
    dental_q4: 'YES',
    dental_q5: 'NO',
    dental_q6: 'NO',
    dental_q7: 'NO',
    dental_q8: 'YES',
    dental_q9: 'NO',
    dental_q10: 'NO',
    dental_q11: 'NO',
    dental_q12: 'NO',
    dental_q13: 'NO',
    dental_q14: 'NO',
    dental_q15: 'YES',
    dental_q16: 'NO',
    dental_q17: 'NO',
    dental_q18: 'YES',
  },
  {
    first_name: 'Roberto',
    last_name: 'Garcia',
    middle_name: 'Navarro',
    suffix: 'Jr.',
    sex: 'Male',
    birth_date: '04/21/1976',
    phone: '09175554444',
    email: 'roberto.garcia@example.com',
    address: 'Poblacion, Cabuyao City, Laguna',
    nickname: 'Bert',
    civil_status: 'Married',
    occupation: 'Driver',
    office_address: 'Calamba Transport Terminal',
    guardian_name: '',
    guardian_mobile_number: '',
    guardian_occupation: '',
    guardian_office_address: '',
    emergency_contact_name: 'Liza Garcia',
    emergency_contact_phone: '09176665555',
    authorization_accepted: 'TRUE',
    is_active: 'TRUE',
    allergies: 'Aspirin',
    medical_physician: 'Dr. Henry Cruz',
    medical_specialty: 'Cardiology',
    medical_address: 'Calamba Heart Center',
    medical_q1: 'NO',
    medical_q2: 'YES',
    medical_q2_note: 'Cardiac monitoring',
    medical_q3: 'YES',
    medical_q4: 'YES',
    medical_q4_note: 'Bypass surgery in 2021',
    medical_q5: 'YES',
    medical_q5_note: 'Blood thinner maintenance',
    medical_q6: 'YES',
    medical_q7: 'NO',
    medical_q8: 'NO',
    medical_q9: 'NO',
    medical_q10: 'NO',
    dental_previous_dentist: 'Dr. Mendoza',
    dental_last_exam: '12/18/2025',
    dental_consultation_reason: 'Broken filling replacement',
    dental_q1: 'YES',
    dental_q2: 'YES',
    dental_q2_note: 'Under cardiology treatment',
    dental_q3: 'NO',
    dental_q4: 'NO',
    dental_q5: 'YES',
    dental_q6: 'NO',
    dental_q7: 'NO',
    dental_q8: 'YES',
    dental_q9: 'NO',
    dental_q10: 'NO',
    dental_q11: 'YES',
    dental_q12: 'NO',
    dental_q13: 'YES',
    dental_q14: 'NO',
    dental_q15: 'NO',
    dental_q16: 'NO',
    dental_q17: 'YES',
    dental_q18: 'NO',
  },
  {
    first_name: 'Sofia',
    last_name: 'Villanueva',
    middle_name: 'Perez',
    suffix: '',
    sex: 'Female',
    birth_date: '09/09/2001',
    phone: '09173334444',
    email: 'sofia.villanueva@example.com',
    address: 'Nuvali, Santa Rosa City, Laguna',
    nickname: 'Fia',
    civil_status: 'Single',
    occupation: 'Graphic Designer',
    office_address: 'Remote Work Setup, Santa Rosa City',
    guardian_name: '',
    guardian_mobile_number: '',
    guardian_occupation: '',
    guardian_office_address: '',
    emergency_contact_name: 'Elena Villanueva',
    emergency_contact_phone: '09174445555',
    authorization_accepted: 'TRUE',
    is_active: 'TRUE',
    allergies: 'None',
    medical_physician: '',
    medical_specialty: '',
    medical_address: '',
    medical_q1: 'YES',
    medical_q2: 'NO',
    medical_q2_note: '',
    medical_q3: 'NO',
    medical_q4: 'NO',
    medical_q4_note: '',
    medical_q5: 'NO',
    medical_q5_note: '',
    medical_q6: 'NO',
    medical_q7: 'NO',
    medical_q8: 'NO',
    medical_q9: 'NO',
    medical_q10: 'YES',
    dental_previous_dentist: 'Dr. Aquino',
    dental_last_exam: '04/05/2026',
    dental_consultation_reason: 'Teeth whitening consultation',
    dental_q1: 'NO',
    dental_q2: 'NO',
    dental_q2_note: '',
    dental_q3: 'NO',
    dental_q4: 'NO',
    dental_q5: 'NO',
    dental_q6: 'NO',
    dental_q7: 'YES',
    dental_q8: 'YES',
    dental_q9: 'NO',
    dental_q10: 'NO',
    dental_q11: 'NO',
    dental_q12: 'NO',
    dental_q13: 'NO',
    dental_q14: 'NO',
    dental_q15: 'NO',
    dental_q16: 'YES',
    dental_q17: 'YES',
    dental_q18: 'YES',
  },
]

export const RECORDS_TEMPLATE_COLUMNS = [
  { key: 'patient_id', width: 16, textFormat: true },
  { key: 'patient_first_name', width: 18 },
  { key: 'patient_last_name', width: 18 },
  { key: 'dental_record_recorded_at', width: 28 },
  { key: 'dental_record_findings', width: 34 },
  { key: 'dental_record_treatment', width: 30 },
  { key: 'dental_record_dentist_staff_id', width: 20 },
  { key: 'dental_record_prescriptions', width: 28 },
  { key: 'dental_record_notes', width: 34 },
  { key: 'dental_record_top_tooth_chart', width: 28 },
  { key: 'dental_record_bottom_tooth_chart', width: 28 },
  { key: 'dental_record_periodontal_gingivitis', width: 16 },
  { key: 'dental_record_periodontal_moderate_periodontitis', width: 20 },
  { key: 'dental_record_periodontal_early_periodontitis', width: 18 },
  { key: 'dental_record_periodontal_advanced_periodontitis', width: 20 },
  { key: 'dental_record_occlusion_class_i_molar', width: 18 },
  { key: 'dental_record_occlusion_overbite', width: 16 },
  { key: 'dental_record_occlusion_overjet', width: 16 },
  { key: 'dental_record_occlusion_midline_deviation', width: 20 },
  ...Array.from({ length: 10 }, (_, index) => ([
    { key: `service_${index + 1}_name`, width: 24 },
    { key: `service_${index + 1}_quantity`, width: 14 },
    { key: `service_${index + 1}_unit_price`, width: 16 },
    { key: `service_${index + 1}_discount_amount`, width: 18 },
  ])).flat(),
]

const RECORDS_SAMPLE_ROWS = [
  {
    patient_id: 'PT-000001',
    patient_first_name: 'Juan',
    patient_last_name: 'Dela Cruz',
    dental_record_recorded_at: '04/15/2026',
    dental_record_findings: 'General cleaning and chart review',
    dental_record_treatment: 'Oral prophylaxis',
    dental_record_dentist_staff_id: 'ST-100001',
    dental_record_prescriptions: 'None',
    dental_record_notes: 'Initial dental record import',
    dental_record_top_tooth_chart: '16:C; 14:F',
    dental_record_bottom_tooth_chart: '30:F; 29:C',
    dental_record_periodontal_gingivitis: 'TRUE',
    dental_record_periodontal_moderate_periodontitis: 'FALSE',
    dental_record_periodontal_early_periodontitis: 'FALSE',
    dental_record_periodontal_advanced_periodontitis: 'FALSE',
    dental_record_occlusion_class_i_molar: 'TRUE',
    dental_record_occlusion_overbite: 'FALSE',
    dental_record_occlusion_overjet: 'FALSE',
    dental_record_occlusion_midline_deviation: 'FALSE',
    service_1_name: 'Teeth Cleaning',
    service_1_quantity: '1',
    service_1_unit_price: '1200',
    service_1_discount_amount: '0',
    service_2_name: 'Dental X-Ray Services',
    service_2_quantity: '1',
    service_2_unit_price: '950',
    service_2_discount_amount: '0',
    service_3_name: 'Fluoride Application',
    service_3_quantity: '1',
    service_3_unit_price: '700',
    service_3_discount_amount: '0',
  },
  {
    patient_id: 'PT-000002',
    patient_first_name: 'Angela',
    patient_last_name: 'Reyes',
    dental_record_recorded_at: '04/12/2026',
    dental_record_findings: 'Sensitivity on upper incisor with old composite margin stain',
    dental_record_treatment: 'Composite restoration',
    dental_record_dentist_staff_id: 'ST-100002',
    dental_record_prescriptions: 'Ibuprofen 400mg if needed',
    dental_record_notes: 'Patient requested aesthetic shade match',
    dental_record_top_tooth_chart: '11:F',
    dental_record_bottom_tooth_chart: '',
    dental_record_periodontal_gingivitis: 'FALSE',
    dental_record_periodontal_moderate_periodontitis: 'FALSE',
    dental_record_periodontal_early_periodontitis: 'TRUE',
    dental_record_periodontal_advanced_periodontitis: 'FALSE',
    dental_record_occlusion_class_i_molar: 'TRUE',
    dental_record_occlusion_overbite: 'TRUE',
    dental_record_occlusion_overjet: 'FALSE',
    dental_record_occlusion_midline_deviation: 'FALSE',
    service_1_name: 'Composite Filling',
    service_1_quantity: '1',
    service_1_unit_price: '2500',
    service_1_discount_amount: '200',
  },
  {
    patient_id: 'PT-000003',
    patient_first_name: 'Kylie',
    patient_last_name: 'Rivera',
    dental_record_recorded_at: '04/02/2026',
    dental_record_findings: 'Upper-right teeth show caries',
    dental_record_treatment: 'Glass ionomer restoration advised',
    dental_record_dentist_staff_id: 'ST-100003',
    dental_record_prescriptions: 'Paracetamol syrup if needed',
    dental_record_notes: 'Pediatric chart test row',
    dental_record_top_tooth_chart: '3:C; 4:C',
    dental_record_bottom_tooth_chart: '',
    dental_record_periodontal_gingivitis: 'TRUE',
    dental_record_periodontal_moderate_periodontitis: 'FALSE',
    dental_record_periodontal_early_periodontitis: 'FALSE',
    dental_record_periodontal_advanced_periodontitis: 'FALSE',
    dental_record_occlusion_class_i_molar: 'TRUE',
    dental_record_occlusion_overbite: 'FALSE',
    dental_record_occlusion_overjet: 'FALSE',
    dental_record_occlusion_midline_deviation: 'FALSE',
    service_1_name: 'Pediatric Restoration',
    service_1_quantity: '2',
    service_1_unit_price: '1500',
    service_1_discount_amount: '0',
    service_2_name: 'Dental Consultation',
    service_2_quantity: '1',
    service_2_unit_price: '500',
    service_2_discount_amount: '0',
  },
  {
    patient_id: 'PT-000004',
    patient_first_name: 'Roberto',
    patient_last_name: 'Garcia',
    dental_record_recorded_at: '03/20/2026',
    dental_record_findings: 'Deep caries with percussion tenderness',
    dental_record_treatment: 'Extraction performed',
    dental_record_dentist_staff_id: 'ST-100004',
    dental_record_prescriptions: 'Amoxicillin 500mg; Mefenamic acid',
    dental_record_notes: 'Monitor blood pressure before procedure',
    dental_record_top_tooth_chart: '',
    dental_record_bottom_tooth_chart: '36:X',
    dental_record_periodontal_gingivitis: 'FALSE',
    dental_record_periodontal_moderate_periodontitis: 'TRUE',
    dental_record_periodontal_early_periodontitis: 'FALSE',
    dental_record_periodontal_advanced_periodontitis: 'FALSE',
    dental_record_occlusion_class_i_molar: 'FALSE',
    dental_record_occlusion_overbite: 'FALSE',
    dental_record_occlusion_overjet: 'FALSE',
    dental_record_occlusion_midline_deviation: 'TRUE',
    service_1_name: 'Tooth Extraction',
    service_1_quantity: '1',
    service_1_unit_price: '3500',
    service_1_discount_amount: '0',
    service_2_name: 'Blood Pressure Monitoring',
    service_2_quantity: '1',
    service_2_unit_price: '300',
    service_2_discount_amount: '0',
  },
  {
    patient_id: 'PT-000005',
    patient_first_name: 'Sofia',
    patient_last_name: 'Villanueva',
    dental_record_recorded_at: '04/05/2026',
    dental_record_findings: 'Healthy dentition for whitening assessment',
    dental_record_treatment: 'Whitening consultation and impressions',
    dental_record_dentist_staff_id: 'ST-100005',
    dental_record_prescriptions: 'None',
    dental_record_notes: 'Interested in take-home trays',
    dental_record_top_tooth_chart: '',
    dental_record_bottom_tooth_chart: '',
    dental_record_periodontal_gingivitis: 'FALSE',
    dental_record_periodontal_moderate_periodontitis: 'FALSE',
    dental_record_periodontal_early_periodontitis: 'FALSE',
    dental_record_periodontal_advanced_periodontitis: 'FALSE',
    dental_record_occlusion_class_i_molar: 'TRUE',
    dental_record_occlusion_overbite: 'FALSE',
    dental_record_occlusion_overjet: 'FALSE',
    dental_record_occlusion_midline_deviation: 'FALSE',
    service_1_name: 'Whitening Consultation',
    service_1_quantity: '1',
    service_1_unit_price: '800',
    service_1_discount_amount: '0',
    service_2_name: 'Impression Taking',
    service_2_quantity: '1',
    service_2_unit_price: '1200',
    service_2_discount_amount: '100',
  },
]

const QUESTION_LEGENDS = [
  ...MEDICAL_QUESTIONS.map((question, index) => ({
    code: `medical_q${index + 1}`,
    question,
    noteField: [2, 4, 5].includes(index + 1) ? `medical_q${index + 1}_note` : '',
  })),
  ...DENTAL_QUESTIONS.map((question, index) => ({
    code: `dental_q${index + 1}`,
    question,
    noteField: index === 1 ? 'dental_q2_note' : '',
  })),
]

const styleHeaderRow = (row) => {
  row.eachCell((cell) => {
    if (!(cell.value && typeof cell.value === 'object' && 'richText' in cell.value)) {
      cell.font = {
        bold: true,
        color: { argb: HEADER_TEXT },
      }
    }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: HEADER_FILL },
    }
    cell.alignment = {
      vertical: 'middle',
      horizontal: 'center',
      wrapText: true,
    }
    cell.border = {
      top: { style: 'thin', color: { argb: HEADER_BORDER } },
      left: { style: 'thin', color: { argb: HEADER_BORDER } },
      bottom: { style: 'thin', color: { argb: HEADER_BORDER } },
      right: { style: 'thin', color: { argb: HEADER_BORDER } },
    }
  })
  row.height = 38
}

const applyCellBorders = (row) => {
  row.eachCell((cell) => {
    cell.border = {
      top: { style: 'thin', color: { argb: LEGEND_BORDER } },
      left: { style: 'thin', color: { argb: LEGEND_BORDER } },
      bottom: { style: 'thin', color: { argb: LEGEND_BORDER } },
      right: { style: 'thin', color: { argb: LEGEND_BORDER } },
    }
    cell.alignment = {
      vertical: 'top',
      wrapText: true,
    }
  })
}

const getBodyBorder = () => ({
  top: { style: 'thin', color: { argb: BODY_BORDER } },
  left: { style: 'thin', color: { argb: BODY_BORDER } },
  bottom: { style: 'thin', color: { argb: BODY_BORDER } },
  right: { style: 'thin', color: { argb: BODY_BORDER } },
})

const setSheetColumns = (worksheet, columns) => {
  columns.forEach((column, index) => {
    const sheetColumn = worksheet.getColumn(index + 1)
    sheetColumn.width = column.width
    if (column.textFormat) {
      sheetColumn.numFmt = '@'
    }
  })
}

const DATE_FORMAT_HINT_BY_KEY = {
  birth_date: 'mm/dd/yyyy',
  dental_last_exam: 'mm/dd/yyyy',
  dental_record_recorded_at: 'mm/dd/yyyy',
}

const toSentenceCaseLabel = (value) => {
  if (!value) return ''
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()
}

const getDisplayHeader = (key) => {
  if (key === 'phone') {
    return 'Mobile number'
  }

  if (/^medical_q\d+$/.test(key)) {
    const number = key.split('_q')[1]
    return `Medical question ${number}`
  }

  if (/^medical_q\d+_note$/.test(key)) {
    const number = key.match(/^medical_q(\d+)_note$/)?.[1]
    return `Medical question ${number} note`
  }

  if (/^dental_q\d+$/.test(key)) {
    const number = key.split('_q')[1]
    return `Dental question ${number}`
  }

  if (/^dental_q\d+_note$/.test(key)) {
    const number = key.match(/^dental_q(\d+)_note$/)?.[1]
    return `Dental question ${number} note`
  }

  if (/^service_\d+_/.test(key)) {
    const match = key.match(/^service_(\d+)_(.+)$/)
    if (match) {
      const [, serviceNumber, fieldName] = match
      return `Service ${serviceNumber} ${fieldName.split('_').join(' ')}`
    }
  }

  return key
    .split('_')
    .filter(Boolean)
    .map((part) => {
      if (part === 'id') return 'ID'
      if (/^[ivx]+$/i.test(part)) return part.toUpperCase()
      return toSentenceCaseLabel(part)
    })
    .join(' ')
}

const HEADER_KEY_BY_DISPLAY = new Map(
  [...PATIENT_TEMPLATE_COLUMNS, ...RECORDS_TEMPLATE_COLUMNS].map((column) => [getDisplayHeader(column.key), column.key]),
)

const getHeaderLabelForImport = (value) => `${value ?? ''}`.split(/\r?\n/)[0].trim()

const toImportHeaderKey = (value) => HEADER_KEY_BY_DISPLAY.get(getHeaderLabelForImport(value)) || value

const getHeaderCellValue = (key) => {
  const label = getDisplayHeader(key)
  const dateFormatHint = DATE_FORMAT_HINT_BY_KEY[key]

  if (!dateFormatHint) {
    return label
  }

  return {
    richText: [
      { text: label, font: { bold: true, color: { argb: HEADER_TEXT } } },
      { text: `\n${dateFormatHint}`, font: { size: 9, color: { argb: HEADER_TEXT } } },
    ],
  }
}

const addTemplateInputSheet = (workbook) => {
  const worksheet = workbook.addWorksheet('Patient Information', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })

  setSheetColumns(worksheet, PATIENT_TEMPLATE_COLUMNS)
  const headerRow = worksheet.addRow(PATIENT_TEMPLATE_COLUMNS.map((column) => getHeaderCellValue(column.key)))
  styleHeaderRow(headerRow)

  for (let rowIndex = 2; rowIndex <= 500; rowIndex += 1) {
    for (let columnIndex = 1; columnIndex <= PATIENT_TEMPLATE_COLUMNS.length; columnIndex += 1) {
      const cell = worksheet.getCell(rowIndex, columnIndex)
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: SHEET_BACKGROUND },
      }
      cell.border = getBodyBorder()
    }
  }

  const dataValidationColumns = new Set([
    'authorization_accepted',
    'is_active',
    ...Array.from({ length: 10 }, (_, index) => `medical_q${index + 1}`),
    ...Array.from({ length: 18 }, (_, index) => `dental_q${index + 1}`),
  ])

  PATIENT_TEMPLATE_COLUMNS.forEach((column, index) => {
    if (!dataValidationColumns.has(column.key) && column.key !== 'sex' && column.key !== 'civil_status') {
      return
    }

    for (let rowIndex = 2; rowIndex <= 500; rowIndex += 1) {
      const cell = worksheet.getCell(rowIndex, index + 1)
      if (column.key === 'sex') {
        cell.dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: ['"Male,Female"'],
        }
        continue
      }

      if (column.key === 'civil_status') {
        cell.dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: ['"Single,Married,Widowed,Divorced,Separated"'],
        }
        continue
      }

      cell.dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"YES,NO,TRUE,FALSE"'],
      }
    }
  })

  return worksheet
}

const addLegendSheet = async (workbook) => {
  const worksheet = workbook.addWorksheet('Example and Legends', {
    views: [{ state: 'frozen', ySplit: 5 }],
  })

  worksheet.getColumn(1).width = 16
  worksheet.getColumn(2).width = 56
  worksheet.getColumn(3).width = 20
  worksheet.getColumn(4).width = 28

  worksheet.mergeCells('A1:D1')
  const titleCell = worksheet.getCell('A1')
  titleCell.value = 'Patient import template - legends and example'
  titleCell.font = { bold: true, size: 14, color: { argb: '1E3A8A' } }
  titleCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: LEGEND_TITLE_FILL },
  }
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' }

  worksheet.mergeCells('A2:D2')
  worksheet.getCell('A2').value = 'Use the first sheet for actual patient encoding. This sheet is view-only and shows the legends plus a complete sample record.'
  worksheet.getCell('A2').font = { color: { argb: SECONDARY_TEXT } }

  worksheet.mergeCells('A4:D4')
  worksheet.getCell('A4').value = 'Question Legends'
  worksheet.getCell('A4').font = { bold: true, size: 12 }

  const legendHeader = worksheet.addRow(['Column', 'Question', 'Note column', 'Accepted answers'])
  styleHeaderRow(legendHeader)

  QUESTION_LEGENDS.forEach((legend) => {
    const row = worksheet.addRow([
      getDisplayHeader(legend.code),
      legend.question,
      legend.noteField ? getDisplayHeader(legend.noteField) : '-',
      'YES or NO. You may also use TRUE or FALSE.',
    ])
    applyCellBorders(row)
  })

  worksheet.addRow([])
  worksheet.addRow(['Sample record'])
  worksheet.getCell(`A${worksheet.rowCount}`).font = { bold: true, size: 12 }

  const sampleHeader = worksheet.addRow(PATIENT_TEMPLATE_COLUMNS.map((column) => getHeaderCellValue(column.key)))
  styleHeaderRow(sampleHeader)
  PATIENT_SAMPLE_ROWS.forEach((sample) => {
    const sampleRow = worksheet.addRow(PATIENT_TEMPLATE_COLUMNS.map((column) => sample[column.key] || ''))
    applyCellBorders(sampleRow)
  })

  PATIENT_TEMPLATE_COLUMNS.forEach((column, index) => {
    const sheetColumn = worksheet.getColumn(index + 1)
    sheetColumn.width = Math.max(sheetColumn.width || 10, column.width)
  })

  await worksheet.protect(WORKBOOK_PASSWORD, {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatCells: false,
    formatColumns: false,
    formatRows: false,
    insertColumns: false,
    insertRows: false,
    deleteColumns: false,
    deleteRows: false,
    sort: false,
    autoFilter: false,
    pivotTables: false,
  })
}

const addRecordsInputSheet = (workbook) => {
  const worksheet = workbook.addWorksheet('Dental and Service Records', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })

  setSheetColumns(worksheet, RECORDS_TEMPLATE_COLUMNS)
  const headerRow = worksheet.addRow(RECORDS_TEMPLATE_COLUMNS.map((column) => getHeaderCellValue(column.key)))
  styleHeaderRow(headerRow)

  const yesNoColumns = new Set([
    'dental_record_periodontal_gingivitis',
    'dental_record_periodontal_moderate_periodontitis',
    'dental_record_periodontal_early_periodontitis',
    'dental_record_periodontal_advanced_periodontitis',
    'dental_record_occlusion_class_i_molar',
    'dental_record_occlusion_overbite',
    'dental_record_occlusion_overjet',
    'dental_record_occlusion_midline_deviation',
  ])

  for (let rowIndex = 2; rowIndex <= 500; rowIndex += 1) {
    for (let columnIndex = 1; columnIndex <= RECORDS_TEMPLATE_COLUMNS.length; columnIndex += 1) {
      const cell = worksheet.getCell(rowIndex, columnIndex)
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: SHEET_BACKGROUND },
      }
      cell.border = getBodyBorder()
    }
  }

  RECORDS_TEMPLATE_COLUMNS.forEach((column, index) => {
    if (!yesNoColumns.has(column.key)) return

    for (let rowIndex = 2; rowIndex <= 500; rowIndex += 1) {
      worksheet.getCell(rowIndex, index + 1).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"TRUE,FALSE,YES,NO"'],
      }
    }
  })

  return worksheet
}

const addRecordsExampleSheet = async (workbook) => {
  const worksheet = workbook.addWorksheet('Example Only', {
    views: [{ state: 'frozen', ySplit: 4 }],
  })

  worksheet.mergeCells('A1:D1')
  const titleCell = worksheet.getCell('A1')
  titleCell.value = 'Dental and service records - examples'
  titleCell.font = { bold: true, size: 14, color: { argb: '1E3A8A' } }
  titleCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: LEGEND_TITLE_FILL },
  }
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' }

  worksheet.mergeCells('A2:D2')
  worksheet.getCell('A2').value = 'This sheet is view-only. Use it as a guide for possible record values accepted by the system.'
  worksheet.getCell('A2').font = { color: { argb: SECONDARY_TEXT } }

  const sampleHeader = worksheet.addRow(RECORDS_TEMPLATE_COLUMNS.map((column) => getHeaderCellValue(column.key)))
  styleHeaderRow(sampleHeader)
  RECORDS_SAMPLE_ROWS.forEach((sample) => {
    const row = worksheet.addRow(RECORDS_TEMPLATE_COLUMNS.map((column) => sample[column.key] || ''))
    applyCellBorders(row)
  })

  RECORDS_TEMPLATE_COLUMNS.forEach((column, index) => {
    const sheetColumn = worksheet.getColumn(index + 1)
    sheetColumn.width = column.width
  })

  await worksheet.protect(WORKBOOK_PASSWORD, {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatCells: false,
    formatColumns: false,
    formatRows: false,
    insertColumns: false,
    insertRows: false,
    deleteColumns: false,
    deleteRows: false,
    sort: false,
    autoFilter: false,
    pivotTables: false,
  })
}

const downloadWorkbook = async (fileName, buildWorkbook) => {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Smiles Dental'
  workbook.created = new Date()
  await buildWorkbook(workbook)

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob(
    [buffer],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  )
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const downloadPatientTemplateWorkbook = async () => downloadWorkbook(
  'patient-information-template.xlsx',
  async (workbook) => {
    addTemplateInputSheet(workbook)
    await addLegendSheet(workbook)
  },
)

export const downloadRecordsTemplateWorkbook = async () => downloadWorkbook(
  'dental-and-service-records-template.xlsx',
  async (workbook) => {
    addRecordsInputSheet(workbook)
    await addRecordsExampleSheet(workbook)
  },
)

const formatDateValue = (date) => {
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  const year = date.getFullYear()
  return `${month}/${day}/${year}`
}

const toCsvSafeValue = (value) => {
  const normalized = `${value ?? ''}`
  if (/[",\n\r]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`
  }
  return normalized
}

const getCellTextValue = (cell, headerKey) => {
  const value = cell.value
  if (value instanceof Date) {
    return formatDateValue(value)
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE'
  }
  if (typeof value === 'number') {
    if (headerKey.includes('phone')) {
      return cell.text || `${value}`
    }
    return `${value}`
  }
  if (value && typeof value === 'object' && 'result' in value && value.result != null) {
    return `${value.result}`
  }
  return `${cell.text || ''}`.trim()
}

export const readImportFileAsCsv = async (file) => {
  if (file.name.toLowerCase().endsWith('.csv')) {
    return file.text()
  }

  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  const buffer = await file.arrayBuffer()
  await workbook.xlsx.load(buffer)
  const worksheet = workbook.worksheets[0]

  if (!worksheet) {
    return ''
  }

  const headerRow = worksheet.getRow(1)
  const headers = Array.from({ length: headerRow.cellCount }, (_, index) => getCellTextValue(headerRow.getCell(index + 1), ''))
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => toImportHeaderKey(value))

  if (headers.length === 0) {
    return ''
  }

  const csvRows = [headers.map(toCsvSafeValue).join(',')]

  for (let rowIndex = 2; rowIndex <= worksheet.rowCount; rowIndex += 1) {
    const row = worksheet.getRow(rowIndex)
    const values = headers.map((header, index) => getCellTextValue(row.getCell(index + 1), header))
    if (!values.some((value) => value.trim())) {
      continue
    }
    csvRows.push(values.map(toCsvSafeValue).join(','))
  }

  return csvRows.join('\r\n')
}

export const readPatientImportFileAsCsv = readImportFileAsCsv
