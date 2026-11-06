import { z } from 'zod';
import { createDraftSchema } from '../../examples/drafts/src/contracts.ts';
export function registerDraftTools(tools, request) {
  const operations = new Map();
  tools.register({name:'search_projects',description:'List projects accessible to the signed-in user.',input:z.object({}).strict(),execute:(_input,context)=>request('/projects',undefined,context.callId)});
  tools.register({name:'create_draft',description:'Request a draft in a project. The application manages operation IDs and reuses them on retries. If confirmation_required, ask the user to approve the exact operation in the application, then retry. Never approve on their behalf.',input:createDraftSchema.omit({operationId:true}),execute:async(input,context)=>{
    const key=JSON.stringify([input.projectId,input.title]);
    if(!operations.has(key)) operations.set(key,crypto.randomUUID());
    return request('/drafts',{...input,operationId:operations.get(key)},context.callId);
  }});
  tools.register({name:'get_draft',description:'Retrieve a persisted draft by ID to verify the outcome.',input:z.object({id:z.string()}).strict(),execute:({id},context)=>request('/drafts/'+encodeURIComponent(id),undefined,context.callId)});
}
