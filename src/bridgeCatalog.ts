export const resources = [
  {uri:'folio://workpapers/active/unresolved',name:'Unresolved findings',mimeType:'application/json'},
  {uri:'folio://workpapers/active/variances',name:'Reconciliation variances',mimeType:'application/json'},
  {uri:'folio://register/verified',name:'Verified figure register',mimeType:'application/json'},
]
export const appResources = [
  {uri:'ui://folio/verification-card',name:'Folio verification card',mimeType:'text/html;profile=mcp-app',
    description:'Cropped PDF evidence with Approve & Verify for a staged draft'},
]
const findingId = {type:'string',description:'The finding_id returned by the unresolved resource'}
const query = {type:'string',maxLength:500}
export const workspaceTools = {
  propose_finding_edit:{
    description:'Stage a proposed edit for explicit reviewer approval. Amounts use the source unit. When the source scale or period is ambiguous the call returns input_required so the user can confirm them first.',
    annotations:{readOnlyHint:false},
    _meta:{ui:{resourceUri:'ui://folio/verification-card'}},
    inputSchema:{type:'object',additionalProperties:false,required:['workpaper_id','finding_id','changes','rationale'],properties:{
      workpaper_id:{type:'string'},finding_id:findingId,rationale:{type:'string',maxLength:2000},
      changes:{type:'object',additionalProperties:false,minProperties:1,properties:{amount:{type:'string'},canonicalMetric:{type:'string'},note:{type:'string'}}},
      context:{type:'object',additionalProperties:false,description:'User-confirmed unit and period for ambiguous findings',properties:{unit:{type:'string',maxLength:120},period:{type:'string',maxLength:120}}},
    }},
  },
  explain_reconciliation_variance:{
    description:'Return the active workpaper equations and operand citations for unresolved variances.',
    annotations:{readOnlyHint:true},
    inputSchema:{type:'object',additionalProperties:false,properties:{finding_id:findingId}},
  },
  run_workpaper_tieout:{
    description:'Reconcile the active workpaper: arithmetic checks and cross-page tie-outs of the same canonical metric and period. Supports task-augmented calls that return a task handle immediately.',
    annotations:{readOnlyHint:true},
    execution:{taskSupport:'optional'},
    inputSchema:{type:'object',additionalProperties:false,properties:{only_variances:{type:'boolean'}}},
  },
  review_finding_draft:{
    description:'Approve or reject a staged draft from the Folio verification card. Callable only from the MCP Apps card, and only when the reviewer allows card approvals in Folio.',
    annotations:{readOnlyHint:false},
    _meta:{ui:{resourceUri:'ui://folio/verification-card',visibility:['app']}},
    inputSchema:{type:'object',additionalProperties:false,required:['draft_id','decision'],properties:{draft_id:{type:'string'},decision:{type:'string',enum:['approve','reject']}}},
  },
  query_figure_register:{
    description:'Filter verified figures by document, metric, value, unit, or reporting period.',
    annotations:{readOnlyHint:true},
    inputSchema:{type:'object',additionalProperties:false,properties:{query,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}}},
  },
}
export type WorkspaceTool = keyof typeof workspaceTools
