/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GeoJSON, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import 'leaflet/dist/leaflet.css'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL || '/api'
const DEFAULT_CENTER = [-38.4161, -63.6167]
const DEFAULT_ZOOM = 4.4
/** Límite sur: territorio continental + Tierra del Fuego (sin Antártida). */
const MAINLAND_MAX_SOUTH = -55.25
const MAINLAND_BOUNDS = [
  [MAINLAND_MAX_SOUTH, -73.59],
  [-21.78, -53.62],
]

function isStandaloneAntarcticaFeature(feature) {
  const name = String(feature?.properties?.nombre || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  return name === 'antartida'
}

function filterAntarcticaFromGeoJson(geojson) {
  if (!geojson?.features?.length) return geojson
  return {
    ...geojson,
    features: geojson.features.filter((f) => !isStandaloneAntarcticaFeature(f)),
  }
}

function getMainlandFitBounds(geojson) {
  const filtered = filterAntarcticaFromGeoJson(geojson)
  if (!filtered?.features?.length) return null
  const gj = L.geoJSON(filtered)
  const b = gj.getBounds()
  if (!b.isValid()) return null
  const south = Math.max(b.getSouth(), MAINLAND_MAX_SOUTH)
  return L.latLngBounds([south, b.getWest()], [b.getNorth(), b.getEast()])
}

const CATEGORY_ICON_URL = {
  bodegas: '/icons/bodegas.png',
  olivicolas: '/icons/olivicolas.png',
  religioso: '/icons/religioso.png',
  hospitales: '/icons/hospitales.png',
  hoteles: '/icons/hoteles.png',
  salud: '/icons/hospitales.png',
  eventos: '/icons/hoteles.png',
}

const CATEGORY_FILTERS = [
  { key: 'all', label: 'Todas' },
  { key: 'bodegas', label: 'Bodegas' },
  { key: 'olivicolas', label: 'Olivícolas' },
  { key: 'religioso', label: 'Religioso' },
  { key: 'hospitales', label: 'Salud' },
  { key: 'hoteles', label: 'Hoteles' },
]

const EVENT_SAVED_ICON = '/icons/evento-guardado.png'
const EVENTS_STORAGE_KEY = 'wt_events'

const MARKER_ICON_SIZE = 28
const MARKER_ICON_HIGHLIGHT_SIZE = 34
const markerIconCache = new Map()

function normalizeCategory(category) {
  if (category === 'salud') return 'hospitales'
  if (category === 'eventos') return 'hoteles'
  return category
}

function normalizeGeoName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function routeDistanceKm(stops) {
  let total = 0
  for (let i = 1; i < stops.length; i += 1) {
    total += haversineKm(stops[i - 1].lat, stops[i - 1].lng, stops[i].lat, stops[i].lng)
  }
  return total
}

function toRouteStop(place) {
  return {
    id: place.id,
    name: place.name,
    lat: place.lat,
    lng: place.lng,
    category: place.category,
    province: place.province,
    department: place.department,
  }
}

function isMendozaName(value) {
  const n = normalizeGeoName(value)
  return n === 'mendoza' || n === 'provincia de mendoza' || n.endsWith(' mendoza')
}

function isMendozaQuery(query) {
  const n = normalizeGeoName(query)
  return n === 'mendoza' || n === 'provincia de mendoza'
}

function isMendozaGeocode(item) {
  if (!item || item.kind !== 'geocode') return false
  if (isMendozaName(item.name)) return true
  const display = normalizeGeoName(item.displayName || '')
  const type = normalizeGeoName(item.placeType || '')
  return display.includes('mendoza') && (type.includes('administrative') || display.startsWith('mendoza,'))
}

function geoMatches(a, b) {
  if (!a || !b) return false
  return normalizeGeoName(a) === normalizeGeoName(b)
}

const CHOROPLETH_COLORS = ['#fbcfe8', '#c7d2fe', '#bfdbfe', '#bbf7d0', '#fde68a', '#fdba74', '#a7f3d0', '#ddd6fe', '#fecaca', '#bae6fd']

function hashToIndex(str) {
  let h = 0
  for (let i = 0; i < str.length; i += 1) {
    h = (h * 31 + str.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

function polygonStyle(feature, alpha = 0.42) {
  const name = feature.properties?.nombre ?? ''
  const fill = CHOROPLETH_COLORS[hashToIndex(name) % CHOROPLETH_COLORS.length]
  return {
    fillColor: fill,
    fillOpacity: alpha,
    color: '#111827',
    weight: 1.6,
    opacity: 0.95,
  }
}

function ringCentroid(ring) {
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
  if (Math.abs(area2) < 1e-9) return null
  return {
    center: [cx / (3 * area2), cy / (3 * area2)],
    area: Math.abs(area2) / 2,
  }
}

function featureLabelLatLng(feature) {
  const geometry = feature?.geometry
  if (!geometry) return null
  if (geometry.type === 'Point') {
    const [lng, lat] = geometry.coordinates || []
    if (lat == null || lng == null) return null
    return [lat, lng]
  }
  if (geometry.type === 'Polygon') {
    const outerRing = geometry.coordinates?.[0]
    const c = ringCentroid(outerRing)
    if (c) return [c.center[1], c.center[0]]
  }
  if (geometry.type === 'MultiPolygon') {
    let best = null
    for (const polygon of geometry.coordinates || []) {
      const outerRing = polygon?.[0]
      const c = ringCentroid(outerRing)
      if (!c) continue
      if (!best || c.area > best.area) best = c
    }
    if (best) return [best.center[1], best.center[0]]
  }
  return null
}

function PolygonLabelsLayer({ data, level }) {
  const map = useMap()
  useEffect(() => {
    if (!data?.features?.length) return
    const group = L.layerGroup()
    const className = level === 'province' ? 'geo-label geo-label-province' : 'geo-label geo-label-department'
    for (const feature of data.features) {
      const name = feature.properties?.nombre
      if (!name) continue
      try {
        const computedCenter = featureLabelLatLng(feature)
        let center = computedCenter
        if (!center) {
          const b = L.geoJSON(feature).getBounds()
          if (!b.isValid()) continue
          center = [b.getCenter().lat, b.getCenter().lng]
        }
        const icon = L.divIcon({
          className: 'geo-label-marker',
          html: `<span class="${className}">${name}</span>`,
          iconSize: [1, 1],
          iconAnchor: [0, 0],
        })
        const marker = L.marker(center, { icon, interactive: false })
        group.addLayer(marker)
      } catch {
        /* ignore invalid geometry */
      }
    }
    map.addLayer(group)
    return () => {
      map.removeLayer(group)
    }
  }, [map, data, level])
  return null
}

const MAP_TILES = {
  default: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
  },
  department: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  },
}

function MapZoomLimits({ minZoom, maxZoom }) {
  const map = useMap()
  useEffect(() => {
    map.setMinZoom(minZoom)
    map.setMaxZoom(maxZoom)
  }, [map, minZoom, maxZoom])
  return null
}

function DepartmentLocalitiesLayer({ data }) {
  const map = useMap()
  useEffect(() => {
    if (!data?.features?.length) return
    const group = L.markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: 36,
      disableClusteringAtZoom: 14,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
    })
    const labelGroup = L.layerGroup()

    const refreshLabels = () => {
      const zoom = map.getZoom()
      const showLabels = zoom >= 13
      if (showLabels && !map.hasLayer(labelGroup)) map.addLayer(labelGroup)
      if (!showLabels && map.hasLayer(labelGroup)) map.removeLayer(labelGroup)
    }

    for (const feature of data.features) {
      if (feature.geometry?.type !== 'Point') continue
      const [lng, lat] = feature.geometry.coordinates
      const name = feature.properties?.nombre ?? ''
      const marker = L.circleMarker([lat, lng], {
        radius: 7,
        color: '#0f172a',
        weight: 2,
        fillColor: '#0ea5e9',
        fillOpacity: 0.92,
      })
      marker.bindTooltip(name, { sticky: true, direction: 'top', className: 'locality-tooltip' })
      group.addLayer(marker)

      const labelIcon = L.divIcon({
        className: 'geo-label-marker',
        html: `<span class="geo-label geo-label-locality">${name}</span>`,
        iconSize: [1, 1],
        iconAnchor: [0, 0],
      })
      const labelMarker = L.marker([lat, lng], { icon: labelIcon, interactive: false })
      labelGroup.addLayer(labelMarker)
    }

    map.addLayer(group)
    refreshLabels()
    map.on('zoomend', refreshLabels)
    return () => {
      map.off('zoomend', refreshLabels)
      map.removeLayer(group)
      map.removeLayer(labelGroup)
    }
  }, [map, data])
  return null
}

function DepartmentStreetsLayer({ data }) {
  const map = useMap()
  useEffect(() => {
    if (!data?.features?.length) return
    const group = L.layerGroup()

    const refresh = () => {
      const zoom = map.getZoom()
      if (zoom >= 14 && !map.hasLayer(group)) map.addLayer(group)
      if (zoom < 14 && map.hasLayer(group)) map.removeLayer(group)
    }

    for (const feature of data.features) {
      if (feature.geometry?.type !== 'Point') continue
      const [lng, lat] = feature.geometry.coordinates
      const name = feature.properties?.nombre ?? ''
      if (!name) continue
      const icon = L.divIcon({
        className: 'geo-label-marker',
        html: `<span class="geo-label geo-label-street">${name}</span>`,
        iconSize: [1, 1],
        iconAnchor: [0, 0],
      })
      const marker = L.marker([lat, lng], { icon, interactive: false })
      marker.bindTooltip(name, { sticky: true, direction: 'top', className: 'street-tooltip' })
      group.addLayer(marker)
    }

    refresh()
    map.on('zoomend', refresh)
    return () => {
      map.off('zoomend', refresh)
      map.removeLayer(group)
    }
  }, [map, data])
  return null
}

function FitBoundsGeoJson({ data, maxZoom, clampMainland = false }) {
  const map = useMap()
  useEffect(() => {
    if (!data?.features?.length) return
    try {
      const b = clampMainland ? getMainlandFitBounds(data) : L.geoJSON(data).getBounds()
      if (b?.isValid?.()) {
        map.fitBounds(b, { padding: [28, 28], maxZoom })
      }
    } catch {
      /* ignore */
    }
  }, [data, map, maxZoom, clampMainland])
  return null
}

function FlyToArea({ area }) {
  const map = useMap()
  useEffect(() => {
    const center = area ? [area.centerLat, area.centerLng] : DEFAULT_CENTER
    const zoom = area?.zoom ?? DEFAULT_ZOOM
    map.flyTo(center, zoom, { duration: 0.8 })
  }, [area, map])
  return null
}

