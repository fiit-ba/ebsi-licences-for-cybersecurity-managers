// The holder's answer to an exchange (design decisions D33, D34): the certificate,
// a W3C JWT-VC bound to the wallet's DID, in a JWT-VP the DID's key signs over
// the verifier's challenge (`nonce`) and domain (`aud`). It is EBSI's
// `jwt_vp`, the same as an OID4VP presentation. A JWT-VC is signed as one, so
// the whole certificate goes.
import { signJWT } from '@infrastructure/crypto/jwt'
import { createVp } from '@infrastructure/openid/utils'
import { Presentation, envelopePresentation } from './protocol'

/** How long the presentation holds: the exchange is open for two minutes. */
const LIFETIME_SECONDS = 300

export const signPresentation = async ({
  did,
  privateKey,
  credential,
  challenge,
  domain,
  now = Date.now(),
}: {
  did: string
  privateKey: string
  credential: string
  challenge: string
  domain: string
  now?: number
}): Promise<Presentation> => {
  const vp = createVp({ holder: did, verifiableCredential: [credential] })
  const issued = Math.floor(now / 1000)
  const jwt = await signJWT({
    header: { typ: 'JWT', kid: did },
    trustedFramework: 'ebsi',
    payload: {
      iss: did,
      sub: did,
      aud: domain,
      nonce: challenge,
      iat: issued,
      nbf: issued,
      exp: issued + LIFETIME_SECONDS,
      jti: vp.id,
      vp,
    },
    privateKey,
  })
  return envelopePresentation(jwt)
}
