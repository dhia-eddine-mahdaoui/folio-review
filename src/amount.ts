const scales: Record<string, number> = {thousand:3, million:6, billion:9, trillion:12, kobo:-2}

export const scaleName = (unit:string) => unit.match(/\b(thousand|million|billion|trillion|kobo)s?\b/i)?.[1].toLowerCase()

export function normalizedAmount(amount:string, unit:string) {
  if (!/^-?\d+(\.\d+)?$/.test(amount)) return
  const scale = scaleName(unit)
  return {value:shiftAmount(amount,scale ? scales[scale] : 0),
    unit:unit.replace(/\b(thousand|million|billion|trillion|one)s?\b/gi,'').trim().replace(/\s+/g,' ').replace(/^kobo$/i,'NGN')}
}

function shiftAmount(amount:string,scale:number) {
  const [whole,fraction=''] = amount.replace(/^-/,'').split('.')
  const digits = whole+fraction
  const point = whole.length+scale
  const integer = digits.slice(0,Math.max(0,point)).padEnd(Math.max(1,point),'0').replace(/^0+(?=\d)/,'')
  const decimal = ('0'.repeat(Math.max(0,-point))+digits.slice(Math.max(0,point))).replace(/0+$/,'')
  return (amount.startsWith('-') ? '-' : '')+integer+(decimal ? '.'+decimal : '')
}

export function formattedAmount(amount:string, unit:string) {
  const normalized = normalizedAmount(amount,unit)
  if (!normalized) return '—'
  const [whole,fraction] = normalized.value.split('.')
  return [whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(fraction ? '.'+fraction : ''),normalized.unit].filter(Boolean).join(' ')
}

export function sourceScale<T extends {amount:string; unit:string; original?:{amount:string; unit:string}}>(figure:T):T {
  const {original} = figure
  if (!original || figure.unit===original.unit) return figure
  const normalized = normalizedAmount(original.amount,original.unit)
  const scale = scaleName(original.unit)
  if (!scale || normalized?.unit!==figure.unit || !normalizedAmount(figure.amount,figure.unit)) return figure
  const amount = normalized.value===figure.amount ? original.amount : shiftAmount(figure.amount,-scales[scale])
  return {...figure,amount,unit:original.unit}
}