function FlyToPoint({ point }) {
  const map = useMap()
  useEffect(() => {
    if (!point) return
    map.flyTo([point.lat, point.lng], point.zoom ?? 14, { duration: 0.85 })
  }, [point?.lat, point?.lng, point?.zoom, point?.tick, map])
  return null
}

function findBestPlaceMatch(places, query) {
  const q = query.trim().toLowerCase()
  if (!q || !places.length) return null
  return (
    places.find((p) => p.kind !== 'geocode' && p.name.toLowerCase() === q)
    || places.find((p) => p.kind !== 'geocode' && p.name.toLowerCase().startsWith(q))
    || places.find((p) => p.kind !== 'geocode' && p.name.toLowerCase().includes(q))
    || places.find((p) => p.kind !== 'geocode')
    || null
  )
}

function geocodeZoom(placeType) {
  const t = String(placeType || '').toLowerCase()
  if (t.includes('city') || t === 'administrative') return 11
  if (t.includes('town') || t.includes('village') || t.includes('suburb')) return 12
  if (t.includes('road') || t.includes('street')) return 15
  return 13
}

function isNearCoords(a, b, threshold = 0.025) {
  return Math.abs(a.lat - b.lat) < threshold && Math.abs(a.lng - b.lng) < threshold
}

function filterStreetsByQuery(streets, query) {
  const q = normalizeGeoName(query)
  if (!q) return streets
  return streets.filter((name) => normalizeGeoName(name).includes(q))
}

async function fetchStreetsFromGeorefDirect(province, department) {
  const deptRes = await fetch(
    `/georef-api/georef/api/departamentos?provincia=${encodeURIComponent(province)}&nombre=${encodeURIComponent(department)}&exacto=true&campos=id`,
  )
  if (!deptRes.ok) return []
  const deptData = await deptRes.json()
  const deptId = deptData.departamentos?.[0]?.id
  if (!deptId) return []

  const names = new Set()
  let inicio = 0
  let total = Number.POSITIVE_INFINITY
  while (inicio < total) {
    const callesRes = await fetch(
      `/georef-api/georef/api/calles?departamento=${deptId}&max=5000&inicio=${inicio}&campos=nombre`,
    )
    if (!callesRes.ok) break
    const callesData = await callesRes.json()
    const batch = callesData.calles || []
    total = Number(callesData.total ?? batch.length)
    for (const calle of batch) {
      if (calle?.nombre) names.add(String(calle.nombre).trim())
    }
    if (batch.length === 0) break
    inicio += batch.length
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'es'))
}

async function fetchEventStreets(province, department) {
  try {
    const params = new URLSearchParams({ provincia: province, departamento: department })
    const response = await fetch(`${API_URL}/geo/calles?${params.toString()}`)
    const contentType = response.headers.get('content-type') || ''
    if (response.ok && contentType.includes('application/json')) {
      const data = await response.json()
      if (Array.isArray(data)) return { streets: data, source: 'api' }
    }
  } catch {
    /* usar respaldo Georef */
  }
  try {
    const streets = await fetchStreetsFromGeorefDirect(province, department)
    if (streets.length > 0) return { streets, source: 'georef' }
  } catch {
    /* ignore */
  }
  return { streets: [], source: 'error' }
}

function EventStreetSearch({
  label,
  value,
  onChange,
  onPick,
  disabled,
  placeholder,
  streets,
  loading,
  emptyMessage,
  hint,
}) {
  const [focused, setFocused] = useState(false)
  const filtered = useMemo(() => filterStreetsByQuery(streets, value), [streets, value])
  const listToShow = value.trim() ? filtered : streets
  const showSuggestions = focused && !disabled && !loading && streets.length > 0

  return (
    <label className="event-street-field">
      {label}
      <div className="event-street-search">
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 200)}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          required
        />
        {showSuggestions ? (
          <ul className="event-street-suggestions" role="listbox" aria-label={label}>
            {listToShow.length === 0 ? (
              <li className="event-street-suggestions-empty">Sin coincidencias. Proba otra busqueda.</li>
            ) : (
              listToShow.map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    role="option"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onChange(name)
                      onPick?.(name)
                      setFocused(false)
                    }}
                  >
                    {name}
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>
      {loading ? <span className="event-streets-hint">Cargando calles del departamento...</span> : null}
      {!loading && hint ? <span className="event-streets-hint">{hint}</span> : null}
      {!loading && emptyMessage ? <span className="event-streets-hint event-streets-hint-warn">{emptyMessage}</span> : null}
      {!loading && focused && streets.length > 0 ? (
        <span className="event-streets-hint">
          {value.trim()
            ? `${filtered.length} de ${streets.length} calles`
            : `${streets.length} calles — escribi para filtrar o elegi de la lista`}
        </span>
      ) : null}
    </label>
  )
}

function EventMapMarker({ event, openPopup }) {
  const markerRef = useRef(null)
  useEffect(() => {
    if (openPopup && markerRef.current) {
      markerRef.current.openPopup()
    }
  }, [openPopup, event.id])
  if (!Number.isFinite(event.lat) || !Number.isFinite(event.lng)) return null
  return (
    <Marker ref={markerRef} position={[event.lat, event.lng]} icon={buildEventMarkerIcon()}>
      <Popup>
        <article className="popup-card event-popup">
          <img src={EVENT_SAVED_ICON} alt="" width={56} height={56} className="event-popup-icon" />
          <h4>{event.siteName}</h4>
          <p>{event.street}</p>
          <p>{event.country} / {event.province} / {event.department}</p>
        </article>
      </Popup>
    </Marker>
  )
}

async function georefDireccionResolve(provincia, departamento, direccion) {
  const line = String(direccion || '').trim()
  if (!line || !provincia || !departamento) return null
  try {
    const url = new URL('/georef-api/georef/api/direcciones', window.location.origin)
    url.searchParams.set('direccion', line)
    url.searchParams.set('provincia', provincia)
    url.searchParams.set('departamento', departamento)
    url.searchParams.set('max', '1')
    const response = await fetch(url)
    if (!response.ok) return null
    const data = await response.json()
    const ubicacion = data.direcciones?.[0]?.ubicacion
    if (ubicacion?.lat == null || ubicacion?.lon == null) return null
    return {
      lat: Number(ubicacion.lat),
      lng: Number(ubicacion.lon),
      precision: 'intersection',
    }
  } catch {
    return null
  }
}

