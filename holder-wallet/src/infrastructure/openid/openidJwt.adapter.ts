import { decodeJwt, decodeProtectedHeader } from 'jose'
import { decodeToken } from 'jsontokens'
export const decodeJwtPayload = <T = any>(token: string): T => decodeJwt(token) as T
export const decodeJwtHeader = (token: string) => decodeProtectedHeader(token)
export const decodeLegacyJwtPayload = <T = any>(token: string): T => decodeToken(token).payload as T
