// One canonical taxonomy for narrative commentary and financial statements, so the same line item
// carries the same canonical metric wherever it appears in a workpaper.
export type Framework = 'US-GAAP' | 'IFRS'
type Concept = {usGaap?:{tag:string;label:string}; ifrs?:{tag:string;label:string}; nonGaap?:string}

const concepts:Record<string,Concept> = {
  revenue:{usGaap:{tag:'Revenues',label:'Revenues'},ifrs:{tag:'Revenue',label:'Revenue'}},
  total_net_sales:{usGaap:{tag:'RevenueFromContractWithCustomerExcludingAssessedTax',label:'Revenues'},ifrs:{tag:'Revenue',label:'Revenue'}},
  operating_income:{usGaap:{tag:'OperatingIncomeLoss',label:'Operating Profit'},ifrs:{tag:'ProfitLossFromOperatingActivities',label:'Operating Profit'}},
  net_income:{usGaap:{tag:'NetIncomeLoss',label:'Net Income'},ifrs:{tag:'ProfitLoss',label:'Profit for the Year'}},
  income_before_provision_for_income_taxes:{usGaap:{tag:'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',label:'Income Before Taxes'},
    ifrs:{tag:'ProfitLossBeforeTax',label:'Profit Before Tax'}},
  provision_for_income_taxes:{usGaap:{tag:'IncomeTaxExpenseBenefit',label:'Income Tax Expense'},ifrs:{tag:'IncomeTaxExpenseContinuingOperations',label:'Income Tax Expense'}},
  capital_expenditure:{usGaap:{tag:'PaymentsToAcquirePropertyPlantAndEquipment',label:'Capital Expenditures'},
    ifrs:{tag:'PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities',label:'Capital Expenditures'}},
  earnings_per_share:{usGaap:{tag:'EarningsPerShareBasic',label:'Earnings Per Share, Basic'},ifrs:{tag:'BasicEarningsLossPerShare',label:'Earnings Per Share, Basic'}},
  free_cash_flow:{nonGaap:'Free Cash Flow'},
  ebitda:{nonGaap:'EBITDA'},
  adjusted_ebitda:{nonGaap:'Adjusted EBITDA'},
  ebitda_margin:{nonGaap:'EBITDA Margin'},
}

// Narrative extraction labels resolve to the same concepts as statement row keys.
const narrativeConcepts:Record<string,string> = {
  'Revenue':'revenue','Operating profit':'operating_income','Net profit':'net_income','Profit before tax':'income_before_provision_for_income_taxes',
  'Capital expenditure':'capital_expenditure','Earnings per share':'earnings_per_share','Free cash flow':'free_cash_flow',
  'EBITDA':'ebitda','Adjusted EBITDA':'adjusted_ebitda','EBITDA margin':'ebitda_margin',
}

// US-GAAP for US dollar filings, IFRS for other reporting currencies. Without a currency the framework is unknown,
// so receipts, unmapped items and figures with no stated currency keep their extracted label.
export function frameworkFor(unit:string):Framework|undefined {
  const currency = unit.trim()
  if (/^(?:USD|\$)/.test(currency)) return 'US-GAAP'
  if (/^(?:GBP|EUR|NGN|TRY|MYR|CAD|AUD|NZD|RM|£|€|₦|₺)/.test(currency)) return 'IFRS'
}

export function canonical(conceptKey:string|undefined, unit:string, fallback:string) {
  const concept = conceptKey ? concepts[conceptKey] : undefined
  if (!concept) return {label:fallback,tag:null}
  if (concept.nonGaap) return {label:concept.nonGaap+' (Non-GAAP)',tag:null}
  const framework = frameworkFor(unit)
  if (!framework) return {label:fallback,tag:null}
  const entry = framework==='US-GAAP' ? concept.usGaap : concept.ifrs
  if (!entry) return {label:fallback,tag:null}
  return {label:`${entry.label} (${framework})`,tag:(framework==='US-GAAP' ? 'us-gaap:' : 'ifrs-full:')+entry.tag}
}

export const narrativeConcept = (label:string) => narrativeConcepts[label]
