'use client';

import { Copy, Download } from 'lucide-react';
import { museConnectionRequest, type AssistantRecipe, type SetupProfile } from '@/lib/assistant-connections';

export function AssistantInstallGuide({ recipe, endpoint, onCopy, profile, spaceId, copyBusy=false, copyingSetup=false }: {
  recipe: AssistantRecipe; endpoint: string; onCopy: (value: string) => void; profile?: SetupProfile; spaceId?: string; copyBusy?: boolean; copyingSetup?: boolean;
}) {
  return <section className="muse-setup-step" aria-label={`Add Accord to ${recipe.name}`}>
    <h3 tabIndex={-1}>Add Accord to {recipe.name}</h3><p>{recipe.instruction}</p>
    {recipe.method === 'plugin' ? <a className="button secondary" href={recipe.packagePath} download><Download size={15}/>Download plugin</a>
      : recipe.method === 'custom-connector' ? <button type="button" className="button secondary" aria-disabled={copyBusy} onClick={() => {if(!copyBusy)onCopy(museConnectionRequest(endpoint, profile, spaceId));}}><Copy size={15}/>{copyingSetup?'Copying…':'Copy setup instructions'}</button>
      : recipe.method !== 'existing-plugin' && <button type="button" className="button secondary" aria-disabled={copyBusy} onClick={() => {if(!copyBusy)onCopy(endpoint);}}><Copy size={15}/>{copyingSetup?'Copying…':'Copy connection address'}</button>}
    {recipe.method === 'unconfirmed' && <p className="field-help">Stop if your assistant does not offer this connection.</p>}
  </section>;
}
