const normalizeLookupValue = (value) => `${value ?? ''}`.trim().replace(/\s+/g, ' ')

export const isPatientDuplicateError = (error) => {
  const errorText = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`
  return error?.code === '23505' && errorText.includes('idx_patients_identity_active_unique')
}

export const findExistingPatientRecord = async (
  supabase,
  {
    firstName,
    lastName,
    sex,
    birthdate,
    excludeId = null,
    includeArchived = false,
  },
) => {
  const normalizedFirstName = normalizeLookupValue(firstName)
  const normalizedLastName = normalizeLookupValue(lastName)
  const normalizedSex = normalizeLookupValue(sex)
  const normalizedBirthdate = normalizeLookupValue(birthdate)

  if (!normalizedFirstName || !normalizedLastName || !normalizedSex || !normalizedBirthdate) {
    return null
  }

  let query = supabase
    .from('patients')
    .select('id, patient_code, first_name, last_name, birth_date, sex, archived_at')
    .ilike('first_name', normalizedFirstName)
    .ilike('last_name', normalizedLastName)
    .eq('sex', normalizedSex)
    .eq('birth_date', normalizedBirthdate)
    .limit(1)

  if (!includeArchived) {
    query = query.is('archived_at', null)
  }

  if (excludeId) {
    query = query.neq('id', excludeId)
  }

  const { data, error } = await query
  if (error) throw error

  return data?.[0] ?? null
}
