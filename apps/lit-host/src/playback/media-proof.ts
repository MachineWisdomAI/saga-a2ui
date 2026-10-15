/**
 * The `typ` of a media proof. Shared by the signer (the view) and the verifier (the media
 * service) so a token minted for another purpose is never accepted as a media proof.
 */
export const MEDIA_PROOF_TYP = 'saga-media-proof+jwt';

/** Request headers the player sends on a media acquisition. */
export const CAPABILITY_HEADER = 'x-saga-capability';
export const PROOF_HEADER = 'x-saga-proof';
