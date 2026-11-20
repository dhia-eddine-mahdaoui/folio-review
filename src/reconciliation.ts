import {receiptCheck,type analyzeLines,type Finding} from './findings'
import {sourceScale} from './amount'
import {findingKey,reviewedFinding} from './review'
import type {Figure} from './register'

export type Rule = {name:string; total:Finding; operands:{finding:Finding; sign:number}[]}

export function reconciliation(analysis:ReturnType<typeof analyzeLines>):Rule[] {
  const receipt = receiptCheck(analysis.items)
  return [...analysis.checks,...(receipt ? [{name:'Receipt total',...receipt}] : [])]
}

export function includes(rule:Rule, finding:Finding) {
  const key = findingKey(finding)
  return [rule.total,...rule.operands.map(item=>item.finding)].some(candidate=>findingKey(candidate)===key)
}

export function variance(rule:Rule, figures:Figure[], draft?:{finding:Finding; amount:string; unit:string; period:string}) {
  const observed = (finding:Finding) => draft && findingKey(finding)===findingKey(draft.finding) ? draft : sourceScale(reviewedFinding(finding,figures) ?? finding)
  const total = observed(rule.total)
  const terms = rule.operands.map(item=>({value:observed(item.finding),sign:item.sign}))
  const values = [total,...terms.map(item=>item.value)]
  if (values.some(value=>value.unit!==rule.total.unit || value.period!==rule.total.period || !/^-?\d+(\.\d+)?$/.test(value.amount))) return
  const precision = Math.max(...values.map(value=>value.amount.split('.')[1]?.length ?? 0))
  const integer = (amount:string) => {
    const [whole,fraction=''] = amount.replace(/^-/,'').split('.')
    return BigInt((amount.startsWith('-') ? '-' : '')+whole+fraction.padEnd(precision,'0'))
  }
  const difference = integer(total.amount)-terms.reduce((sum,item)=>sum+integer(item.value.amount)*BigInt(item.sign),0n)
  const absolute = (difference<0n ? -difference : difference).toString().padStart(precision+1,'0')
  const formatted = precision ? absolute.slice(0,-precision)+'.'+absolute.slice(-precision) : absolute
  const expression = terms.map(({value,sign},i)=>i===0 ? (sign<0?'−':'')+value.amount : (sign<0?' − ':' + ')+value.amount).join('')
  return {failed:difference!==0n,difference:(difference<0n?'-':'')+formatted,
    equation:`${expression} ${difference===0n ? '=' : '≠'} ${total.amount} ${total.unit}`}
}

