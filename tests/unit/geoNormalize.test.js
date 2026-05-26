import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeGeoName,
  geoMatches,
  filterPlacesByProvince,
  filterPlacesByDepartment,
} from '../../server/geoNormalize.js'

describe('geoNormalize (unit)', () => {
  it('normalizeGeoName quita acentos y pasa a minusculas', () => {
    assert.equal(normalizeGeoName('Mendoza'), 'mendoza')
    assert.equal(normalizeGeoName('Córdoba'), 'cordoba')
    assert.equal(geoMatches('Mendoza', 'mendoza'), true)
  })

  it('filterPlacesByProvince y filterPlacesByDepartment filtran por nombre', () => {
    const rows = [
      { province: 'Mendoza', department: 'Capital' },
      { province: 'Buenos Aires', department: 'La Plata' },
    ]
    const mendoza = filterPlacesByProvince(rows, 'Mendoza')
    assert.equal(mendoza.length, 1)
    assert.equal(mendoza[0].department, 'Capital')

    const all = filterPlacesByProvince(rows, 'all')
    assert.equal(all.length, 2)

    const capital = filterPlacesByDepartment(mendoza, 'Capital')
    assert.equal(capital.length, 1)
  })
})
