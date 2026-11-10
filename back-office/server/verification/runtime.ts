import type { Pool } from 'pg';
import { verificationRegistry } from './registry.ts';
import { postgresCertificationBody } from './certification-body.ts';
import { lazyRedisExchangeCache, memoryExchangeCache } from './exchange-cache.ts';
import { postgresRegistrationThrottle } from '../accreditation/registration-throttle.ts';
import { postgresRelyingParties } from './parties.ts';
import { verificationService } from './service.ts';
import { verificationHttp } from './http.ts';
import type { AuthorizationSigning, CertificateLedger } from '../issuance/types.ts';
import type { Protection } from '../issuance/protection.ts';

/**
 * Compose the verification workflows using the existing installation settings.
 * @param database - Application PostgreSQL pool.
 * @param options - Existing issuer origin/protection/signing identity and read-only ledger.
 * @param env - Existing registry, cache, mobile and retention settings.
 * @returns Service, public HTTP dispatcher, retention worker and owned-cache cleanup.
 * @throws Invalid configuration or cache connection errors.
 */
export async function configuredVerification(
  database: Pool,
  options: {
    origin: string;
    protection: Protection;
    signing: AuthorizationSigning;
    ledger: Pick<CertificateLedger, 'contract' | 'status'>;
  },
  env = process.env,
) {
  const cacheUrl =
    env.PLR_REDIS_CACHE_URL || (env.REDIS_HOST ? `redis://${env.REDIS_HOST}:6379/2` : undefined);
  const redis = cacheUrl ? lazyRedisExchangeCache(cacheUrl) : undefined;
  try {
    const service = verificationService(database, {
      ...options,
      cache: redis?.cache ?? memoryExchangeCache(),
      registry: verificationRegistry({
        didr: env.PLR_DIDR_URL!,
        tir: env.PLR_TIR_BASE_URL ?? env.PLR_TIR_URL!,
        tsr: env.PLR_TSR_URL!,
        roots: env
          .PLR_TRUSTED_ROOT_DIDS!.split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        didSeconds: Number(env.PLR_DID_CACHE_SECONDS ?? 300),
        trustSeconds: Number(env.PLR_TRUST_CACHE_SECONDS ?? 3600),
        schemaSeconds: Number(env.PLR_SCHEMA_CACHE_SECONDS ?? 86400),
      }),
      certificationBody: postgresCertificationBody(database),
      attributesMinutes: Number(env.PLR_PRESENTATION_ATTRIBUTES_MINUTES ?? 15),
      exchangeNetworks: env.PLR_EXCHANGE_NETWORKS ?? '192.168.0.0/16,10.0.0.0/8',
      exchangeTimeoutSeconds: Number(env.PLR_EXCHANGE_TIMEOUT_SECONDS ?? 30),
    });
    const partyLimit = postgresRegistrationThrottle(
      database,
      env.BACK_OFFICE_TOKEN_SECRET!,
      env.PLR_VERIFIER_API_RATE ?? '120/min',
    );
    const mobileLimit = postgresRegistrationThrottle(
      database,
      env.BACK_OFFICE_TOKEN_SECRET!,
      env.PLR_MOBILE_VERIFIER_RATE ?? '20/min',
    );
    const publicHttp = verificationHttp(service, {
      parties: postgresRelyingParties(database),
      partyThrottle: (id) => partyLimit('verifier:party:' + id),
      mobileThrottle: (address) => mobileLimit('verifier:mobile:' + address),
      mobileEnabled: env.PLR_MOBILE_VERIFIER_ENABLED !== 'false',
      trustedProxyHops: Number(env.PLR_NUM_PROXIES ?? 0),
    });
    return {
      service,
      publicHttp,
      purgeAttributes: service.purgeAttributes,
      close: (): Promise<unknown> | undefined => redis?.close(),
    };
  } catch (error) {
    await redis?.close();
    throw error;
  }
}
