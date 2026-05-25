export function normalizeGeoName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

export function geoMatches(a, b) {
  if (!a || !b) return false
  return normalizeGeoName(a) === normalizeGeoName(b)
}

export function filterPlacesByProvince(rows, province) {
  if (!province || String(province).toLowerCase() === 'all') return rows
  const target = normalizeGeoName(province)
  return rows.filter((row) => normalizeGeoName(row.province) === target)
}

export function filterPlacesByDepartment(rows, department) {
  if (!department || String(department).toLowerCase() === 'all') return rows
  const target = normalizeGeoName(department)
  return rows.filter((row) => normalizeGeoName(row.department) === target)
}
