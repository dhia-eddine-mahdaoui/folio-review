export const resources = [
  {uri:'folio://workpapers/active/unresolved',name:'Unresolved findings',mimeType:'application/json'},
  {uri:'folio://workpapers/active/variances',name:'Reconciliation variances',mimeType:'application/json'},
  {uri:'folio://register/verified',name:'Verified figure register',mimeType:'application/json'},
]
const findingId = {type:'string',description:'The finding_id returned by the unresolved resource'}
const query = {type:'string',maxLength:500}
export const workspaceTools = {
  propose_finding_edit:{
    description:'Stage a proposed edit for explicit reviewer approval. Amounts use the source unit.',
    annotations:{readOnlyHint:false},
    inputSchema:{type:'object',additionalProperties:false,required:['workpaper_id','finding_id','changes','rationale'],properties:{
      workpaper_id:{type:'string'},finding_id:findingId,rationale:{type:'string',maxLength:2000},
      changes:{type:'object',additionalProperties:false,minProperties:1,properties:{amount:{type:'string'},canonicalMetric:{type:'string'},note:{type:'string'}}},
    }},
  },
  explain_reconciliation_variance:{
    description:'Return the active workpaper equations and operand citations for unresolved variances.',
    annotations:{readOnlyHint:true},
    inputSchema:{type:'object',additionalProperties:false,properties:{finding_id:findingId}},
  },
  query_figure_register:{
    description:'Filter verified figures by document, metric, value, unit, or reporting period.',
    annotations:{readOnlyHint:true},
    inputSchema:{type:'object',additionalProperties:false,properties:{query,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}}},
  },
}
export type WorkspaceTool = keyof typeof workspaceTools
