import { ebsiApiVersion, ebsiEnvironment } from '../api.ts';

/**
 * The shape of EBSI's APIs the checks run against: the pilot's, unless
 * `BACK_OFFICE_TEST_EBSI_API=core-v1` says otherwise. The development EBSI service serves both.
 * @returns The API shape.
 */
export function testEbsiApi() {
  return ebsiApiVersion(process.env.BACK_OFFICE_TEST_EBSI_API);
}

/**
 * The settings that point the back-office at the development EBSI service, in that shape.
 * @param base - The service's origin.
 * @returns `PLR_EBSI_URL`, `PLR_EBSI_API`, the registries and the Ledger API.
 */
export function testEbsi(base: string) {
  return ebsiEnvironment(base, testEbsiApi());
}
