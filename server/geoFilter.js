/** Excluye sector antártico del GeoJSON de provincias (Georef). */
export function isStandaloneAntarcticaFeature(feature) {
  const name = String(feature?.properties?.nombre || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  return name === 'antartida'
}

export function filterAntarcticaFromGeoJson(geojson) {
  if (!geojson?.features?.length) return geojson
  return {
    ...geojson,
    features: geojson.features.filter((f) => !isStandaloneAntarcticaFeature(f)),
  }
}
