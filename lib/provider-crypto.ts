import { AppError } from './workspace.ts';

const encoder = new TextEncoder();
export const base64url = (data: Uint8Array) => btoa(String.fromCharCode(...data)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
function bytes(value: string) { return Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0)); }
export async function digest(value: string) { return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))); }
export function nonce() { return base64url(crypto.getRandomValues(new Uint8Array(32))); }

/** Credentials and private drafts use owner-bound authenticated encryption; never send ciphertext to clients. */
export class ProviderVault {
  private secret:string|undefined;private owner:string;
  constructor(secret: string | undefined, owner: string) {this.secret=secret;this.owner=owner;}
  get configured() { try { return !!this.secret && bytes(this.secret).length===32; } catch { return false; } }
  private async key() {
    if(!this.configured) throw new AppError('Account connections are temporarily unavailable. Please try again later.',503);
    return crypto.subtle.importKey('raw',bytes(this.secret!),{name:'AES-GCM'},false,['encrypt','decrypt']);
  }
  async seal(value: unknown, purpose: string) {
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(`accord:granola:${this.owner}:${purpose}:v1`)},await this.key(),encoder.encode(JSON.stringify(value)));
    return `v1.${base64url(iv)}.${base64url(new Uint8Array(encrypted))}`;
  }
  async open<T>(value: string, purpose: string): Promise<T> {
    try {
      const parts=value.split('.');if(parts.length!==3||parts[0]!=='v1')throw Error();
      const decrypted=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(parts[1]),additionalData:encoder.encode(`accord:granola:${this.owner}:${purpose}:v1`)},await this.key(),bytes(parts[2]));
      return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decrypted));
    } catch { throw new AppError('This connection could not be opened. Disconnect it and sign in to Granola again.',503); }
  }
}