async function resolveEventLocation(event) {
  const streets = event.street?.includes(' y ')
    ? event.street.split(/\s+y\s+/i)
    : [event.street || '']
  const calle1 = streets[0]?.trim() || ''
  const calle2 = streets[1]?.trim() || ''
  const params = new URLSearchParams({
    provincia: event.province,
    departamento: event.department,
    calle1,
    calle2,
    sitio: event.siteName || '',
  })
  try {
    const response = await fetch(`${API_URL}/geo/event-location?${params.toString()}`)
    const contentType = response.headers.get('content-type') || ''
    if (response.ok && contentType.includes('application/json')) {
      const data = await response.json()
      if (Number.isFinite(data.lat) && Number.isFinite(data.lng)) {
        return { lat: data.lat, lng: data.lng, precision: data.precision || 'address' }
      }
    }
  } catch {
    /* respaldo abajo */
  }

  const streetLine = calle1 && calle2 ? `${calle1} y ${calle2}` : calle1 || calle2
  if (streetLine) {
    const georefHit = await georefDireccionResolve(event.province, event.department, streetLine)
    if (georefHit) return georefHit
  }

  try {
    const geoQuery = `${streetLine}, ${event.department}, ${event.province}, Argentina`
    const response = await fetch(`${API_URL}/geocode?q=${encodeURIComponent(geoQuery)}`)
    const geo = await response.json()
    if (Array.isArray(geo) && geo[0]) {
      return {
        lat: Number(geo[0].lat),
        lng: Number(geo[0].lng),
        precision: 'address',
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const deptRes = await fetch(
      `${API_URL}/locations/departments?province=${encodeURIComponent(event.province)}`,
    )
    const departments = await deptRes.json()
    if (Array.isArray(departments)) {
      const match = departments.find((d) => geoMatches(d.name, event.department))
      if (match?.lat != null && match?.lng != null) {
        return { lat: Number(match.lat), lng: Number(match.lng), precision: 'department' }
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const deptRes = await fetch(
      `/georef-api/georef/api/departamentos?provincia=${encodeURIComponent(event.province)}&nombre=${encodeURIComponent(event.department)}&exacto=true&campos=centroide`,
    )
    if (deptRes.ok) {
      const data = await deptRes.json()
      const centroide = data.departamentos?.[0]?.centroide
      if (centroide?.lat != null && centroide?.lon != null) {
        return {
          lat: Number(centroide.lat),
          lng: Number(centroide.lon),
          precision: 'department',
        }
      }
    }
  } catch {
    /* ignore */
  }

  return null
}

function RouteFitBounds({ positions, enabled }) {
  const map = useMap()
  useEffect(() => {
    if (!enabled || positions.length < 2) return
    const bounds = L.latLngBounds(positions)
    map.fitBounds(bounds, { padding: [56, 56], maxZoom: 13 })
  }, [map, positions, enabled])
  return null
}

function PlaceMarker({
  place,
  icon,
  openPopup,
  isFavorite,
  isInRoute,
  routeOrder,
  routePlannerActive,
  onToggleFavorite,
  onToggleRoute,
}) {
  const markerRef = useRef(null)
  useEffect(() => {
    if (openPopup && markerRef.current) {
      markerRef.current.openPopup()
    }
  }, [openPopup, place.id])
  return (
    <Marker
      ref={markerRef}
      position={[place.lat, place.lng]}
      icon={icon}
      eventHandlers={{
        click: () => {
          if (routePlannerActive) onToggleRoute(place)
        },
      }}
    >
      <Popup>
        <article className="popup-card">
          <h4>{place.name}</h4>
          <img src={place.image} alt={place.name} />
          <p>{place.description}</p>
          <p><strong>Categoria:</strong> {place.category}</p>
          <p><strong>Ubicacion:</strong> {place.province}{place.department ? ` / ${place.department}` : ''}</p>
          <p><strong>Telefono:</strong> {place.phone}</p>
          <button type="button" className="btn-touch btn-fav" onClick={() => onToggleFavorite(place.id)}>
            {isFavorite ? '★ En favoritos' : '☆ Guardar en favoritos'}
          </button>
          <button type="button" className={`btn-touch btn-route${isInRoute ? ' btn-route--in' : ''}`} onClick={() => onToggleRoute(place)}>
            {isInRoute ? `✓ Parada ${routeOrder} del recorrido` : '+ Sumar a mi recorrido'}
          </button>
        </article>
      </Popup>
    </Marker>
  )
}

function buildEventMarkerIcon() {
  const cacheKey = 'event-saved'
  const cached = markerIconCache.get(cacheKey)
  if (cached) return cached
  const size = 44
  const icon = L.divIcon({
    className: 'event-marker',
    html: `<img src="${EVENT_SAVED_ICON}" alt="" width="${size}" height="${size}" loading="lazy" />`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
  })
  markerIconCache.set(cacheKey, icon)
  return icon
}

function buildMarkerIcon(category, highlight = false, routeOrder = null) {
  const key = normalizeCategory(category)
  const cacheKey = `${key}-${highlight ? '1' : '0'}-${routeOrder ?? 'n'}`
  const cached = markerIconCache.get(cacheKey)
  if (cached) return cached

  const size = highlight ? MARKER_ICON_HIGHLIGHT_SIZE : MARKER_ICON_SIZE
  const url = CATEGORY_ICON_URL[key] ?? CATEGORY_ICON_URL.bodegas
  const badge = routeOrder != null
    ? `<span class="route-stop-badge" aria-hidden="true">${routeOrder}</span>`
    : ''
  const icon = L.divIcon({
    className: `category-marker${highlight ? ' category-marker--highlight' : ''}${routeOrder != null ? ' category-marker--route' : ''}`,
    html: `<span class="category-marker-wrap">${badge}<img src="${url}" alt="" width="${size}" height="${size}" loading="lazy" /></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  })
  markerIconCache.set(cacheKey, icon)
  return icon
}

function App() {
  const [token, setToken] = useState('')
  const [currentUser, setCurrentUser] = useState(null)
  const [areas, setAreas] = useState([])
  const [authMode, setAuthMode] = useState('register')
  const [authError, setAuthError] = useState('')
  const [registerForm, setRegisterForm] = useState({
    name: '',
    email: '',
    password: '',
    country: 'Argentina',
    province: 'Mendoza',
    locality: 'Lujan de Cuyo',
  })
  const [loginForm, setLoginForm] = useState({ email: '', password: '' })
  const [places, setPlaces] = useState([])
  const [selectedCountry, setSelectedCountry] = useState('Argentina')
  const [selectedProvince, setSelectedProvince] = useState('')
  const [selectedDepartment, setSelectedDepartment] = useState('')
  const [mapLevel, setMapLevel] = useState('country')
  const [provincesGeoData, setProvincesGeoData] = useState(null)
  const [departmentsGeoData, setDepartmentsGeoData] = useState(null)
  const [localitiesGeoData, setLocalitiesGeoData] = useState(null)
  const [streetsGeoData, setStreetsGeoData] = useState(null)
  const [countryOptions] = useState(['Argentina'])
  const [provinceOptions, setProvinceOptions] = useState([])
  const [departmentOptions, setDepartmentOptions] = useState([])
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [searchText, setSearchText] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [searchSuggestions, setSearchSuggestions] = useState([])
  const [geocodePin, setGeocodePin] = useState(null)
  const [searchResultPlaces, setSearchResultPlaces] = useState([])
  const userMapNavigationRef = useRef(false)
  const mendozaPanelRef = useRef(null)
  const [quickSearchNational, setQuickSearchNational] = useState([])
  const [quickSearchMendoza, setQuickSearchMendoza] = useState([])
  const [mapFocus, setMapFocus] = useState(null)
  const [routePlannerActive, setRoutePlannerActive] = useState(false)
  const [routeStops, setRouteStops] = useState([])
  const [routes, setRoutes] = useState([])
  const [favoriteIds, setFavoriteIds] = useState([])
  const [routeName, setRouteName] = useState('')
  const [routeSaving, setRouteSaving] = useState(false)
  const [viewingRouteId, setViewingRouteId] = useState(null)
  const [events, setEvents] = useState(() => {
    try {
      const raw = localStorage.getItem(EVENTS_STORAGE_KEY)
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  })
  const [editingEventId, setEditingEventId] = useState('')
  const [eventJustSaved, setEventJustSaved] = useState(null)
  const [eventSaving, setEventSaving] = useState(false)
  const [eventForm, setEventForm] = useState({
    country: 'Argentina',
    province: '',
    department: '',
    siteName: '',
    street1: '',
    street2: '',
  })
  const [eventDepartmentOptions, setEventDepartmentOptions] = useState([])
  const [eventStreetOptions, setEventStreetOptions] = useState([])
  const [eventStreetsLoading, setEventStreetsLoading] = useState(false)
  const [eventStreetsError, setEventStreetsError] = useState('')
  const [eventStreet1Picked, setEventStreet1Picked] = useState(false)
  const [highlightedEventId, setHighlightedEventId] = useState(null)
  const [focusingEventId, setFocusingEventId] = useState(null)
  const [adminForm, setAdminForm] = useState({
    name: '',
    description: '',
    image: '',
    category: 'bodegas',
    phone: '',
    province: 'Mendoza',
    department: 'Lujan de Cuyo',
    areaKey: 'lujan',
    lat: '',
    lng: '',
  })
  const [editingId, setEditingId] = useState(0)

  const selectedProvinceData = useMemo(
    () => provinceOptions.find((province) => province.name === selectedProvince) ?? null,
    [provinceOptions, selectedProvince],
  )
  const selectedDepartmentData = useMemo(
    () => departmentOptions.find((department) => department.name === selectedDepartment) ?? null,
    [departmentOptions, selectedDepartment],
  )

  const selectedAreaKey = useMemo(() => {
    const normalizedProvince = selectedProvince.toLowerCase()
    const normalizedDepartment = selectedDepartment.toLowerCase()
    const provinceArea = areas.find((area) => area.level === 'province' && area.name.toLowerCase() === normalizedProvince)
    const departmentArea = areas.find(
      (area) =>
        area.level === 'department' &&
        area.parentKey === provinceArea?.key &&
        area.name.toLowerCase() === normalizedDepartment,
    )
    if (departmentArea) return departmentArea.key
    if (provinceArea) return provinceArea.key
    return 'argentina'
  }, [areas, selectedDepartment, selectedProvince])
  const selectedAreaData = useMemo(
    () => areas.find((area) => area.key === selectedAreaKey) ?? null,
    [areas, selectedAreaKey],
  )
  const mapTarget = useMemo(() => {
    if (mapLevel === 'department' && selectedDepartmentData) {
      return { centerLat: selectedDepartmentData.lat, centerLng: selectedDepartmentData.lng, zoom: 12.2 }
    }
    if (mapLevel === 'province' && selectedProvinceData) {
      return { centerLat: selectedProvinceData.lat, centerLng: selectedProvinceData.lng, zoom: 7.8 }
    }
    return selectedAreaData
  }, [mapLevel, selectedAreaData, selectedDepartmentData, selectedProvinceData])

  const selectedDeptPolygon = useMemo(() => {
    if (!departmentsGeoData?.features?.length || !selectedDepartment) return null
    const matched = departmentsGeoData.features.filter((f) => f.properties?.nombre === selectedDepartment)
    return matched.length ? { type: 'FeatureCollection', features: matched } : null
  }, [departmentsGeoData, selectedDepartment])

  const boundsData = useMemo(() => {
    if (selectedCountry !== 'Argentina') return null
    if (mapLevel === 'country' && provincesGeoData?.features?.length) return provincesGeoData
    if (mapLevel === 'province' && departmentsGeoData?.features?.length) return departmentsGeoData
    if (mapLevel === 'department') {
      if (localitiesGeoData?.features?.length) return localitiesGeoData
      if (selectedDeptPolygon?.features?.length) return selectedDeptPolygon
    }
    return null
  }, [mapLevel, provincesGeoData, departmentsGeoData, localitiesGeoData, selectedDeptPolygon, selectedCountry])

  const boundsMaxZoom = mapLevel === 'country' ? 6 : mapLevel === 'province' ? 9 : 16
  const mapMaxZoom = mapLevel === 'department' ? 18 : 14
  const mapTile = mapLevel === 'department' ? MAP_TILES.department : MAP_TILES.default

  const isSearching = debouncedSearch.trim().length > 0

  const visiblePlaces = useMemo(() => {
    if (isSearching && searchResultPlaces.length > 0) return searchResultPlaces
    if (isSearching && places.length > 0) return places
    return places
  }, [isSearching, searchResultPlaces, places])

  const searchMatch = useMemo(
    () => (isSearching ? findBestPlaceMatch(visiblePlaces, debouncedSearch) : null),
    [visiblePlaces, debouncedSearch, isSearching],
  )

  const isMendozaContext = useMemo(() => {
    if (selectedCountry !== 'Argentina') return false
    if (isMendozaQuery(debouncedSearch) || isMendozaQuery(searchText.trim())) return true
    if (geocodePin && isMendozaGeocode(geocodePin)) return true
    if (isMendozaName(selectedProvince) && mapLevel !== 'country') return true
    return false
  }, [selectedCountry, debouncedSearch, searchText, geocodePin, selectedProvince, mapLevel])

  const provinceQuickGroupsVisible = useMemo(() => {
    if (!selectedProvince) return []
    if (mapLevel === 'country' && !isMendozaContext) return []
    const cat = normalizeCategory(selectedCategory)
    const provNorm = normalizeGeoName(selectedProvince)
    const merged = new Map()
    for (const groups of [quickSearchNational, quickSearchMendoza]) {
      for (const group of groups) {
        const key = normalizeCategory(group.category)
        const bucket = merged.get(key) || { ...group, category: key, items: [] }
        const seen = new Set(bucket.items.map((item) => normalizeGeoName(item.name)))
        for (const item of group.items) {
          if (normalizeGeoName(item.province) !== provNorm) continue
          const nameKey = normalizeGeoName(item.name)
          if (seen.has(nameKey)) continue
          seen.add(nameKey)
          bucket.items.push(item)
        }
        merged.set(key, bucket)
      }
    }
    return [...merged.values()]
      .filter((group) => selectedCategory === 'all' || normalizeCategory(group.category) === cat)
      .filter((group) => group.items.length > 0)
  }, [selectedProvince, mapLevel, isMendozaContext, quickSearchMendoza, quickSearchNational, selectedCategory])

  const highlightedId = searchMatch?.id ?? visiblePlaces[0]?.id

  const routeStopOrder = useMemo(() => {
    const map = new Map()
    routeStops.forEach((stop, index) => map.set(stop.id, index + 1))
    return map
  }, [routeStops])

  const routePositions = useMemo(
    () => routeStops.map((stop) => [stop.lat, stop.lng]),
    [routeStops],
  )

  const routeTotalKm = useMemo(() => routeDistanceKm(routeStops), [routeStops])

  const fetchPlaces = useCallback(async () => {
    const query = debouncedSearch.trim()
    const params = new URLSearchParams({
      category: selectedCategory,
      country: selectedCountry,
    })
    if (query) {
      params.set('q', query)
    } else if (mapLevel === 'country') {
      params.set('areaKey', 'argentina')
    } else if (selectedProvince) {
      params.set('scope', 'province')
      params.set('province', selectedProvince)
    }
    const response = await fetch(`${API_URL}/places?${params.toString()}`)
    const data = await response.json()
    setPlaces(data)
    if (query) setSearchResultPlaces(data)
    else setSearchResultPlaces([])
  }, [debouncedSearch, mapLevel, selectedAreaKey, selectedCategory, selectedCountry, selectedDepartment, selectedProvince])

  const releaseMapFocusForNavigation = useCallback(() => {
    userMapNavigationRef.current = true
    setMapFocus(null)
  }, [])

  const applyCategoryFilter = useCallback((key) => {
    const normalized = key === 'all' ? 'all' : normalizeCategory(key)
    setSelectedCategory(normalized)
    if (normalized === 'all') {
      setSearchText('')
      setDebouncedSearch('')
      setSearchResultPlaces([])
      setGeocodePin(null)
      setSearchFocused(false)
      userMapNavigationRef.current = true
    }
  }, [])

  const applyMendozaContext = useCallback(() => {
    const mendozaName = provinceOptions.find((p) => isMendozaName(p.name))?.name || 'Mendoza'
    userMapNavigationRef.current = true
    setGeocodePin(null)
    setSearchText('Mendoza')
    setDebouncedSearch('')
    setSearchResultPlaces([])
    setMapFocus(null)
    setSelectedProvince(mendozaName)
    setSelectedDepartment('')
    setMapLevel('province')
  }, [provinceOptions])

  const focusOnPlace = useCallback((place, { syncCategory = false } = {}) => {
    if (!place) return
    setGeocodePin(null)
    if (syncCategory) setSelectedCategory(normalizeCategory(place.category))
    setSelectedProvince(place.province)
    setSelectedDepartment(place.department || '')
    setMapLevel(place.department ? 'department' : 'province')
    setMapFocus({
      lat: place.lat,
      lng: place.lng,
      zoom: 14,
      tick: Date.now(),
    })
  }, [])

  const selectSearchResult = useCallback((item) => {
    if (!item) return
    setSearchFocused(false)
    if (isMendozaGeocode(item)) {
      applyMendozaContext()
      return
    }
    if (item.kind === 'geocode') {
      setSearchText(item.displayName || item.name)
      setDebouncedSearch('')
      setGeocodePin(item)
      setMapFocus({
        lat: item.lat,
        lng: item.lng,
        zoom: geocodeZoom(item.placeType),
        tick: Date.now(),
      })
      return
    }
    setSearchText(item.name)
    setDebouncedSearch(item.name)
    focusOnPlace(item)
  }, [applyMendozaContext, focusOnPlace])

  const fetchAreas = useCallback(async () => {
    const response = await fetch(`${API_URL}/areas`)
    const data = await response.json()
    setAreas(data)
  }, [])

  useEffect(() => {
    const fetchProvinces = async () => {
      const response = await fetch(`${API_URL}/locations/provinces?country=${encodeURIComponent(selectedCountry)}`)
      const data = await response.json()
      setProvinceOptions(Array.isArray(data) ? data : [])
    }
    fetchProvinces()
  }, [selectedCountry])

  useEffect(() => {
    setSelectedProvince('')
    setSelectedDepartment('')
    setDepartmentOptions([])
    setMapLevel('country')
  }, [selectedCountry])

  useEffect(() => {
    if (provinceOptions.length === 0) {
      setSelectedProvince('')
      return
    }
    if (!selectedProvince) {
      setSelectedProvince(provinceOptions[0].name)
    }
  }, [provinceOptions, selectedProvince])

  useEffect(() => {
    const fetchDepartments = async () => {
      if (!selectedProvince) {
        setDepartmentOptions([])
        return
      }
      const response = await fetch(`${API_URL}/locations/departments?province=${encodeURIComponent(selectedProvince)}`)
      const data = await response.json()
      setDepartmentOptions(Array.isArray(data) ? data : [])
    }
    fetchDepartments()
  }, [selectedProvince])

  useEffect(() => {
    if (selectedCountry !== 'Argentina') {
      setProvincesGeoData(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const response = await fetch(`${API_URL}/geo/provincias`)
        const data = await response.json()
        if (!cancelled) setProvincesGeoData(filterAntarcticaFromGeoJson(data))
      } catch {
        if (!cancelled) setProvincesGeoData(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedCountry])

  useEffect(() => {
    if (mapLevel === 'country') {
      setDepartmentsGeoData(null)
      setLocalitiesGeoData(null)
    }
  }, [mapLevel])

  useEffect(() => {
    if (mapLevel === 'province') {
      setLocalitiesGeoData(null)
    }
  }, [mapLevel])

  useEffect(() => {
    if (!selectedProvince || selectedCountry !== 'Argentina') {
      setDepartmentsGeoData(null)
      return
    }
    if (mapLevel !== 'province' && mapLevel !== 'department') {
      setDepartmentsGeoData(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const response = await fetch(`${API_URL}/geo/departamentos?provincia=${encodeURIComponent(selectedProvince)}`)
        const data = await response.json()
        if (!cancelled) setDepartmentsGeoData(data)
      } catch {
        if (!cancelled) setDepartmentsGeoData(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedProvince, selectedCountry, mapLevel])

  useEffect(() => {
    if (mapLevel !== 'department' || !selectedProvince || !selectedDepartment) {
      setLocalitiesGeoData(null)
      setStreetsGeoData(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const locParams = new URLSearchParams({
          provincia: selectedProvince,
          departamento: selectedDepartment,
          max: '2500',
        })
        const callesParams = new URLSearchParams({
          provincia: selectedProvince,
          departamento: selectedDepartment,
          max: '140',
        })
        const [locRes, callesRes] = await Promise.all([
          fetch(`${API_URL}/geo/localidades?${locParams.toString()}`),
          fetch(`${API_URL}/geo/calles-puntos?${callesParams.toString()}`),
        ])
        const locData = locRes.ok ? await locRes.json() : null
        const callesData = callesRes.ok ? await callesRes.json() : null
        if (!cancelled) {
          setLocalitiesGeoData(locData?.features?.length ? locData : null)
          setStreetsGeoData(callesData?.features?.length ? callesData : null)
        }
      } catch {
        if (!cancelled) {
          setLocalitiesGeoData(null)
          setStreetsGeoData(null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [mapLevel, selectedProvince, selectedDepartment])

  const fetchFavorites = useCallback(async () => {
    if (!token) return
    const response = await fetch(`${API_URL}/favorites`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await response.json()
    setFavoriteIds(data)
  }, [token])

  const fetchRoutes = useCallback(async () => {
    if (!token) return
    const response = await fetch(`${API_URL}/routes`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await response.json()
    setRoutes(data)
  }, [token])

  useEffect(() => {
    fetchAreas()
  }, [fetchAreas])

  useEffect(() => {
    const loadQuickSearch = async () => {
      try {
        const response = await fetch(`${API_URL}/quick-search`)
        const data = await response.json()
        if (data?.national) {
          setQuickSearchNational(Array.isArray(data.national) ? data.national : [])
          setQuickSearchMendoza(Array.isArray(data.mendoza) ? data.mendoza : [])
        } else {
          setQuickSearchNational(Array.isArray(data) ? data : [])
          setQuickSearchMendoza([])
        }
      } catch {
        setQuickSearchNational([])
        setQuickSearchMendoza([])
      }
    }
    loadQuickSearch()
  }, [])

  const applyQuickSearch = useCallback((item) => {
    setSearchText(item.name)
    setDebouncedSearch(item.name)
    setSearchFocused(false)
    focusOnPlace(
      {
        id: item.id,
        name: item.name,
        category: item.category,
        province: item.province,
        department: item.department,
        lat: item.lat,
        lng: item.lng,
      },
      { syncCategory: true },
    )
  }, [focusOnPlace])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchText), 350)
    return () => clearTimeout(timer)
  }, [searchText])

  useEffect(() => {
    userMapNavigationRef.current = false
  }, [debouncedSearch])

  useEffect(() => {
    if (!isMendozaQuery(debouncedSearch)) return
    applyMendozaContext()
  }, [debouncedSearch, applyMendozaContext])

  useEffect(() => {
    if (!isMendozaContext) return
    mendozaPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [isMendozaContext])

  useEffect(() => {
    const query = searchText.trim()
    if (query.length < 2) {
      setSearchSuggestions([])
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          q: query,
          category: selectedCategory,
          country: selectedCountry,
        })
        const [placesRes, geoRes] = await Promise.all([
          fetch(`${API_URL}/places?${params.toString()}`),
          fetch(`${API_URL}/geocode?q=${encodeURIComponent(query)}`),
        ])
        const placesData = await placesRes.json()
        const geoData = await geoRes.json()
        const places = Array.isArray(placesData) ? placesData.slice(0, 6) : []
        const geo = Array.isArray(geoData)
          ? geoData.filter((g) => !places.some((p) => isNearCoords(p, g))).slice(0, 4)
          : []
        if (!cancelled) setSearchSuggestions([...places, ...geo])
      } catch {
        if (!cancelled) setSearchSuggestions([])
      }
    }, 220)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [searchText, selectedCategory, selectedCountry])

  useEffect(() => {
    fetchPlaces()
  }, [fetchPlaces])

  useEffect(() => {
    if (!debouncedSearch.trim() || !searchMatch) return
    if (userMapNavigationRef.current) return
    focusOnPlace(searchMatch)
  }, [debouncedSearch, searchMatch?.id, focusOnPlace])

  useEffect(() => {
    fetchFavorites()
    fetchRoutes()
  }, [fetchFavorites, fetchRoutes])

  useEffect(() => {
    try {
      localStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(events))
    } catch {
      /* ignore quota errors */
    }
  }, [events])

  useEffect(() => {
    setEventForm((prev) => ({
      ...prev,
      country: selectedCountry || prev.country || 'Argentina',
      province: selectedProvince || prev.province,
      department: selectedDepartment || '',
    }))
  }, [selectedCountry, selectedProvince, selectedDepartment])

  useEffect(() => {
    const province = eventForm.province.trim()
    if (!province) {
      setEventDepartmentOptions([])
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const response = await fetch(
          `${API_URL}/locations/departments?province=${encodeURIComponent(province)}`,
        )
        const data = await response.json()
        if (!cancelled) setEventDepartmentOptions(Array.isArray(data) ? data : [])
      } catch {
        if (!cancelled) setEventDepartmentOptions([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [eventForm.province])

  useEffect(() => {
    const province = eventForm.province.trim()
    const department = eventForm.department.trim()
    if (!province || !department) {
      setEventStreetOptions([])
      setEventStreetsLoading(false)
      setEventStreetsError('')
      setEventStreet1Picked(false)
      return
    }
    let cancelled = false
    setEventStreetsLoading(true)
    setEventStreetsError('')
    setEventStreet1Picked(false)
    ;(async () => {
      const result = await fetchEventStreets(province, department)
      if (cancelled) return
      if (result.streets.length > 0) {
        setEventStreetOptions(result.streets)
        setEventStreetsError('')
      } else {
        setEventStreetOptions([])
        setEventStreetsError(
          'No hay calles para este departamento. Reinicia el servidor: npm run dev',
        )
      }
      setEventStreetsLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [eventForm.province, eventForm.department])

  const eventStreetsForCalle2 = useMemo(() => {
    if (!eventStreet1Picked || !eventForm.street1.trim()) return []
    return eventStreetOptions.filter((name) => !geoMatches(name, eventForm.street1))
  }, [eventStreetOptions, eventForm.street1, eventStreet1Picked])

  const eventsOnMap = useMemo(
    () => events.filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng)),
    [events],
  )

  useEffect(() => {
    const needsFix = events.filter(
      (item) => !Number.isFinite(item.lat) || item.locationPrecision === 'department',
    )
    if (!needsFix.length) return

    let cancelled = false
    ;(async () => {
      const updates = new Map()
      for (const item of needsFix) {
        if (cancelled) break
        const loc = await resolveEventLocation(item)
        if (!loc) continue
        if (
          Number.isFinite(item.lat)
          && item.locationPrecision === 'department'
          && loc.precision === 'department'
        ) {
          continue
        }
        updates.set(item.id, {
          lat: loc.lat,
          lng: loc.lng,
          locationPrecision: loc.precision,
        })
      }
      if (cancelled || updates.size === 0) return
      setEvents((prev) => prev.map((e) => {
        const patch = updates.get(e.id)
        return patch ? { ...e, ...patch } : e
      }))
    })()

    return () => {
      cancelled = true
    }
  }, [events])

  const handleRegister = async (event) => {
    event.preventDefault()
    try {
      const response = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(registerForm),
      })
      const data = await response.json()
      if (!response.ok) {
        setAuthError(data.error ?? 'No se pudo registrar')
        return
      }
      setToken(data.token)
      setCurrentUser(data.user)
      localStorage.setItem('wt_token', data.token)
      localStorage.setItem('wt_user', JSON.stringify(data.user))
      setAuthError('')
    } catch {
      setAuthError('No se pudo conectar con el servidor. Verifica que npm run dev este activo.')
    }
  }

  const handleLogin = async (event) => {
    event.preventDefault()
    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm),
      })
      const data = await response.json()
      if (!response.ok) {
        setAuthError(data.error ?? 'Credenciales incorrectas')
        return
      }
      setToken(data.token)
      setCurrentUser(data.user)
      localStorage.setItem('wt_token', data.token)
      localStorage.setItem('wt_user', JSON.stringify(data.user))
      setAuthError('')
    } catch {
      setAuthError('No se pudo conectar con el servidor. Verifica que npm run dev este activo.')
    }
  }

  const toggleFavorite = async (placeId) => {
    const response = await fetch(`${API_URL}/favorites/${placeId}/toggle`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await response.json()
    setFavoriteIds(data)
  }

  const toggleRoutePlace = useCallback((place) => {
    setRouteStops((prev) => {
      const exists = prev.some((stop) => stop.id === place.id)
      if (exists) return prev.filter((stop) => stop.id !== place.id)
      return [...prev, toRouteStop(place)]
    })
    setViewingRouteId(null)
    setRoutePlannerActive(true)
  }, [])

  const removeRouteStop = useCallback((placeId) => {
    setRouteStops((prev) => prev.filter((stop) => stop.id !== placeId))
    setViewingRouteId(null)
  }, [])

  const moveRouteStop = useCallback((index, direction) => {
    setRouteStops((prev) => {
      const next = [...prev]
      const target = index + direction
      if (target < 0 || target >= next.length) return prev
      const tmp = next[index]
      next[index] = next[target]
      next[target] = tmp
      return next
    })
    setViewingRouteId(null)
  }, [])

  const clearRoute = useCallback(() => {
    setRouteStops([])
    setRouteName('')
    setViewingRouteId(null)
  }, [])

  const resolvePlacesByIds = useCallback(async (placeIds) => {
    const fromMemory = placeIds
      .map((id) => places.find((p) => p.id === id))
      .filter(Boolean)
    const missing = placeIds.filter((id) => !fromMemory.some((p) => p.id === id))
    if (missing.length === 0) {
      return placeIds.map((id) => fromMemory.find((p) => p.id === id)).filter(Boolean)
    }
    try {
      const response = await fetch(`${API_URL}/places/by-ids?ids=${missing.join(',')}`)
      const extra = await response.json()
      const merged = [...fromMemory, ...(Array.isArray(extra) ? extra : [])]
      return placeIds.map((id) => merged.find((p) => p.id === id)).filter(Boolean)
    } catch {
      return placeIds.map((id) => fromMemory.find((p) => p.id === id)).filter(Boolean)
    }
  }, [places])

  const loadRouteToPlanner = useCallback(async (route) => {
    const resolved = await resolvePlacesByIds(route.placeIds)
    setRouteStops(resolved.map(toRouteStop))
    setRouteName(route.name)
    setRoutePlannerActive(true)
    setViewingRouteId(route.id)
    userMapNavigationRef.current = true
  }, [resolvePlacesByIds])

  const saveRoute = async () => {
    if (routeStops.length < 2 || !routeName.trim() || !token) return
    setRouteSaving(true)
    try {
      const response = await fetch(`${API_URL}/routes`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: routeName.trim(), placeIds: routeStops.map((s) => s.id) }),
      })
      if (!response.ok) return
      const data = await response.json()
      setRoutes(data)
      setViewingRouteId(data[0]?.id ?? null)
    } finally {
      setRouteSaving(false)
    }
  }

  const deleteRoute = async (routeId) => {
    if (!token) return
    const response = await fetch(`${API_URL}/routes/${routeId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) return
    const data = await response.json()
    setRoutes(data)
    if (viewingRouteId === routeId) {
      clearRoute()
    }
  }

  const formatEventStreets = (street1, street2) => {
    const a = String(street1 || '').trim()
    const b = String(street2 || '').trim()
    if (a && b) return `${a} y ${b}`
    return a || b
  }

  const parseEventStreets = (street) => {
    const raw = String(street || '').trim()
    if (!raw) return { street1: '', street2: '' }
    const parts = raw.split(/\s+y\s+/i)
    if (parts.length >= 2) {
      return { street1: parts[0].trim(), street2: parts.slice(1).join(' y ').trim() }
    }
    return { street1: raw, street2: '' }
  }

  const saveEvent = async (submitEvent) => {
    submitEvent.preventDefault()
    const country = eventForm.country.trim() || selectedCountry || 'Argentina'
    const province = eventForm.province.trim()
    const department = eventForm.department.trim()
    const siteName = eventForm.siteName.trim()
    const street1 = eventForm.street1.trim()
    const street2 = eventForm.street2.trim()
    const street = formatEventStreets(street1, street2)
    const street1Valid = eventStreetOptions.some((name) => geoMatches(name, street1))
    if (!province || !department || !siteName || !street1 || !street2 || !street1Valid) return
    if (geoMatches(street1, street2)) return

    setEventSaving(true)
    const draft = {
      id: editingEventId || crypto.randomUUID(),
      country,
      province,
      department,
      siteName,
      street,
    }
    const location = await resolveEventLocation(draft)
    const lat = location?.lat
    const lng = location?.lng

    const id = draft.id
    const saved = {
      ...draft,
      lat: Number.isFinite(lat) ? lat : undefined,
      lng: Number.isFinite(lng) ? lng : undefined,
      locationPrecision: location?.precision,
      savedAt: Date.now(),
    }

    if (editingEventId) {
      setEvents((prev) => prev.map((item) => (item.id === editingEventId ? saved : item)))
      setEditingEventId('')
    } else {
      setEvents((prev) => [...prev, saved])
    }

    setEventJustSaved(saved)
    setHighlightedEventId(saved.id)
    setEventSaving(false)
    setEventForm({
      country: selectedCountry || country,
      province: selectedProvince || province,
      department: selectedDepartment || department,
      siteName: '',
      street1: '',
      street2: '',
    })

    if (Number.isFinite(saved.lat) && Number.isFinite(saved.lng)) {
      setGeocodePin(null)
      setSelectedProvince(province)
      setSelectedDepartment(department)
      setMapLevel('department')
      setMapFocus({ lat: saved.lat, lng: saved.lng, zoom: saved.locationPrecision === 'department' ? 12 : 17, tick: Date.now() })
    } else {
      setSelectedProvince(province)
      setSelectedDepartment(department)
      setMapLevel('department')
    }
  }

  const focusEventOnMap = useCallback(async (eventItem) => {
    setFocusingEventId(eventItem.id)
    let lat = eventItem.lat
    let lng = eventItem.lng
    let precision = eventItem.locationPrecision

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || precision === 'department') {
      const loc = await resolveEventLocation(eventItem)
      if (!loc) {
        setFocusingEventId(null)
        return
      }
      lat = loc.lat
      lng = loc.lng
      precision = loc.precision
      setEvents((prev) => prev.map((e) => (
        e.id === eventItem.id
          ? { ...e, lat, lng, locationPrecision: precision }
          : e
      )))
    }

    setHighlightedEventId(eventItem.id)
    setGeocodePin(null)
    setSelectedProvince(eventItem.province)
    setSelectedDepartment(eventItem.department)
    setMapLevel('department')
    setMapFocus({
      lat,
      lng,
      zoom: precision === 'department' ? 12 : precision === 'intersection' ? 17 : 16,
      tick: Date.now(),
    })
    setFocusingEventId(null)
  }, [])

  const editEvent = (eventItem) => {
    setEventJustSaved(null)
    setHighlightedEventId(null)
    setEditingEventId(eventItem.id)
    const streets = parseEventStreets(eventItem.street)
    setEventForm({
      country: eventItem.country,
      province: eventItem.province,
      department: eventItem.department,
      siteName: eventItem.siteName,
      street1: streets.street1,
      street2: streets.street2,
    })
    setEventStreet1Picked(Boolean(streets.street1))
  }

  const deleteEvent = (eventId) => {
    setEvents((prev) => prev.filter((item) => item.id !== eventId))
    if (editingEventId === eventId) {
      setEditingEventId('')
    }
    if (eventJustSaved?.id === eventId) {
      setEventJustSaved(null)
    }
  }

  const onAdminSubmit = async (event) => {
    event.preventDefault()
    const payload = {
      ...adminForm,
      lat: Number(adminForm.lat),
      lng: Number(adminForm.lng),
    }
    if (!payload.name || Number.isNaN(payload.lat) || Number.isNaN(payload.lng) || !payload.areaKey) return
    const endpoint = editingId ? `${API_URL}/admin/places/${editingId}` : `${API_URL}/admin/places`
    const method = editingId ? 'PUT' : 'POST'
    const response = await fetch(endpoint, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const data = await response.json()
    setPlaces(data)
    setEditingId(0)
    setAdminForm({
      name: '',
      description: '',
      image: '',
      category: 'bodegas',
      phone: '',
      province: 'Mendoza',
      department: 'Lujan de Cuyo',
      areaKey: 'lujan',
      lat: '',
      lng: '',
    })
  }

  return (
    <main className="layout">
      <header className="app-header">
        <img src="/wayturismo-logo.png" alt="WayTurismo" className="app-logo" width={220} height={88} />
        <p className="app-tagline">Mapa fácil para explorar lugares, filtrar por tipo y armar tu recorrido paso a paso.</p>
      </header>

      {!currentUser ? (
        <section className="auth-shell">
          <aside className="auth-visual panel">
            <img src="/wayturismo-logo.png" alt="WayTurismo" className="auth-logo" width={200} height={80} />
            <h2>{authMode === 'register' ? 'SIGN UP' : 'LOGIN'}</h2>
            <p>{authMode === 'register' ? 'Crea tu cuenta para guardar favoritos y planificar recorridos.' : 'Inicia sesion para continuar con tu experiencia turistica.'}</p>
            <ul>
              <li>Mapa interactivo por niveles</li>
              <li>Busqueda y filtros por categorias</li>
              <li>Favoritos y rutas personalizadas</li>
            </ul>
          </aside>

          <div className="panel auth-panel">
            <div className="auth-header">
              <h2>{authMode === 'register' ? 'Crear cuenta' : 'Bienvenido de nuevo'}</h2>
              <p>{authMode === 'register' ? 'Registrate en menos de un minuto.' : 'Ingresa tus credenciales para continuar.'}</p>
            </div>
            <div className="tabs auth-tabs">
              <button type="button" className={authMode === 'register' ? 'active' : ''} onClick={() => setAuthMode('register')}>Registro</button>
              <button type="button" className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')}>Login</button>
            </div>
            {authMode === 'register' ? (
              <form onSubmit={handleRegister} className="form-grid auth-form">
                <label>
                  Nombre
                  <input className="auth-input" placeholder="Ej: Ana Perez" value={registerForm.name} onChange={(e) => setRegisterForm((p) => ({ ...p, name: e.target.value }))} />
                </label>
                <label>
                  Email
                  <input className="auth-input" placeholder="ana@email.com" type="email" value={registerForm.email} onChange={(e) => setRegisterForm((p) => ({ ...p, email: e.target.value }))} />
                </label>
                <label>
                  Contrasena
                  <input className="auth-input" placeholder="Minimo 6 caracteres" type="password" value={registerForm.password} onChange={(e) => setRegisterForm((p) => ({ ...p, password: e.target.value }))} />
                </label>
                <label>
                  Pais
                  <input className="auth-input" placeholder="Argentina" value={registerForm.country} onChange={(e) => setRegisterForm((p) => ({ ...p, country: e.target.value }))} />
                </label>
                <label>
                  Provincia
                  <input className="auth-input" placeholder="Mendoza" value={registerForm.province} onChange={(e) => setRegisterForm((p) => ({ ...p, province: e.target.value }))} />
                </label>
                <label>
                  Localidad
                  <input className="auth-input" placeholder="Lujan de Cuyo" value={registerForm.locality} onChange={(e) => setRegisterForm((p) => ({ ...p, locality: e.target.value }))} />
                </label>
                <button className="auth-submit" type="submit">Crear cuenta</button>
              </form>
            ) : (
              <form onSubmit={handleLogin} className="form-grid auth-form auth-login-form">
                <label>
                  Email
                  <input className="auth-input" placeholder="ana@email.com" type="email" value={loginForm.email} onChange={(e) => setLoginForm((p) => ({ ...p, email: e.target.value }))} />
                </label>
                <label>
                  Contrasena
                  <input className="auth-input" placeholder="Tu contrasena" type="password" value={loginForm.password} onChange={(e) => setLoginForm((p) => ({ ...p, password: e.target.value }))} />
                </label>
                <button className="auth-submit" type="submit">Iniciar sesion</button>
              </form>
            )}
            {authError ? <p className="error">{authError}</p> : null}
          </div>
        </section>
      ) : (
        <section className="app-grid">
          <aside className="panel controls sidebar">
            <div className="sidebar-user-bar">
              <div className="sidebar-user-avatar" aria-hidden>{currentUser.name.charAt(0).toUpperCase()}</div>
              <div className="sidebar-user-meta">
                <strong>{currentUser.name}</strong>
                <span>{currentUser.role === 'admin' ? 'Administrador' : 'Turista'}</span>
              </div>
              <button
                type="button"
                className="btn-sidebar-logout"
                onClick={() => {
                  localStorage.removeItem('wt_token')
                  localStorage.removeItem('wt_user')
                  setToken('')
                  setCurrentUser(null)
                }}
              >
                Salir
              </button>
            </div>

            <div className="app-quick-guide" role="region" aria-label="Guía rápida">
              <p><span className="guide-step">1</span> Buscá o elegí provincia</p>
              <p><span className="guide-step">2</span> Tocá un tipo de lugar</p>
              <p><span className="guide-step">3</span> Armá tu recorrido en el mapa</p>
            </div>

            <div className="sidebar-scroll">
            <section className="sidebar-section">
              <h2 className="sidebar-section-title"><span className="section-icon" aria-hidden>🔍</span> Buscar lugar</h2>
            <label className="filter-field search-field">
              <span className="sr-only">Buscar en toda Argentina</span>
              <div className="search-box">
                <input
                  type="text"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setTimeout(() => setSearchFocused(false), 180)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    const q = searchText.trim()
                    if (q.length < 2) return
                    if (isMendozaQuery(q)) {
                      applyMendozaContext()
                      return
                    }
                    const mendozaSuggestion = searchSuggestions.find((s) => isMendozaGeocode(s))
                    if (mendozaSuggestion) {
                      selectSearchResult(mendozaSuggestion)
                      return
                    }
                    const best = findBestPlaceMatch(searchSuggestions, q)
                      || searchSuggestions[0]
                      || searchMatch
                    if (best) {
                      selectSearchResult(best)
                      return
                    }
                    setDebouncedSearch(q)
                    setSearchFocused(false)
                  }}
                  placeholder="Escribí el nombre del lugar..."
                  autoComplete="off"
                />
                {searchText ? (
                  <button
                    type="button"
                    className="search-clear"
                    aria-label="Limpiar busqueda"
                    onClick={() => {
                      setSearchText('')
                      setDebouncedSearch('')
                      setSearchResultPlaces([])
                      setGeocodePin(null)
                      setMapFocus(null)
                      userMapNavigationRef.current = false
                    }}
                  >
                    ×
                  </button>
                ) : null}
                {searchFocused && searchText.trim().length >= 2 && searchSuggestions.length > 0 ? (
                  <ul className="search-suggestions" role="listbox">
                    {searchSuggestions.map((place) => (
                      <li key={place.id}>
                        <button
                          type="button"
                          role="option"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => selectSearchResult(place)}
                        >
                          {place.kind === 'geocode' ? (
                            <span className="search-suggestion-pin" aria-hidden>📍</span>
                          ) : (
                            <img src={CATEGORY_ICON_URL[normalizeCategory(place.category)]} alt="" width={22} height={22} />
                          )}
                          <span>
                            <strong>{place.name}</strong>
                            <small>
                              {place.kind === 'geocode'
                                ? place.displayName
                                : `${place.province}${place.department ? ` · ${place.department}` : ''}`}
                            </small>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              {isSearching && searchMatch ? (
                <span className="filter-hint">
                  Mostrando: {searchMatch.name} ({searchMatch.province}) — {visiblePlaces.length} en el mapa al navegar
                </span>
              ) : null}
              {isSearching && visiblePlaces.length === 0 && searchSuggestions.length === 0 ? (
                <span className="filter-hint filter-hint-warn">Sin resultados. Prueba otro nombre o ciudad.</span>
              ) : null}
              {!isSearching && searchText.trim().length >= 2 && searchSuggestions.length > 0 ? (
                <span className="filter-hint">Elegi una sugerencia o pulsa Enter para ir al mapa.</span>
              ) : null}
            </label>
            </section>

            <section className="sidebar-section">
              <h2 className="sidebar-section-title"><span className="section-icon" aria-hidden>🏷️</span> Tipo de lugar</h2>
              <div className="category-chips" role="group" aria-label="Filtrar categoría">
                {CATEGORY_FILTERS.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    className={`category-chip${selectedCategory === key ? ' category-chip--active' : ''}`}
                    onClick={() => applyCategoryFilter(key)}
                  >
                    {key !== 'all' ? (
                      <img src={CATEGORY_ICON_URL[key]} alt="" width={20} height={20} />
                    ) : null}
                    {label}
                  </button>
                ))}
              </div>
            </section>

            <section className="sidebar-section sidebar-section-location">
              <h2 className="sidebar-section-title"><span className="section-icon" aria-hidden>🗺️</span> Zona del mapa</h2>
              <div className="location-grid">
            <label className="filter-field filter-field-compact">
              <span>Provincia</span>
              <select
                value={selectedProvince}
                onChange={(e) => {
                  releaseMapFocusForNavigation()
                  setSelectedProvince(e.target.value)
                  setSelectedDepartment('')
                  setMapLevel('province')
                }}
              >
                {provinceOptions.map((province) => <option key={province.name} value={province.name}>{province.name}</option>)}
              </select>
            </label>

            <label className="filter-field filter-field-compact">
              <span>Departamento</span>
              <select
                value={selectedDepartment}
                onChange={(e) => {
                  releaseMapFocusForNavigation()
                  const value = e.target.value
                  setSelectedDepartment(value)
                  setMapLevel(value ? 'department' : 'province')
                }}
                disabled={!selectedProvince}
              >
                <option value="">Todos los departamentos</option>
                {departmentOptions.map((department) => <option key={department.name} value={department.name}>{department.name}</option>)}
              </select>
            </label>
              </div>
            </section>

            {provinceQuickGroupsVisible.length > 0 ? (
              <details className="sidebar-section sidebar-collapsible" open>
                <summary><span className="section-icon" aria-hidden>⭐</span> {selectedProvince} — lugares destacados</summary>
              <section ref={mendozaPanelRef} className="quick-search quick-search-province">
                <div className="quick-search-toolbar">
                  <p className="quick-search-hint">
                    Lugares destacados en {selectedProvince}.
                    {selectedCategory === 'all'
                      ? ' Elegí una categoría arriba para acotar.'
                      : ` Filtrando: ${CATEGORY_FILTERS.find((c) => c.key === selectedCategory || normalizeCategory(c.key) === normalizeCategory(selectedCategory))?.label ?? selectedCategory}.`}
                  </p>
                  {selectedCategory !== 'all' ? (
                    <button
                      type="button"
                      className="quick-search-reset"
                      onClick={() => applyCategoryFilter('all')}
                    >
                      Mostrar todas
                    </button>
                  ) : null}
                </div>
                {provinceQuickGroupsVisible.map((group) => (
                  <div key={`prov-${group.category}`} className="quick-search-group">
                    <h4>
                      <img src={group.icon} alt="" width={22} height={22} />
                      {group.label} ({group.items.length})
                    </h4>
                    <div className="quick-search-list">
                      {group.items.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="quick-search-btn"
                          onClick={() => applyQuickSearch(item)}
                        >
                          {item.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </section>
              </details>
            ) : null}

            <details className="sidebar-section sidebar-collapsible sidebar-collapsible-event" open={Boolean(editingEventId || eventJustSaved)}>
              <summary><span className="section-icon" aria-hidden>📅</span> Mis eventos en el mapa</summary>
            <section className="event-editor">
              <form onSubmit={saveEvent} className="event-form">
                <input type="hidden" name="country" value="Argentina" />
                <div className="event-form-grid">
                <label>
                  <span>Provincia</span>
                  <select
                    value={eventForm.province}
                    onChange={(e) => {
                      const value = e.target.value
                      setEventForm((prev) => ({
                        ...prev,
                        province: value,
                        department: '',
                        street1: '',
                        street2: '',
                      }))
                      setEventStreet1Picked(false)
                      setSelectedProvince(value)
                      setSelectedDepartment('')
                      setMapLevel(value ? 'province' : 'country')
                    }}
                    required
                  >
                    <option value="">Seleccionar provincia...</option>
                    {provinceOptions.map((province) => (
                      <option key={province.name} value={province.name}>{province.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Departamento</span>
                  <select
                    value={eventForm.department}
                    onChange={(e) => {
                      const value = e.target.value
                      setEventForm((prev) => ({
                        ...prev,
                        department: value,
                        street1: '',
                        street2: '',
                      }))
                      setEventStreet1Picked(false)
                      setSelectedDepartment(value)
                      setMapLevel(value ? 'department' : 'province')
                    }}
                    disabled={!eventForm.province}
                    required
                  >
                    <option value="">Seleccionar departamento...</option>
                    {eventDepartmentOptions.map((department) => (
                      <option key={department.name} value={department.name}>{department.name}</option>
                    ))}
                  </select>
                </label>
                </div>
                <label className="event-form-full">
                  <span>Nombre del sitio</span>
                  <input
                    value={eventForm.siteName}
                    onChange={(e) => setEventForm((prev) => ({ ...prev, siteName: e.target.value }))}
                    placeholder="Escribí el nombre del sitio"
                    required
                  />
                </label>
                <EventStreetSearch
                  label="Calle 1"
                  value={eventForm.street1}
                  onChange={(v) => {
                    setEventForm((prev) => ({
                      ...prev,
                      street1: v,
                      street2: eventStreet1Picked && geoMatches(prev.street1, v) ? prev.street2 : '',
                    }))
                    setEventStreet1Picked(eventStreetOptions.some((name) => geoMatches(name, v)))
                  }}
                  onPick={() => {
                    setEventStreet1Picked(true)
                    setEventForm((prev) => ({ ...prev, street2: '' }))
                  }}
                  disabled={!eventForm.department || eventStreetsLoading}
                  placeholder={
                    eventForm.department
                      ? 'Buscar y elegir calle 1 del departamento...'
                      : 'Primero elegi departamento'
                  }
                  streets={eventStreetOptions}
                  loading={eventStreetsLoading}
                  emptyMessage={eventStreetsError}
                  hint={
                    eventForm.department && !eventStreetsLoading && eventStreetOptions.length > 0
                      ? `Paso 1: elegi Calle 1 entre ${eventStreetOptions.length} calles de ${eventForm.department}`
                      : ''
                  }
                />
                <EventStreetSearch
                  label="Calle 2 (esquina)"
                  value={eventForm.street2}
                  onChange={(v) => setEventForm((prev) => ({ ...prev, street2: v }))}
                  disabled={!eventStreet1Picked || !eventForm.street1.trim()}
                  placeholder={
                    eventStreet1Picked
                      ? `Buscar calle 2 (sin ${eventForm.street1})...`
                      : 'Primero elegi Calle 1 de la lista'
                  }
                  streets={eventStreetsForCalle2}
                  loading={false}
                  hint={
                    eventStreet1Picked
                      ? `Paso 2: ${eventStreetsForCalle2.length} calles posibles para esquina con ${eventForm.street1}`
                      : ''
                  }
                />
                <button type="submit" className="btn-primary btn-block" disabled={eventSaving}>
                  {eventSaving ? 'Guardando...' : editingEventId ? 'Actualizar evento' : 'Guardar evento'}
                </button>
              </form>

              {eventJustSaved ? (
                <div className="event-saved-card" role="status" aria-live="polite">
                  <img src={EVENT_SAVED_ICON} alt="" className="event-saved-icon" width={80} height={80} />
                  <div className="event-saved-body">
                    <p className="event-saved-title">Evento guardado</p>
                    <p><strong>{eventJustSaved.siteName}</strong></p>
                    <p>{eventJustSaved.street}</p>
                    <p className="event-saved-location">
                      {eventJustSaved.country} / {eventJustSaved.province} / {eventJustSaved.department}
                    </p>
                    {Number.isFinite(eventJustSaved.lat) ? (
                      <p className="event-saved-hint">
                        Visible en el mapa con el icono de calendario
                        {eventJustSaved.locationPrecision === 'department' ? ' (zona del departamento)' : ''}.
                      </p>
                    ) : (
                      <p className="event-saved-hint">Guardado en la lista. Ubicando en el mapa...</p>
                    )}
                  </div>
                </div>
              ) : null}

              <div className="event-list">
                {events.length === 0 ? <p>Sin eventos cargados.</p> : events.map((eventItem) => (
                  <div
                    key={eventItem.id}
                    className={`event-item${eventJustSaved?.id === eventItem.id ? ' event-item--highlight' : ''}`}
                  >
                    <div className="event-item-row">
                      <img src={EVENT_SAVED_ICON} alt="" className="event-item-icon" width={48} height={48} />
                      <div>
                        <p><strong>{eventItem.siteName}</strong> — {eventItem.street}</p>
                        <p>{eventItem.country} / {eventItem.province} / {eventItem.department}</p>
                      </div>
                    </div>
                    <div className="event-item-actions">
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => focusEventOnMap(eventItem)}
                        disabled={focusingEventId === eventItem.id}
                      >
                        {focusingEventId === eventItem.id ? 'Ubicando...' : 'Ver en mapa'}
                      </button>
                      <button className="btn-ghost btn-sm" onClick={() => editEvent(eventItem)} type="button">Editar</button>
                      <button className="btn-ghost btn-sm btn-danger" onClick={() => deleteEvent(eventItem.id)} type="button">Eliminar</button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
            </details>

            <details className="sidebar-section sidebar-collapsible" open={routePlannerActive || routeStops.length > 0}>
              <summary><span className="section-icon" aria-hidden>🧭</span> Crear mi recorrido</summary>
            <div className="route-planner">
              <button
                type="button"
                className={`route-planner-mode${routePlannerActive ? ' route-planner-mode--on' : ''}`}
                onClick={() => setRoutePlannerActive((on) => !on)}
                aria-pressed={routePlannerActive}
              >
                {routePlannerActive ? '✓ Tocá lugares en el mapa para agregarlos' : '➕ Activar: elegir lugares en el mapa'}
              </button>
              <p className="route-planner-hint">
                {routePlannerActive
                  ? 'Cada toque en un marcador suma o quita una parada. Después ordená la lista y guardá.'
                  : 'Ideal para visitar varios sitios en un solo día. Necesitás al menos 2 paradas.'}
              </p>

              {routeStops.length === 0 ? (
                <p className="mini-list-empty">Sin paradas. Agregá lugares desde el mapa.</p>
              ) : (
                <ol className="route-stop-list">
                  {routeStops.map((stop, index) => (
                    <li key={stop.id} className="route-stop-item">
                      <span className="route-stop-num">{index + 1}</span>
                      <div className="route-stop-info">
                        <strong>{stop.name}</strong>
                        <small>{stop.province}{stop.department ? ` · ${stop.department}` : ''}</small>
                      </div>
                      <div className="route-stop-actions">
                        <button type="button" className="btn-ghost btn-sm" disabled={index === 0} onClick={() => moveRouteStop(index, -1)} aria-label="Mover arriba">▲</button>
                        <button type="button" className="btn-ghost btn-sm" disabled={index === routeStops.length - 1} onClick={() => moveRouteStop(index, 1)} aria-label="Mover abajo">▼</button>
                        <button type="button" className="btn-ghost btn-sm btn-danger" onClick={() => removeRouteStop(stop.id)} aria-label="Quitar parada">✕</button>
                      </div>
                    </li>
                  ))}
                </ol>
              )}

              {routeStops.length >= 2 ? (
                <p className="route-distance">
                  Distancia aproximada: <strong>{routeTotalKm.toFixed(1)} km</strong> (tramos en línea recta)
                </p>
              ) : null}

              <label className="route-name-field">
                <span>Nombre del recorrido</span>
                <input
                  value={routeName}
                  onChange={(e) => setRouteName(e.target.value)}
                  placeholder="Ej: Ruta del vino en Maipú"
                />
              </label>

              <div className="route-planner-actions">
                <button
                  type="button"
                  className="btn-primary btn-block"
                  onClick={saveRoute}
                  disabled={routeStops.length < 2 || !routeName.trim() || routeSaving}
                >
                  {routeSaving ? 'Guardando...' : 'Guardar recorrido'}
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-block"
                  onClick={clearRoute}
                  disabled={routeStops.length === 0 && !routeName.trim()}
                >
                  Limpiar
                </button>
              </div>

              <div className="saved-routes">
                <h4>Recorridos guardados</h4>
                {routes.length === 0 ? (
                  <p className="mini-list-empty">Aún no guardaste recorridos.</p>
                ) : (
                  routes.map((route) => (
                    <div key={route.id} className={`saved-route-card${viewingRouteId === route.id ? ' saved-route-card--active' : ''}`}>
                      <div>
                        <strong>{route.name}</strong>
                        <span>{route.placeIds.length} paradas</span>
                      </div>
                      <div className="saved-route-actions">
                        <button type="button" className="btn-secondary btn-sm" onClick={() => loadRouteToPlanner(route)}>Ver en mapa</button>
                        <button type="button" className="btn-ghost btn-sm btn-danger" onClick={() => deleteRoute(route.id)}>Eliminar</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            </details>

            <details className="sidebar-section sidebar-collapsible">
              <summary><span className="section-icon" aria-hidden>❤️</span> Mis favoritos</summary>
            <div className="trip-panel">

            <div className="mini-list">
              <h4>Favoritos</h4>
              {favoriteIds.length === 0 ? <p className="mini-list-empty">Sin favoritos.</p> : favoriteIds.map((id) => <p key={id}>{places.find((p) => p.id === id)?.name}</p>)}
            </div>
            </div>
            </details>
            </div>
          </aside>

          <section className="panel map-panel">
            <div className="map-level-controls">
              <span className="map-level-label">
                <span className="map-level-icon" aria-hidden>📍</span>
                {mapLevel === 'country'
                  ? 'Viendo: toda Argentina'
                  : mapLevel === 'province'
                    ? `Viendo: ${selectedProvince}`
                    : `Viendo: ${selectedDepartment}, ${selectedProvince}`}
              </span>
              {mapLevel !== 'country' ? (
                <button
                  type="button"
                  className="btn-map-back"
                  onClick={() => {
                    releaseMapFocusForNavigation()
                    setSelectedDepartment('')
                    setMapLevel('country')
                  }}
                >
                  ← Volver al mapa de Argentina
                </button>
              ) : null}
            </div>
            <div className="map-route-toolbar">
              <button
                type="button"
                className={`map-planner-toggle${routePlannerActive ? ' map-planner-toggle--on' : ''}`}
                onClick={() => setRoutePlannerActive((on) => !on)}
                aria-pressed={routePlannerActive}
              >
                <span className="map-planner-toggle-icon" aria-hidden>🧭</span>
                {routePlannerActive ? 'Creando recorrido (tocá los lugares)' : 'Crear mi recorrido turístico'}
              </button>
              {routeStops.length > 0 ? (
                <span className="map-planner-badge">{routeStops.length} parada{routeStops.length === 1 ? '' : 's'}</span>
              ) : null}
            </div>
            <MapContainer
              center={DEFAULT_CENTER}
              zoom={DEFAULT_ZOOM}
              scrollWheelZoom
              maxBounds={MAINLAND_BOUNDS}
              maxBoundsViscosity={1}
              minZoom={4}
              maxZoom={14}
              style={{ height: '600px', width: '100%' }}
            >
              <MapZoomLimits minZoom={4} maxZoom={mapMaxZoom} />
              <TileLayer attribution={mapTile.attribution} url={mapTile.url} />
              {mapFocus ? (
                <FlyToPoint point={mapFocus} />
              ) : !boundsData ? (
                <FlyToArea area={mapTarget} />
              ) : (
                <FitBoundsGeoJson data={boundsData} maxZoom={boundsMaxZoom} clampMainland={mapLevel === 'country'} />
              )}
              {selectedAreaData?.geojson && !(mapLevel === 'country' && provincesGeoData?.features?.length) ? (
                <GeoJSON data={selectedAreaData.geojson} style={{ color: '#2563eb', weight: 2, fillOpacity: 0.08 }} />
              ) : null}
              {mapLevel === 'country' && provincesGeoData?.features?.length ? (
                <GeoJSON
                  key="layer-provincias"
                  data={provincesGeoData}
                  style={(feature) => polygonStyle(feature, 0.56)}
                  onEachFeature={(feature, layer) => {
                    const name = feature.properties?.nombre ?? ''
                    layer.on({
                      click: () => {
                        releaseMapFocusForNavigation()
                        setSelectedProvince(name)
                        setSelectedDepartment('')
                        setMapLevel('province')
                        if (isMendozaName(name)) {
                          setSearchText('Mendoza')
                          setDebouncedSearch('')
                          setSearchResultPlaces([])
                          setGeocodePin(null)
                        }
                      },
                    })
                  }}
                />
              ) : null}
              {mapLevel === 'country' && provincesGeoData?.features?.length ? (
                <PolygonLabelsLayer key="labels-provincias" data={provincesGeoData} level="province" />
              ) : null}
              {(mapLevel === 'province' || mapLevel === 'department') && departmentsGeoData?.features?.length ? (
                <GeoJSON
                  key={`layer-deptos-${selectedProvince}-${mapLevel}-${selectedDepartment}`}
                  data={departmentsGeoData}
                  style={(feature) => {
                    const name = feature.properties?.nombre ?? ''
                    if (mapLevel === 'department' && selectedDepartment && name === selectedDepartment) {
                      return { ...polygonStyle(feature, 0.52), weight: 2.5, color: '#334155', fillOpacity: 0.12 }
                    }
                    if (mapLevel === 'department') {
                      return { ...polygonStyle(feature, 0.24), weight: 1, color: '#64748b', fillOpacity: 0.06 }
                    }
                    return polygonStyle(feature, 0.54)
                  }}
                  onEachFeature={(feature, layer) => {
                    const name = feature.properties?.nombre ?? ''
                    if (mapLevel === 'department') {
                      layer.bindTooltip(name, { sticky: true, direction: 'top' })
                    }
                    layer.on({
                      click: () => {
                        releaseMapFocusForNavigation()
                        setSelectedDepartment(name)
                        setMapLevel('department')
                      },
                    })
                  }}
                />
              ) : null}
              {mapLevel === 'province' && departmentsGeoData?.features?.length ? (
                <PolygonLabelsLayer key={`labels-deptos-${selectedProvince}`} data={departmentsGeoData} level="department" />
              ) : null}
              {mapLevel === 'department' && localitiesGeoData?.features?.length ? (
                <DepartmentLocalitiesLayer key={`layer-loc-${selectedProvince}-${selectedDepartment}`} data={localitiesGeoData} />
              ) : null}
              {mapLevel === 'department' && streetsGeoData?.features?.length ? (
                <DepartmentStreetsLayer key={`layer-calles-${selectedProvince}-${selectedDepartment}`} data={streetsGeoData} />
              ) : null}
              {geocodePin ? (
                <Marker position={[geocodePin.lat, geocodePin.lng]}>
                  <Popup>
                    <p><strong>{geocodePin.name}</strong></p>
                    <p>{geocodePin.displayName}</p>
                  </Popup>
                </Marker>
              ) : null}
              {eventsOnMap.map((eventItem) => (
                <EventMapMarker
                  key={`event-${eventItem.id}`}
                  event={eventItem}
                  openPopup={highlightedEventId === eventItem.id}
                />
              ))}
              {routeStops.length >= 2 ? (
                <Polyline
                  positions={routePositions}
                  pathOptions={{ color: '#0d9488', weight: 5, opacity: 0.9, lineJoin: 'round' }}
                />
              ) : null}
              <RouteFitBounds
                positions={routePositions}
                enabled={routeStops.length >= 2 && (routePlannerActive || viewingRouteId != null)}
              />
              {visiblePlaces.map((place) => {
                const order = routeStopOrder.get(place.id)
                return (
                <PlaceMarker
                  key={place.id}
                  place={place}
                  icon={buildMarkerIcon(place.category, place.id === highlightedId, order ?? null)}
                  openPopup={place.id === highlightedId && isSearching && !routePlannerActive}
                  isFavorite={favoriteIds.includes(place.id)}
                  isInRoute={order != null}
                  routeOrder={order}
                  routePlannerActive={routePlannerActive}
                  onToggleFavorite={toggleFavorite}
                  onToggleRoute={toggleRoutePlace}
                />
              )})}
            </MapContainer>
          </section>
        </section>
      )}

      {currentUser?.role === 'admin' && (
        <section className="panel admin-panel">
          <h2>Gestion de lugares (admin)</h2>
          <form onSubmit={onAdminSubmit} className="form-grid">
            <input placeholder="Nombre" value={adminForm.name} onChange={(e) => setAdminForm((p) => ({ ...p, name: e.target.value }))} />
            <input placeholder="Descripcion" value={adminForm.description} onChange={(e) => setAdminForm((p) => ({ ...p, description: e.target.value }))} />
            <input placeholder="URL imagen" value={adminForm.image} onChange={(e) => setAdminForm((p) => ({ ...p, image: e.target.value }))} />
            <select value={adminForm.category} onChange={(e) => setAdminForm((p) => ({ ...p, category: e.target.value }))}>
              <option value="bodegas">bodegas</option>
              <option value="olivicolas">olivicolas</option>
              <option value="religioso">religioso</option>
              <option value="hospitales">hospitales</option>
              <option value="hoteles">hoteles</option>
            </select>
            <input placeholder="Telefono" value={adminForm.phone} onChange={(e) => setAdminForm((p) => ({ ...p, phone: e.target.value }))} />
            <input placeholder="Provincia" value={adminForm.province} onChange={(e) => setAdminForm((p) => ({ ...p, province: e.target.value }))} />
            <input placeholder="Departamento" value={adminForm.department} onChange={(e) => setAdminForm((p) => ({ ...p, department: e.target.value }))} />
            <select value={adminForm.areaKey} onChange={(e) => setAdminForm((p) => ({ ...p, areaKey: e.target.value }))}>
              {areas.filter((x) => x.level !== 'country').map((x) => <option key={x.id} value={x.key}>{x.name}</option>)}
            </select>
            <input placeholder="Latitud" value={adminForm.lat} onChange={(e) => setAdminForm((p) => ({ ...p, lat: e.target.value }))} />
            <input placeholder="Longitud" value={adminForm.lng} onChange={(e) => setAdminForm((p) => ({ ...p, lng: e.target.value }))} />
            <button type="submit">{editingId ? 'Actualizar lugar' : 'Agregar lugar'}</button>
          </form>
          <div className="admin-list">
            {places.map((p) => (
              <div key={p.id} className="admin-row">
                <span>{p.name} ({p.province}/{p.department})</span>
                <div>
                  <button onClick={() => { setEditingId(p.id); setAdminForm({ ...p, lat: String(p.lat), lng: String(p.lng) }) }}>Editar</button>
                  <button onClick={async () => {
                    const response = await fetch(`${API_URL}/admin/places/${p.id}`, {
                      method: 'DELETE',
                      headers: { Authorization: `Bearer ${token}` },
                    })
                    const data = await response.json()
                    setPlaces(data)
                  }}>Eliminar</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  )
}

export default App
