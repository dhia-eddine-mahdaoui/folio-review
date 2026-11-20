import {defaultReasons} from './review'

const key = 'folio-workspace-preferences'
export type Preferences = {reviewer: string; reasons: string[]; ocr: 'local' | 'hosted'; endpoint: string}

export function preferences(): Preferences {
  const defaults: Preferences = {reviewer: '', reasons: defaultReasons, ocr: 'local', endpoint: ''}
  try {
    return {...defaults, ...JSON.parse(localStorage.getItem(key) ?? '{}')}
  } catch {
    return defaults
  }
}

export function storePreferences(value: Preferences) {
  localStorage.setItem(key, JSON.stringify(value))
}
