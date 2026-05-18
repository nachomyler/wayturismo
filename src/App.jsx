/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { GeoJSON, MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import 'leaflet/dist/leaflet.css'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL || '/api'
const DEFAULT_CENTER = [-38.4161, -63.6167]
const DEFAULT_ZOOM = 4.4

const iconByCategory = {
  bodegas: '#7e3af2',
  olivicolas: '#0f9d58',
  religioso: '#2563eb',
  hospitales: '#dc2626',
  hoteles: '#f59e0b',
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

function LocalitiesClusterLayer({ data }) {
  const map = useMap()
  useEffect(() => {
    if (!data?.features?.length) return
    const group = L.markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: 52,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
    })
    for (const feature of data.features) {
      if (feature.geometry?.type !== 'Point') continue
      const [lng, lat] = feature.geometry.coordinates
      const name = feature.properties?.nombre ?? ''
      const marker = L.circleMarker([lat, lng], {
        radius: 5,
        color: '#1e293b',
        weight: 1,
        fillColor: '#38bdf8',
        fillOpacity: 0.85,
      })
      marker.bindTooltip(name, { sticky: true, direction: 'top' })
      group.addLayer(marker)
    }
    map.addLayer(group)
    return () => {
      map.removeLayer(group)
    }
  }, [map, data])
  return null
}

function FitBoundsGeoJson({ data, maxZoom }) {
  const map = useMap()
  useEffect(() => {
    if (!data?.features?.length) return
    try {
      const gj = L.geoJSON(data)
      const b = gj.getBounds()
      if (b.isValid()) {
        map.fitBounds(b, { padding: [28, 28], maxZoom })
      }
    } catch {
      /* ignore */
    }
  }, [data, map, maxZoom])
  return null
}

function FlyToArea({ area }) {
  const map = useMap()
  const center = area ? [area.centerLat, area.centerLng] : DEFAULT_CENTER
  const zoom = area?.zoom ?? DEFAULT_ZOOM
  map.flyTo(center, zoom, { duration: 0.8 })
  return null
}

