import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readBoundedText} from '../lib/request-body.ts';

function streamed(chunks,headers={}){
  let cancelled=false,pulls=0;
  const queue=[...chunks],body=new ReadableStream({pull(controller){pulls++;if(queue.length)controller.enqueue(queue.shift());else controller.close();},cancel(){cancelled=true;}},{highWaterMark:0});
  return {request:new Request('https://accord.test/api',{method:'POST',body,duplex:'half',headers}),get cancelled(){return cancelled;},get pulls(){return pulls;}};
}
const bytes=s=>new TextEncoder().encode(s);
test('bounded reader preserves split UTF-8 at the exact byte limit',async()=>{
  const value=bytes('a€z'),s=streamed([value.slice(0,2),value.slice(2,4),value.slice(4)]);
  assert.equal(await readBoundedText(s.request,5),'a€z');assert.equal(s.cancelled,false);
});
for(const headers of [{},{'content-length':'1'}])test('chunked and understated request lengths cannot exceed the byte cap '+JSON.stringify(headers),async()=>{
  const s=streamed([bytes('123'),bytes('456'),bytes('789')],headers);
  await assert.rejects(readBoundedText(s.request,5),{status:413});assert.equal(s.cancelled,true);assert.equal(s.pulls,2);
});
test('oversized declared length cancels without consuming the stream',async()=>{
  const s=streamed([bytes('abc')],{'content-length':'10000'});await assert.rejects(readBoundedText(s.request,10),{status:413});assert.equal(s.cancelled,true);assert.equal(s.pulls,0);
});
test('multibyte content is counted as bytes and invalid UTF-8 fails cleanly',async()=>{
  await assert.rejects(readBoundedText(streamed([bytes('€€')]).request,5),{status:413});
  const invalid=streamed([new Uint8Array([0xff]),bytes('unused')]);await assert.rejects(readBoundedText(invalid.request,10),{status:400});assert.equal(invalid.cancelled,true);
  assert.equal(await readBoundedText(new Request('https://accord.test'),10),'');
});
test('the workspace cap accepts the full source field including UTF-8 and JSON escaping',async()=>{
  for(const content of ['語'.repeat(20000),'\u0001'.repeat(20000)]){
    const body=JSON.stringify({action:'add_source',args:{space_id:'space',title:'Title',kind:'Notes',content}});
    assert.equal(await readBoundedText(streamed([bytes(body)]).request,128*1024),body);
  }
});
