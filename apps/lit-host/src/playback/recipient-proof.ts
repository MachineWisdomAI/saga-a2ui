import { SignJWT } from 'jose';
import { MEDIA_PROOF_TYP } from './media-proof.js';

// Browser-safe half of recipient binding: the view creates a key pair, shares only the public key
// with the Play call, and signs a fresh proof for every media request. It uses WebCrypto and
// `jose`'s web build, so nothing here needs Node.

/** The view's recipient identity for one Play. The private key never leaves the view. */
export interface RecipientKey {
  /** Sent to the server in the call metadata. Public by construction. */
  readonly publicJwk: {
    readonly kty: string;
    readonly crv: string;
    readonly x: string;
    readonly y: string;
  };
  readonly privateKey: CryptoKey;
}

export async function createRecipientKey(): Promise<RecipientKey> {
  // The private key is non-extractable: script in the view can use it but cannot copy it out.
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign', 'verify'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const { kty, crv, x, y } = jwk;
  if (
    kty === undefined ||
    crv === undefined ||
    x === undefined ||
    y === undefined
  ) {
    throw new Error('The platform produced an incomplete public key.');
  }
  return { publicJwk: { kty, crv, x, y }, privateKey: pair.privateKey };
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );
  let binary = '';
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

/** A fresh proof that this request, for this capability, comes from the holder of the bound key. */
export async function signMediaProof(
  key: RecipientKey,
  request: { readonly capability: string; readonly url: string },
): Promise<string> {
  return new SignJWT({
    htm: 'GET',
    htu: request.url,
    cap: await sha256Base64Url(request.capability),
  })
    .setProtectedHeader({
      alg: 'ES256',
      typ: MEDIA_PROOF_TYP,
      jwk: key.publicJwk,
    })
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .sign(key.privateKey);
}
