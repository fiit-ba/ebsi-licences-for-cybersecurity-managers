import axios from 'axios'
import { TIMEOUT_MS, backofficeUrl } from '@infrastructure/config/Backoffice'
const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` }, timeout: TIMEOUT_MS })
export const authenticateOrganization = async (username: string, password: string) =>
  (await axios.post(`${backofficeUrl()}/api/api-token-auth`, { username, password }, { timeout: TIMEOUT_MS })).data
export const fetchOrganizationAccount = async (token: string) =>
  (await axios.get(`${backofficeUrl()}/registry/me/`, bearer(token))).data
export const registerOrganizationAccount = (invitation: string, username: string, password: string) =>
  axios.post(
    `${backofficeUrl()}/organizations/v1/registrations/`,
    { invitation, username, password, kind: 'ti' },
    { timeout: TIMEOUT_MS },
  )
export const fetchCertificateScheme = async (token: string) =>
  (await axios.get(`${backofficeUrl()}/registry/certificate-scheme/`, bearer(token))).data
export const createCertificateOffer = async (
  token: string,
  holderReference: string,
  claims: Record<string, unknown>,
  credentialType: string,
) =>
  (
    await axios.post(
      `${backofficeUrl()}/registry/issue/`,
      { holder_reference: holderReference, claims, credential_type: credentialType, qr: true },
      bearer(token),
    )
  ).data
