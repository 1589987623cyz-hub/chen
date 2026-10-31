import { NUMERIC_PARAMS, type Config } from '@/domain/params'
import { estimateMass } from '@/domain/validate'
import { buildParts, contacts, maskParams, pins, sensors, tiles, type Part } from '@/geometry/mask'
import { translate, type Lang } from '@/i18n'
import { stlBinary, threeMf, zip, type ZipEntry } from './files'

export function configJson(data: Config | Config[]) {
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
}

export function printPackage() {
  const entries: ZipEntry[] = []
  for (const part of buildParts()) {
    entries.push({ path: `stl/${part.group}/${part.name}.stl`, data: stlBinary(part.mesh, part.name) })
    entries.push({ path: `3mf/${part.group}/${part.name}.3mf`, data: threeMf(part.mesh, part.name) })
  }
  return new Blob([zip(entries) as BlobPart], { type: 'application/zip' })
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export function specHtml(config: Config, lang: Lang) {
  const t = (key: string, args?: Record<string, string | number>) => translate(lang, key, args)
  const v = config.values
  const unit = (u: string) => (u === 'pcs' || u === 'level' ? t(`unit.${u}`) : u)
  const rows = (group: string) =>
    NUMERIC_PARAMS.filter((p) => p.group === group)
      .map((p) => `<tr><th scope="row">${t(`param.${p.key}`)}</th><td>${v[p.key]} ${unit(p.unit)}</td></tr>`)
      .join('')
  const hard = t(config.printPreset === 'fdm' ? 'spec.hardFdm' : 'spec.hardService')
  const bom: [string, number, string][] = [
    [t('spec.bomTile'), tiles.length, hard],
    [t('spec.bomShell'), 1, hard],
    [t('spec.bomPin'), pins.length, hard],
    [t('spec.bomSensor'), sensors.length, hard],
    [t('spec.bomContact'), contacts.length, t('spec.soft')],
  ]
  const zones = config.enabledZones
    .map((z) => t(`place.${z}`))
    .join(t('common.list'))
  const steps = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map((s) => `<li>${t(`spec.${s}`)}</li>`).join('')
  return `<!doctype html>
<html lang="${lang === 'zh' ? 'zh-CN' : 'en'}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${t('spec.title')} – ${escapeHtml(config.name)}</title>
<style>
body{font-family:'Segoe UI','Microsoft YaHei',system-ui,sans-serif;font-size:18px;line-height:1.6;max-width:50rem;margin:0 auto;padding:1.5rem;color:#111;background:#fff}
h1{font-size:1.8rem}h2{font-size:1.35rem;margin-top:2rem;border-bottom:2px solid #111}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #555;padding:.4rem .6rem;text-align:left;vertical-align:top}
.notice{border:2px solid #111;padding:.75rem 1rem}
</style>
</head>
<body>
<main>
<h1>${t('spec.title')}</h1>
<p class="notice">${t('spec.notice')}</p>
<h2>${t('spec.summary')}</h2>
<ul>
<li>${escapeHtml(config.name)}</li>
<li>${t('spec.generated')}: ${new Date().toLocaleString(lang === 'zh' ? 'zh-CN' : 'en')}</li>
<li>${t(config.feedbackConfirmed ? 'spec.confirmed' : 'spec.notConfirmed')}</li>
<li>${t('review.mass', { g: estimateMass().toFixed(0) })}</li>
</ul>
<h2>${t('spec.measurements')}</h2>
<table><tbody>${rows('measure')}</tbody></table>
<h2>${t('spec.zonesEnabled')}</h2>
<p>${zones}</p>
<h2>${t('spec.print')}</h2>
<p>${t(config.printPreset === 'fdm' ? 'struct.fdm' : 'struct.service')}</p>
<p>${t('spec.dimensions', { w: maskParams.derived.overallWidth, h: maskParams.derived.overallHeight, d: maskParams.derived.overallDepth })}</p>
<h2>${t('spec.bom')}</h2>
<table>
<thead><tr><th scope="col">${t('spec.part')}</th><th scope="col">${t('spec.qty')}</th><th scope="col">${t('spec.material')}</th></tr></thead>
<tbody>${bom.map(([a, b, c]) => `<tr><th scope="row">${a}</th><td>${b}</td><td>${c}</td></tr>`).join('')}</tbody>
</table>
<p>${t('spec.electronics')}</p>
<h2>${t('spec.assembly')}</h2>
<ol>${steps}</ol>
<h2>${t('spec.feedback')}</h2>
<table><tbody>${rows('feedback')}</tbody></table>
</main>
</body>
</html>`
}

/** rhino3dm is loaded on demand because its wasm file is large. */
export async function rhinoFile() {
  const [{ default: init }, { default: wasmUrl }] = await Promise.all([
    import('rhino3dm/rhino3dm.module.js'),
    import('rhino3dm/rhino3dm.wasm?url'),
  ])
  const rhino = await init({ locateFile: () => wasmUrl })
  const doc = new rhino.File3dm()
  doc.settings().modelUnitSystem = rhino.UnitSystem.Millimeters

  const layers = new Map<string, number>()
  const layerFor = (part: Part) => {
    const name = part.group
    const existing = layers.get(name)
    if (existing !== undefined) return existing
    const layer = new rhino.Layer()
    layer.name = name
    const index: number = doc.layers().add(layer)
    layers.set(name, index)
    return index
  }

  for (const part of buildParts()) {
    const mesh = new rhino.Mesh()
    const { positions: p, indices: t } = part.mesh
    for (let i = 0; i < p.length; i += 3) mesh.vertices().add(p[i], p[i + 1], p[i + 2])
    for (let i = 0; i < t.length; i += 3) mesh.faces().addTriFace(t[i], t[i + 1], t[i + 2])
    mesh.normals().computeNormals()
    const attributes = new rhino.ObjectAttributes()
    attributes.layerIndex = layerFor(part)
    attributes.name = part.name
    doc.objects().add(mesh, attributes)
  }
  return new Blob([doc.toByteArray() as BlobPart], { type: 'application/octet-stream' })
}
