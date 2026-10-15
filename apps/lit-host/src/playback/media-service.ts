/** The bytes of one protected episode, as the application's storage returns them. */
export interface ProtectedMedia {
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

/**
 * The application's protected storage seam. Reading here is the "protected media fetch": no
 * code path may reach it before authentication, entitlement and the capability check.
 */
export interface MediaStore {
  read(episodeId: string): Promise<ProtectedMedia>;
}
