/**
 * Lugares reales en Mendoza (referencia: mendoza.tur.ar, cámara de turismo, salud provincial).
 * areaKey único por lugar para seed idempotente.
 */
const IMG = {
  bodegas: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3',
  olivicolas: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5',
  religioso: 'https://images.unsplash.com/photo-1514896856000-91cb4a0d6d9c',
  hospitales: 'https://images.unsplash.com/photo-1586773860418-d37222d8fce3',
  hoteles: 'https://images.unsplash.com/photo-1566073771259-6a8506099945',
}

const raw = [
  // —— Bodegas ——
  { key: 'mza-trapiche', name: 'Bodega Trapiche', category: 'bodegas', department: 'Maipu', lat: -32.983, lng: -68.792, desc: 'Bodega histórica de Maipú con museo, restaurante y degustaciones.' },
  { key: 'mza-catena', name: 'Bodega Catena Zapata', category: 'bodegas', department: 'Lujan de Cuyo', lat: -33.0236, lng: -68.8688, desc: 'Pirámide en Agrelo, icono del malbec mendocino.' },
  { key: 'mza-zuccardi', name: 'Bodega Zuccardi Piedra Infinita', category: 'bodegas', department: 'San Carlos', lat: -33.583, lng: -69.129, desc: 'Valle de Uco, arquitectura de piedra y alta gastronomía.' },
  { key: 'mza-salentein', name: 'Bodega Salentein', category: 'bodegas', department: 'Tunuyan', lat: -33.652, lng: -69.018, desc: 'Valle de Uco frente a la cordillera, arte y vinos premium.' },
  { key: 'mza-santa-julia', name: 'Bodega Santa Julia', category: 'bodegas', department: 'Maipu', lat: -32.958, lng: -68.778, desc: 'Enoturismo en Maipú, visitas y vendimia participativa.' },
  { key: 'mza-norton', name: 'Bodega Norton', category: 'bodegas', department: 'Lujan de Cuyo', lat: -33.048, lng: -68.89, desc: 'Bodega clásica con museo y cavas en Luján de Cuyo.' },
  { key: 'mza-luigi-bosca', name: 'Bodega Luigi Bosca', category: 'bodegas', department: 'Lujan de Cuyo', lat: -33.042, lng: -68.874, desc: 'Tradición familiar y malbec de exportación.' },
  { key: 'mza-achaval', name: 'Bodega Achaval Ferrer', category: 'bodegas', department: 'Lujan de Cuyo', lat: -33.012, lng: -68.862, desc: 'Finca Bellavista, vinos de autor en Perdriel.' },
  { key: 'mza-ruca-malen', name: 'Bodega Ruca Malen', category: 'bodegas', department: 'Lujan de Cuyo', lat: -33.028, lng: -68.881, desc: 'Cocina de autor y degustación en finca boutique.' },
  { key: 'mza-domaine-bousquet', name: 'Domaine Bousquet', category: 'bodegas', department: 'Tupungato', lat: -33.528, lng: -69.148, desc: 'Vinos orgánicos en altura del Valle de Uco.' },
  { key: 'mza-bianchi', name: 'Bodega Bianchi', category: 'bodegas', department: 'San Rafael', lat: -34.608, lng: -68.331, desc: 'Referente del sur mendocino, visitas y degustación.' },
  { key: 'mza-sottano', name: 'Bodega Sottano', category: 'bodegas', department: 'Lujan de Cuyo', lat: -33.055, lng: -68.895, desc: 'Experiencia sensorial en Perdriel.' },
  { key: 'mza-domecq', name: 'Bodega Domecq Bodegas Esmeralda', category: 'bodegas', department: 'Maipu', lat: -32.971, lng: -68.805, desc: 'Complejo enoturístico en el corredor de Maipú.' },
  { key: 'mza-los-patos', name: 'Bodega Los Patos de Uco', category: 'bodegas', department: 'Tunuyan', lat: -33.591, lng: -69.072, desc: 'Altura extrema en el Valle de Uco.' },
  { key: 'mza-chandon', name: 'Bodega Chandon Argentina', category: 'bodegas', department: 'Tupungato', lat: -33.568, lng: -69.125, desc: 'Espumantes en Tupungato, visitas a viñedos en altura.' },

  // —— Olivícolas ——
  { key: 'mza-laur', name: 'Olivicola Laur', category: 'olivicolas', department: 'Maipu', lat: -32.992, lng: -68.768, desc: 'AOVE premiado mundialmente, visitas y cata en Maipú.' },
  { key: 'mza-pasolio', name: 'Pasolio Olivicola', category: 'olivicolas', department: 'Maipu', lat: -33.05, lng: -68.8, desc: 'Aceite premium y turismo olivícola en Maipú.' },
  { key: 'mza-almaoliva', name: 'Finca Almaoliva', category: 'olivicolas', department: 'Maipu', lat: -32.965, lng: -68.755, desc: 'Finca turística en Coquimbito, degustaciones guiadas.' },
  { key: 'mza-maguay', name: 'Olivicola Maguay', category: 'olivicolas', department: 'Maipu', lat: -32.978, lng: -68.785, desc: 'Ruta del Olivo, producción y venta directa.' },
  { key: 'mza-simone', name: 'Olivicola Simone', category: 'olivicolas', department: 'Maipu', lat: -32.985, lng: -68.772, desc: 'Almazara familiar en el circuito oleoturístico.' },
  { key: 'mza-cava-oliva', name: 'Cava del Oliva', category: 'olivicolas', department: 'Maipu', lat: -32.968, lng: -68.798, desc: 'Catas y productos gourmet en Maipú.' },
  { key: 'mza-zuelo', name: 'Olivicola Zuelo', category: 'olivicolas', department: 'Maipu', lat: -32.975, lng: -68.762, desc: 'Aceites varietales en la zona de Maipú.' },
  { key: 'mza-nobile', name: 'Olivicola Nobile', category: 'olivicolas', department: 'Maipu', lat: -32.981, lng: -68.788, desc: 'Tradición italiana en el Valle de Maipú.' },
  { key: 'mza-pasrai', name: 'Olivicola Pasrai', category: 'olivicolas', department: 'Maipu', lat: -32.969, lng: -68.775, desc: 'Recorridos por olivar y almazara.' },
  { key: 'mza-rio-mendoza-oliva', name: 'Rio Mendoza Olivos', category: 'olivicolas', department: 'San Martin', lat: -33.081, lng: -68.47, desc: 'Producción olivícola en el este mendocino.' },
  { key: 'mza-sol-cuyano', name: 'Olivicola Sol Cuyano', category: 'olivicolas', department: 'Lujan de Cuyo', lat: -33.052, lng: -68.891, desc: 'Aceite artesanal en Luján de Cuyo.' },
  { key: 'mza-palazzini', name: 'Olivicola Palazzini', category: 'olivicolas', department: 'Maipu', lat: -32.977, lng: -68.781, desc: 'Aceitunas y aceites en el corredor de Maipú.' },

  // —— Religioso ——
  { key: 'mza-catedral-loreto', name: 'Catedral de Loreto', category: 'religioso', department: 'Capital', lat: -32.8897, lng: -68.8458, desc: 'Catedral metropolitana en Plaza Sarmiento.' },
  { key: 'mza-san-francisco', name: 'Basilica de San Francisco', category: 'religioso', department: 'Capital', lat: -32.8869, lng: -68.8442, desc: 'Patrimonio jesuitico y Virgen del Carmen de Cuyo.' },
  { key: 'mza-san-juan-bosco', name: 'Iglesia San Juan Bosco', category: 'religioso', department: 'Capital', lat: -32.882, lng: -68.838, desc: 'Murales de Salvino Spinnato, circuito de las 7 iglesias.' },
  { key: 'mza-merced', name: 'Iglesia Nuestra Señora de la Merced', category: 'religioso', department: 'Capital', lat: -32.891, lng: -68.842, desc: 'Templo histórico, protectora de Mendoza tras el terremoto.' },
  { key: 'mza-mama-antula', name: 'Santuario Mama Antula', category: 'religioso', department: 'Capital', lat: -32.89, lng: -68.845, desc: 'Santuario de la beata María Antonia de Paz.' },
  { key: 'mza-lourdes', name: 'Basilica de Lourdes', category: 'religioso', department: 'Capital', lat: -32.894, lng: -68.851, desc: 'Santuario mariano en el centro de Mendoza.' },
  { key: 'mza-santo-domingo', name: 'Iglesia Santo Domingo', category: 'religioso', department: 'Capital', lat: -32.888, lng: -68.847, desc: 'Parte del camino de las 7 iglesias.' },
  { key: 'mza-san-jose-godoy', name: 'Parroquia San Jose', category: 'religioso', department: 'Godoy Cruz', lat: -32.928, lng: -68.83, desc: 'Templo en Godoy Cruz, area metropolitana.' },
  { key: 'mza-corpus-christi', name: 'Parroquia Corpus Christi', category: 'religioso', department: 'Capital', lat: -32.885, lng: -68.849, desc: 'Iglesia del centro histórico mendocino.' },

  // —— Hospitales y clínicas (salud) ——
  { key: 'mza-hospital-central', name: 'Hospital Central de Mendoza', category: 'hospitales', department: 'Capital', lat: -32.889, lng: -68.839, desc: 'Hospital publico de alta complejidad, Alem y Salta.' },
  { key: 'mza-lagomaggiore', name: 'Hospital Luis Lagomaggiore', category: 'hospitales', department: 'Capital', lat: -32.877, lng: -68.828, desc: 'Referencia asistencial publica en Mendoza capital.' },
  { key: 'mza-notti', name: 'Hospital Pediatrico Humberto Notti', category: 'hospitales', department: 'Guaymallen', lat: -32.872, lng: -68.792, desc: 'Pediatria de referencia nacional en Guaymallén.' },
  { key: 'mza-hospital-espanol', name: 'Hospital Español de Mendoza', category: 'hospitales', department: 'Capital', lat: -32.891, lng: -68.853, desc: 'Sanatorio privado centenario en Mendoza.' },
  { key: 'mza-perrupato', name: 'Hospital Alfredo Perrupato', category: 'hospitales', department: 'Capital', lat: -32.884, lng: -68.835, desc: 'Hospital publico del area metropolitana.' },
  { key: 'mza-scaravelli', name: 'Hospital Antonio Scaravelli', category: 'hospitales', department: 'Godoy Cruz', lat: -32.915, lng: -68.825, desc: 'Atencion publica en Godoy Cruz.' },
  { key: 'mza-paroissien', name: 'Hospital Diego Paroissien', category: 'hospitales', department: 'San Rafael', lat: -34.608, lng: -68.315, desc: 'Hospital publico del sur mendocino.' },
  { key: 'mza-hospital-uncuyo', name: 'Hospital Universitario UNCuyo', category: 'hospitales', department: 'Capital', lat: -32.864, lng: -68.812, desc: 'Hospital universitario y docencia medica.' },
  { key: 'mza-clinica-aconcagua', name: 'Clinica Aconcagua', category: 'hospitales', department: 'Capital', lat: -32.887, lng: -68.856, desc: 'Clinica privada en zona sur de la capital.' },
  { key: 'mza-clinica-mayo', name: 'Clinica Mayo de Mendoza', category: 'hospitales', department: 'Capital', lat: -32.893, lng: -68.848, desc: 'Centro medico privado en el gran Mendoza.' },
  { key: 'mza-schestakow', name: 'Hospital Teodoro Schestakow', category: 'hospitales', department: 'San Rafael', lat: -34.612, lng: -68.328, desc: 'Hospital zonal de San Rafael.' },
  { key: 'mza-emergencias-maipu', name: 'Hospital de Maipu', category: 'hospitales', department: 'Maipu', lat: -32.962, lng: -68.782, desc: 'Atencion de salud en el departamento de Maipú.' },

  // —— Hoteles ——
  { key: 'mza-diplomatic', name: 'Diplomatic Hotel Mendoza', category: 'hoteles', department: 'Capital', lat: -32.891, lng: -68.858, desc: 'Hotel 5 estrellas con spa y vista a la cordillera.' },
  { key: 'mza-hilton', name: 'Hilton Mendoza Hotel', category: 'hoteles', department: 'Capital', lat: -32.888, lng: -68.842, desc: 'Hotel internacional en el centro de la ciudad.' },
  { key: 'mza-argentino', name: 'Hotel Argentino Mendoza', category: 'hoteles', department: 'Capital', lat: -32.8885, lng: -68.8445, desc: 'Frente a Plaza Independencia, categoria superior.' },
  { key: 'mza-crillon', name: 'Hotel Crillon Mendoza', category: 'hoteles', department: 'Capital', lat: -32.887, lng: -68.843, desc: 'Hotel céntrico con piscina y desayuno buffet.' },
  { key: 'mza-nh-cordillera', name: 'NH Mendoza Cordillera', category: 'hoteles', department: 'Capital', lat: -32.886, lng: -68.841, desc: 'Hotel 4 estrellas en microcentro.' },
  { key: 'mza-cavas-lodge', name: 'Cavas Wine Lodge', category: 'hoteles', department: 'Lujan de Cuyo', lat: -33.018, lng: -68.872, desc: 'Lodge enológico, Llave Michelin en Agrelo.' },
  { key: 'mza-casa-uco', name: 'Casa de Uco Vineyards & Wine Resort', category: 'hoteles', department: 'Tunuyan', lat: -33.612, lng: -69.045, desc: 'Resort de vino en el Valle de Uco.' },
  { key: 'mza-vines-spa', name: 'The Vines Resort & Spa', category: 'hoteles', department: 'Tunuyan', lat: -33.598, lng: -69.038, desc: 'Resort de lujo entre viñedos en Valle de Uco.' },
  { key: 'mza-susana-balbo', name: 'Susana Balbo Winemakers House', category: 'hoteles', department: 'Lujan de Cuyo', lat: -33.035, lng: -68.865, desc: 'Hotel bodega con spa en Agrelo.' },
  { key: 'mza-porton-dios', name: 'Posada El Porton de los Dioses', category: 'hoteles', department: 'Maipu', lat: -32.99, lng: -68.795, desc: 'Posada en zona de bodegas de Maipú.' },
  { key: 'mza-fuerte-mayor', name: 'Fuerte Mayor Hotel', category: 'hoteles', department: 'Capital', lat: -32.892, lng: -68.846, desc: 'Hotel boutique en el centro mendocino.' },
  { key: 'mza-mod-hotel', name: 'Mod Hotel Mendoza', category: 'hoteles', department: 'Capital', lat: -32.89, lng: -68.84, desc: 'Diseño contemporáneo cerca del centro.' },
  { key: 'mza-vinedos-maipu', name: 'Hotel Vinedos Maipu', category: 'hoteles', department: 'Maipu', lat: -32.9795, lng: -68.7812, desc: 'Alojamiento entre viñedos en Maipú.' },
]

