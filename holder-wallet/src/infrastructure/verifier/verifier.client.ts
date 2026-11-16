import axios from 'axios'
import { TIMEOUT_MS, backofficeUrl } from '@infrastructure/config/Backoffice'
import { VerificationOutcome, VerificationRequest } from './verifier.types'
const PATH = '/verifier/v1/mobile/presentation-requests/'
export const createPresentationRequest = async () =>
  (await axios.post(backofficeUrl() + PATH, {}, { timeout: TIMEOUT_MS })).data
export const fetchVerificationOutcome = async (request: VerificationRequest): Promise<VerificationOutcome> =>
  (
    await axios.get(`${backofficeUrl()}${PATH}${encodeURIComponent(request.state)}/`, {
      headers: { 'X-PLR-Read-Token': request.readToken },
      timeout: TIMEOUT_MS,
    })
  ).data
