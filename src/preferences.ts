import type {WorkspaceTool} from './bridgeCatalog'
import {defaultReasons} from './review'

export const preferencesKey = 'folio-workspace-preferences'
export type Preferences = {reviewer: string; reasons: string[]; ocr: 'local' | 'hosted' | 'mistral' | 'vlm'; endpoint: string; docling:boolean; persistReviewer:boolean; triage:{lowRisk:boolean;flagOverlaps:boolean}; bridge:{enabled:boolean;tools:Record<WorkspaceTool,boolean>}}

export function preferences(): Preferences {
  const defaults: Preferences = {reviewer: '', reasons: defaultReasons, ocr: 'local', endpoint: '', docling:false, persistReviewer:true, triage:{lowRisk:true,flagOverlaps:true}, bridge:{enabled:false,tools:{propose_finding_edit:false,explain_reconciliation_variance:false,query_figure_register:false,run_workpaper_tieout:false,review_finding_draft:false}}}
  try {
    const saved = JSON.parse(localStorage.getItem(preferencesKey) ?? '{}')
    return {...defaults,...saved,triage:{...defaults.triage,...saved.triage},
      bridge:{...defaults.bridge,...saved.bridge,tools:{...defaults.bridge.tools,...saved.bridge?.tools}}}
  } catch {
    return defaults
  }
}

export function storePreferences(value: Preferences) {
  localStorage.setItem(preferencesKey, JSON.stringify(value))
}