export const mendozaPlaces = raw.map((p) => ({
  name: p.name,
  description: p.desc,
  image: IMG[p.category],
  category: p.category,
  phone: '+54 261 400 0000',
  province: 'Mendoza',
  department: p.department,
  areaKey: p.key,
  lat: p.lat,
  lng: p.lng,
}))

const mendozaGroupMeta = [
  { category: 'bodegas', label: 'Bodegas en Mendoza', icon: '/icons/bodegas.png' },
  { category: 'olivicolas', label: 'Olivícolas en Mendoza', icon: '/icons/olivicolas.png' },
  { category: 'religioso', label: 'Religioso en Mendoza', icon: '/icons/religioso.png' },
  { category: 'hospitales', label: 'Salud en Mendoza', icon: '/icons/hospitales.png' },
  { category: 'hoteles', label: 'Hoteles en Mendoza', icon: '/icons/hoteles.png' },
]

export const mendozaQuickSearchGroups = mendozaGroupMeta.map((group) => ({
  ...group,
  items: mendozaPlaces
    .filter((p) => p.category === group.category)
    .map((p) => ({
      id: p.areaKey,
      name: p.name,
      category: p.category,
      province: p.province,
      department: p.department,
      lat: p.lat,
      lng: p.lng,
    })),
}))
