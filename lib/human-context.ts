type Row=Record<string,any>;
type Reader=(path:string)=>Promise<Row>;

/** Collect every page before producing a copy/download. Revision checks reject mixed exports. */
export async function collectHumanContext(spaceId:string,read:Reader) {
  const items:Row[]=[],ids=new Set<string>(),cursors=new Set<string>();let cursor:string|null=null,first:Row|undefined;
  do{
    const params=new URLSearchParams({space:spaceId,section:'accepted_context'});
    if(cursor)params.set('cursor',cursor);if(first)params.set('revision',String(first.revision));
    const page=await read(`/api/workspace?${params}`);
    if(!first)first=page;
    if(page.revision!==first.revision||page.membership_key!==first.membership_key||page.membership_version!==first.membership_version)throw new Error('Guidance or access changed while preparing this export. Try again.');
    for(const item of page.items){if(ids.has(item.id))throw new Error('The guidance pages changed. Try again.');ids.add(item.id);items.push(item);}
    cursor=page.next_cursor;
    if(cursor){if(cursors.has(cursor))throw new Error('The guidance pages could not be completed. Try again.');cursors.add(cursor);}
  }while(cursor);
  const params=new URLSearchParams({space:spaceId,check_export:'yes',revision:String(first!.revision),membership_key:first!.membership_key,membership_version:String(first!.membership_version)});
  await read(`/api/workspace?${params}`);
  const markdown=`# ${first!.name} — Agent context\n\n${first!.purpose}\n\n`+items.map(c=>`## ${c.title}\n\nRecipient: ${c.to_name||'Agent'}\n\n${c.adopted||c.instruction}\n\nScope: ${c.scope}\n\nReason: ${c.reason}\n\nFrom: ${c.from_name||'Agent'}\nSource: ${c.source_title}\n`).join('\n');
  return {markdown,count:items.length};
}
