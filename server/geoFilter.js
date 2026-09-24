/** Filtros de geometría Georef: Antártida, Malvinas y Atlántico Sur fuera del mapa. */

function normalizeGeoName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

export function isStandaloneAntarcticaFeature(feature) {
  return normalizeGeoName(feature?.properties?.nombre) === 'antartida'
}

function isTierraDelFuegoProvinceName(name) {
  return normalizeGeoName(name).includes('tierra del fuego')
}

/** Departamentos/áreas de TdF que no son la isla principal. */
export function isExcludedTierraDelFuegoAreaName(name) {
  const n = normalizeGeoName(name)
  if (!n) return false
  if (n.includes('antartida')) return true
  if (n.includes('malvina')) return true
  if (n.includes('atlantico sur')) return true
  if (n.includes('georgia del sur')) return true
  if (n.includes('sandwich del sur')) return true
  return false
}

function ringArea(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 0
  let area2 = 0
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[i + 1]
    area2 += x1 * y2 - x2 * y1
  }
  return Math.abs(area2) / 2
}

function ringCentroidLngLat(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null
  let area2 = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[i + 1]
    const cross = x1 * y2 - x2 * y1
    area2 += cross
    cx += (x1 + x2) * cross
    cy += (y1 + y2) * cross
  }
  if (Math.abs(area2) < 1e-9) {
    const [lng, lat] = ring[0] || []
    if (lng == null || lat == null) return null
    return [lng, lat]
  }
  return [cx / (3 * area2), cy / (3 * area2)]
}

function polygonBounds(polygonCoords) {
  const outer = polygonCoords?.[0]
  if (!Array.isArray(outer) || !outer.length) return null
  let minLat = Infinity
  let maxLat = -Infinity
  let minLng = Infinity
  let maxLng = -Infinity
  for (const [lng, lat] of outer) {
    if (lat == null || lng == null) continue
    minLat = Math.min(minLat, lat)
    maxLat = Math.max(maxLat, lat)
    minLng = Math.min(minLng, lng)
    maxLng = Math.max(maxLng, lng)
  }
  if (!Number.isFinite(minLat)) return null
  return { minLat, maxLat, minLng, maxLng }
}

/**
 * Solo Isla Grande de Tierra del Fuego (lado argentino), como el mapa de referencia.
 * Sin Antártida, Malvinas, Isla de los Estados ni Atlántico Sur.
 */
export function isTierraDelFuegoIslandPart(lng, lat, bounds = null) {
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) return false
  // Caja aproximada de la Isla Grande argentina (Río Grande → Ushuaia)
  if (lat < -55.12 || lat > -52.55) return false
  if (lng < -68.7 || lng > -65.05) return false
  if (bounds) {
    // Descartar piezas que se escapan hacia Antártida / Malvinas / Estados
    if (bounds.minLat < -55.15) return false
    if (bounds.maxLng > -64.9) return false
    if (bounds.maxLat > -52.4) return false
  }
  return true
}

function clipTierraDelFuegoFeature(feature) {
  if (!isTierraDelFuegoProvinceName(feature?.properties?.nombre)) return feature
  const geometry = feature.geometry
  if (!geometry) return feature

  const candidates = []
  if (geometry.type === 'Polygon') {
    candidates.push(geometry.coordinates)
  } else if (geometry.type === 'MultiPolygon') {
    candidates.push(...(geometry.coordinates || []))
  } else {
    return feature
  }

  const kept = candidates.filter((poly) => {
    const c = ringCentroidLngLat(poly?.[0])
    const b = polygonBounds(poly)
    return c && isTierraDelFuegoIslandPart(c[0], c[1], b)
  })

  if (!kept.length) return null

  // Quedarse con el polígono principal (Isla Grande), no islotes sueltos
  kept.sort((a, b) => ringArea(b?.[0]) - ringArea(a?.[0]))
  const main = kept[0]

  return {
    ...feature,
    geometry: { type: 'Polygon', coordinates: main },
  }
}

export function filterAntarcticaFromGeoJson(geojson) {
  if (!geojson?.features?.length) return geojson
  return {
    ...geojson,
    features: geojson.features
      .filter((f) => !isStandaloneAntarcticaFeature(f))
      .map((f) => clipTierraDelFuegoFeature(f))
      .filter(Boolean),
  }
}

/** Filtra departamentos de TdF (Antártida / Malvinas / Atlántico Sur). */
export function filterTierraDelFuegoDepartmentsGeoJson(geojson) {
  if (!geojson?.features?.length) return geojson
  return {
    ...geojson,
    features: geojson.features
      .filter((f) => !isExcludedTierraDelFuegoAreaName(f?.properties?.nombre))
      .map((f) => {
        // También recortar geometrías de departamentos que traigan islas lejanas
        if (!f?.geometry) return f
        const clipped = clipTierraDelFuegoFeature({
          ...f,
          properties: { ...f.properties, nombre: 'Tierra del Fuego' },
        })
        if (!clipped) return null
        return { ...f, geometry: clipped.geometry }
      })
      .filter(Boolean),
  }
}
