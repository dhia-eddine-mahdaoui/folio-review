import type {Finding} from './findings'
import type {Preferences} from './preferences'
import type {Figure} from './register'
import {includes,variance,type Rule} from './reconciliation'

export function risk(finding:Finding, rules:Rule[], figures:Figure[], settings:Preferences['triage']) {
  const checks = rules.filter(rule=>includes(rule,finding)).map(rule=>variance(rule,figures))
  const flags = finding.review_flags ?? []
  if (checks.some(result=>!result || result.failed) ||
    flags.some(flag=>flag!=='column_alignment_unresolved' || settings.flagOverlaps) ||
    finding.source.ocr && (finding.source.confidence ?? 0)<90) return 'Exception'
  if (settings.lowRisk && !finding.source.ocr && !flags.length && checks.length) return 'Low-Risk'
  return 'Standard'
}