function buildMarkerIcon(category, highlight = false) {
  const color = iconByCategory[category] ?? '#374151'
  return L.divIcon({
    className: 'custom-pin',
    html: `<span style="background:${color};${highlight ? 'transform:scale(1.2);box-shadow:0 0 0 4px rgba(255,255,255,0.4);' : ''}"></span>`,
  })
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
  const [countryOptions] = useState(['Argentina'])
  const [provinceOptions, setProvinceOptions] = useState([])
  const [departmentOptions, setDepartmentOptions] = useState([])
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [searchText, setSearchText] = useState('')
  const [selectedRoute, setSelectedRoute] = useState([])
  const [routes, setRoutes] = useState([])
  const [favoriteIds, setFavoriteIds] = useState([])
  const [routeName, setRouteName] = useState('')
  const [events, setEvents] = useState([])
  const [editingEventId, setEditingEventId] = useState('')
  const [eventForm, setEventForm] = useState({
    country: 'Argentina',
    province: '',
    department: '',
    siteName: '',
    street: '',
  })
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
      return { centerLat: selectedDepartmentData.lat, centerLng: selectedDepartmentData.lng, zoom: 10.8 }
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

  const boundsMaxZoom = mapLevel === 'country' ? 6 : mapLevel === 'province' ? 9 : 12

  const visiblePlaces = places

  const highlightedId = visiblePlaces[0]?.id

  const fetchPlaces = useCallback(async () => {
    const params = new URLSearchParams({
      areaKey: selectedAreaKey,
      category: selectedCategory,
      q: searchText,
      country: selectedCountry,
      province: selectedProvince,
      department: selectedDepartment,
    })
    const response = await fetch(`${API_URL}/places?${params.toString()}`)
    const data = await response.json()
    setPlaces(data)
  }, [searchText, selectedAreaKey, selectedCategory, selectedCountry, selectedDepartment, selectedProvince])

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
    if (!selectedProvince || !provinceOptions.some((province) => province.name === selectedProvince)) {
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
    setSelectedDepartment('')
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
        if (!cancelled) setProvincesGeoData(data)
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
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const response = await fetch(`${API_URL}/geo/localidades?provincia=${encodeURIComponent(selectedProvince)}&departamento=${encodeURIComponent(selectedDepartment)}`)
        const data = await response.json()
        if (!cancelled) setLocalitiesGeoData(data)
      } catch {
        if (!cancelled) setLocalitiesGeoData(null)
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
    fetchPlaces()
  }, [fetchPlaces])

  useEffect(() => {
    fetchFavorites()
    fetchRoutes()
  }, [fetchFavorites, fetchRoutes])

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

  const addToRoute = (placeId) => {
    setSelectedRoute((prev) => (prev.includes(placeId) ? prev : [...prev, placeId]))
  }

  const saveRoute = async () => {
    if (selectedRoute.length < 2 || !routeName.trim()) return
    const response = await fetch(`${API_URL}/routes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: routeName, placeIds: selectedRoute }),
    })
    const data = await response.json()
    setRoutes(data)
    setSelectedRoute([])
    setRouteName('')
  }

  const saveEvent = (event) => {
    event.preventDefault()
    if (!eventForm.province || !eventForm.department || !eventForm.siteName || !eventForm.street) return
    if (editingEventId) {
      setEvents((prev) => prev.map((item) => (item.id === editingEventId ? { ...eventForm, id: editingEventId } : item)))
      setEditingEventId('')
    } else {
      setEvents((prev) => [...prev, { ...eventForm, id: crypto.randomUUID() }])
    }
    setEventForm({
      country: selectedCountry,
      province: selectedProvince,
      department: selectedDepartment || '',
      siteName: '',
      street: '',
    })
  }

  const editEvent = (eventItem) => {
    setEditingEventId(eventItem.id)
    setEventForm({
      country: eventItem.country,
      province: eventItem.province,
      department: eventItem.department,
      siteName: eventItem.siteName,
      street: eventItem.street,
    })
  }

  const deleteEvent = (eventId) => {
    setEvents((prev) => prev.filter((item) => item.id !== eventId))
    if (editingEventId === eventId) {
      setEditingEventId('')
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
      <header>
        <h1>WayTurismo</h1>
        <p>Explora Argentina por niveles: pais, provincia y departamento.</p>
      </header>

      {!currentUser ? (
        <section className="auth-shell">
          <aside className="auth-visual panel">
            <div className="auth-avatar">WT</div>
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
          <aside className="panel controls">
            <p><strong>Usuario:</strong> {currentUser.name} ({currentUser.role})</p>
            <button onClick={() => {
              localStorage.removeItem('wt_token')
              localStorage.removeItem('wt_user')
              setToken('')
              setCurrentUser(null)
            }}>Cerrar sesion</button>

            <label className="filter-field">
              Buscar lugar especifico
              <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Ej: Catedral, Bodega, Termas..." />
            </label>

            <label className="filter-field">
              Filtrar categoria
              <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)}>
                <option value="all">Todas</option>
                <option value="bodegas">bodegas</option>
                <option value="olivicolas">olivicolas</option>
                <option value="religioso">religioso</option>
                <option value="hospitales">hospitales</option>
                <option value="hoteles">hoteles</option>
              </select>
            </label>

            <label className="filter-field">
              Pais
              <select value={selectedCountry} onChange={(e) => setSelectedCountry(e.target.value)}>
                {countryOptions.map((country) => <option key={country} value={country}>{country}</option>)}
              </select>
            </label>

            <label className="filter-field">
              Provincia
              <select
                value={selectedProvince}
                onChange={(e) => {
                  setSelectedProvince(e.target.value)
                  setSelectedDepartment('')
                  setMapLevel('province')
                }}
              >
                {provinceOptions.map((province) => <option key={province.name} value={province.name}>{province.name}</option>)}
              </select>
            </label>

            <label className="filter-field">
              Departamento
              <select
                value={selectedDepartment}
                onChange={(e) => {
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

            <section className="event-editor">
              <h3>Evento (editable)</h3>
              <form onSubmit={saveEvent} className="event-form">
                <label>
                  Pais
                  <input value={eventForm.country} onChange={(e) => setEventForm((prev) => ({ ...prev, country: e.target.value }))} />
                </label>
                <label>
                  Provincia
                  <input value={eventForm.province} onChange={(e) => setEventForm((prev) => ({ ...prev, province: e.target.value }))} />
                </label>
                <label>
                  Departamento
                  <input value={eventForm.department} onChange={(e) => setEventForm((prev) => ({ ...prev, department: e.target.value }))} />
                </label>
                <label>
                  Nombre del sitio
                  <input value={eventForm.siteName} onChange={(e) => setEventForm((prev) => ({ ...prev, siteName: e.target.value }))} />
                </label>
                <label>
                  Calles
                  <input value={eventForm.street} onChange={(e) => setEventForm((prev) => ({ ...prev, street: e.target.value }))} />
                </label>
                <button type="submit">{editingEventId ? 'Actualizar evento' : 'Guardar evento'}</button>
              </form>
              <div className="event-list">
                {events.length === 0 ? <p>Sin eventos cargados.</p> : events.map((eventItem) => (
                  <div key={eventItem.id} className="event-item">
                    <p><strong>{eventItem.siteName}</strong> - {eventItem.street}</p>
                    <p>{eventItem.country} / {eventItem.province} / {eventItem.department}</p>
                    <div>
                      <button onClick={() => editEvent(eventItem)} type="button">Editar</button>
                      <button onClick={() => deleteEvent(eventItem.id)} type="button">Eliminar</button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <div className="mini-list">
              <h3>Favoritos</h3>
              {favoriteIds.length === 0 ? <p>Sin favoritos.</p> : favoriteIds.map((id) => <p key={id}>- {places.find((p) => p.id === id)?.name}</p>)}
            </div>

            <div className="mini-list">
              <h3>Recorrido en curso</h3>
              {selectedRoute.length === 0 ? <p>Selecciona 2+ lugares.</p> : selectedRoute.map((id) => <p key={id}>- {places.find((p) => p.id === id)?.name}</p>)}
              <input value={routeName} onChange={(e) => setRouteName(e.target.value)} placeholder="Nombre del recorrido" />
              <button onClick={saveRoute} disabled={selectedRoute.length < 2}>Guardar recorrido</button>
            </div>

            <div className="mini-list">
              <h3>Recorridos guardados</h3>
              {routes.length === 0 ? <p>Sin recorridos.</p> : routes.map((route) => <p key={route.id}>{route.name}: {route.placeIds.length} lugares</p>)}
            </div>
          </aside>

          <section className="panel map-panel">
            <div className="map-level-controls">
              <span>Nivel mapa: {mapLevel === 'country' ? 'Pais' : mapLevel === 'province' ? `Provincia (${selectedProvince})` : `Departamento (${selectedDepartment})`}</span>
              {mapLevel !== 'country' ? (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDepartment('')
                    setMapLevel('country')
                  }}
                >
                  Volver a Argentina
                </button>
              ) : null}
            </div>
            <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} scrollWheelZoom style={{ height: '600px', width: '100%' }}>
              <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {!boundsData ? <FlyToArea area={mapTarget} /> : <FitBoundsGeoJson data={boundsData} maxZoom={boundsMaxZoom} />}
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
                        setSelectedProvince(name)
                        setSelectedDepartment('')
                        setMapLevel('province')
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
                      return { ...polygonStyle(feature, 0.52), weight: 3, color: '#0f172a', fillOpacity: 0.62 }
                    }
                    if (mapLevel === 'department') {
                      return { ...polygonStyle(feature, 0.24), weight: 1.2, color: '#475569', fillOpacity: 0.3 }
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
                <LocalitiesClusterLayer key={`layer-loc-${selectedProvince}-${selectedDepartment}`} data={localitiesGeoData} />
              ) : null}
              {visiblePlaces.map((place) => (
                <Marker key={place.id} position={[place.lat, place.lng]} icon={buildMarkerIcon(place.category, place.id === highlightedId)}>
                  <Popup>
                    <article className="popup-card">
                      <h4>{place.name}</h4>
                      <img src={place.image} alt={place.name} />
                      <p>{place.description}</p>
                      <p><strong>Categoria:</strong> {place.category}</p>
                      <p><strong>Telefono:</strong> {place.phone}</p>
                      <button onClick={() => toggleFavorite(place.id)}>{favoriteIds.includes(place.id) ? 'Quitar favorito' : 'Agregar favorito'}</button>
                      <button onClick={() => addToRoute(place.id)}>Agregar a recorrido</button>
                    </article>
                  </Popup>
                </Marker>
              ))}
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
