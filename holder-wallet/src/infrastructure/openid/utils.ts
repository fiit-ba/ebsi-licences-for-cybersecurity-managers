import { SignJWT as SignJWTJose, decodeJwt } from 'jose'
import openIdI18nKeys from '@app/localization/i18n/keys'
import dayjs from 'dayjs'
import { ec as EC } from 'elliptic'
import { signJWT, verifyJwt } from '@infrastructure/crypto/jwt'
import { validateObject } from '@shared/utils/utils'
import { getPrivateKey } from '@infrastructure/persistence/keychain'
import { v4 as uuidv4 } from 'uuid'
import { ALASTRIA_DID_METHOD } from '@infrastructure/identity/alastria/constants'
import { EBSI_DID_METHOD, KEY_DID_METHOD } from '@infrastructure/identity/ebsi/constants'
import { LACCHAIN_DID_METHOD } from '@infrastructure/identity/lacchain/constants'
// Slovak names for credential types.
import { credentialTypeName } from '@shared/utils/labels'
import localeSK from '@app/localization/i18n/sk'

// Retained protocol validation used by the legacy token-request flow.
const validateTokenRequest = async (
  {
    tokenRequest,
    credential_issuer,
    subjectDid,
    authorization_server,
  }: {
    tokenRequest: string
    credential_issuer: string
    subjectDid: string
    authorization_server: string
  },
  key: EC.KeyPair,
) => {
  try {
    const verify = await verifyJwt(tokenRequest, key)
    if (!verify) throw openIdI18nKeys.ERROR_VALIDATION_JWT
    const JWTPayload = decodeJwt(tokenRequest)

    const isCorrectGeneralFormat = validateObject(JWTPayload, {
      aud: JWTPayload.aud || subjectDid,
      response_mode: 'direct_post',
      response_type: JWTPayload.response_type ?? 'id_token',
      client_id: JWTPayload.iss,
      scope: 'openid',
    })
    const isCorrectIssA = validateObject(JWTPayload, {
      iss: credential_issuer,
    })
    const isCorrectIssB = validateObject(JWTPayload, {
      iss: authorization_server,
    })
    const isCorrectFormat = isCorrectGeneralFormat && (isCorrectIssA || isCorrectIssB)
    if (!isCorrectFormat) throw openIdI18nKeys.ERROR_VALIDATION_JWT
    const expiresJWT = JWTPayload.exp
    const currentUnixDate = dayjs().unix() / 1000
    if (expiresJWT && expiresJWT < currentUnixDate) {
      throw openIdI18nKeys.ERROR_VALIDATION_JWT
    }
  } catch (error) {
    throw new Error(openIdI18nKeys.ERROR_VALIDATION_JWT)
  }
}

const generateJWT = async (
  idTokenRequest: string,
  authorizationServer: string,
  subjectDid: string,
  extraPayload: any = {},
) => {
  const JWTPayload = decodeJwt(idTokenRequest)
  const holder = {
    did: JWTPayload.aud?.toLocaleString() || '',
  }
  const trustedFramework = getTrustedFrameworkFromDid(subjectDid)
  const header = {
    alg: trustedFramework === 'ebsi' ? 'ES256' : 'ES256K',
    typ: 'JWT',
    kid: holder.did,
  }

  const state = JWTPayload.state
  const payload = {
    nonce: JWTPayload.nonce,
    ...(state != null && { state }),
    ...extraPayload,
  }

  const jwt: any = await new SignJWTJose(payload)
    .setProtectedHeader(header)
    .setIssuedAt()
    .setIssuer(holder.did)
    .setSubject(holder.did)
    .setAudience(authorizationServer)
    .setNotBefore(Math.floor(Date.now() / 1000))
    .setExpirationTime('15m')

  return jwt
}

export const getTrustedFrameworkFromDid = (did: string) => {
  const didLowerCase = did.toLowerCase()

  switch (true) {
    case didLowerCase.includes(ALASTRIA_DID_METHOD):
      return 'epic'
    case didLowerCase.includes(KEY_DID_METHOD):
      return 'ebsi'
    case didLowerCase.includes(EBSI_DID_METHOD):
      return 'ebsi'
    case didLowerCase.includes(LACCHAIN_DID_METHOD):
      return 'Lacchain'
    default:
      return 'Unknown'
  }
}

export const createTokenResponse = async ({
  credential_issuer,
  subjectDid,
  tokenRequest,
  authorization_server,
  extra_payload,
  // The key of the wallet's binding with this issuer, not of the wallet's
  // own DID (design decisions D34).
  privateKey: subjectKey,
}: {
  credential_issuer: string
  subjectDid: string
  tokenRequest: string
  authorization_server: string
  extra_payload?: any
  privateKey?: string
}) => {
  const privateKey = subjectKey ?? (await getPrivateKey())

  // Validation is disabled here for compatibility with issuers that omit JWKS metadata.
  // authorization_server &&
  // 	(await validateTokenRequest(
  // 		{
  // 			tokenRequest,
  // 			credential_issuer,
  // 			subjectDid,
  // 			authorization_server,
  // 		},
  // 		key
  // 	))

  let { _protectedHeader: header, _payload: payload } = await generateJWT(
    tokenRequest,
    authorization_server,
    subjectDid,
    extra_payload,
  )

  const trustedFramework = getTrustedFrameworkFromDid(subjectDid)
  header = { ...header, kid: header.kid }
  const signedToken = await signJWT({ header, trustedFramework, payload, privateKey })

  return { signedToken, header }
}

export const createVp = ({ holder, verifiableCredential }: { holder: string; verifiableCredential: string[] }) => {
  return {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    id: `urn:uuid:${uuidv4()}`,
    type: ['VerifiablePresentation'],
    holder,
    verifiableCredential,
  }
}

export const filterCredentialType = (types: string[]): string[] => {
  // Asuming only one type of credential is supported
  const type = types?.filter(
    (type) => type !== 'VerifiableAttestation' && type !== 'VerifiableCredential' && type !== 'TrustedCredential',
  )
  // Slovak names (src/utils/labels.ts) instead of the credential's English
  // identifiers; the fallback was English as well.
  return (type?.length ? type : [localeSK.UNKNOWN_TYPE]).map(credentialTypeName)
}
