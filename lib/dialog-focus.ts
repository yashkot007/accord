/** Restore focus after React removes the dialog, falling back when a paged row moved. */
export function restoreDialogFocus(trigger:HTMLElement|null,recordId:string) {
  queueMicrotask(()=>{
    if(document.querySelector('dialog[open]'))return;
    const existing=trigger?.isConnected&&!trigger.matches(':disabled')?trigger:document.getElementById(recordId);
    const target=existing||document.querySelector<HTMLElement>('#workspace-main h1')||document.getElementById('workspace-main');
    if(target){if(!existing)target.tabIndex=-1;target.focus();}
  });
}
