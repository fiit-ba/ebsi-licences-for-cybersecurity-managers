import { Contract, getAddress, isAddress, type Provider } from 'ethers';
import { GOVERNANCE_ABI, REGISTRY_ABI } from '../../shared/governance-contract.ts';
import {
  PROXY_FACTORY_ABI,
  templateId,
  type ContractTemplates,
} from '../lifecycle/tao-contracts.ts';
import type { CertificateRegistries } from './types.ts';

/** A registry a credential names that is not a genuine registry of the issuing TI's TAO. */
export class UntrustedRegistry extends Error {
  readonly code = 'UntrustedRegistry';
}

/**
 * The certificate registries of every TAO, recognised on the chain: a registry is trusted when
 * EBSI's Proxy Factory deployed it from the certificate registry template, its governance from the
 * governance template, the two name each other, and the governance serves the TAO that accredited
 * the issuing TI. No list of registries is configured: a TAO appointed later is recognised as soon
 * as its pair exists.
 * @param options - Read provider, chain, EBSI's Proxy Factory, the two templates and how long a
 * recognised registry is remembered.
 * @returns The registries.
 */
export function certificateRegistries(options: {
  provider: Provider;
  chainId: number;
  factory: string;
  templates: ContractTemplates;
  cacheSeconds?: number;
}): CertificateRegistries {
  const { provider, chainId } = options;
  const factory = new Contract(getAddress(options.factory), PROXY_FACTORY_ABI, provider);
  const expected = {
    registry: templateId(options.templates.registry),
    governance: templateId(options.templates.governance),
  };
  const cacheMs = (options.cacheSeconds ?? 600) * 1000;
  const recognised = new Map<string, { until: number; taoDid: Promise<string> }>();

  /**
   * Whether the factory deployed a contract from a template and it is still active.
   * @param address - The contract.
   * @param template - The expected template id.
   * @returns Whether it was.
   */
  async function deployedFrom(address: string, template: string) {
    try {
      const info = await factory.getDeploymentInfo(address);
      return info.templateId === template && info.isActive === true;
    } catch {
      return false;
    }
  }

  /**
   * The TAO a registry serves, when it is a genuine pair's registry.
   * @param registry - The registry.
   * @returns The governance contract's TAO DID.
   * @throws UntrustedRegistry for anything else.
   */
  async function inspect(registry: string) {
    if (!(await deployedFrom(registry, expected.registry)))
      throw new UntrustedRegistry('The registry was not deployed from the registry template.');
    const governance = getAddress(
      await new Contract(registry, REGISTRY_ABI, provider).governance(),
    );
    if (!(await deployedFrom(governance, expected.governance)))
      throw new UntrustedRegistry('Its governance was not deployed from the governance template.');
    const reader = new Contract(governance, GOVERNANCE_ABI, provider);
    if (getAddress(await reader.certificateRegistry()) !== registry)
      throw new UntrustedRegistry('Its governance governs another registry.');
    return String(await reader.taoDid());
  }

  return {
    chainId,
    /**
     * Accept a registry only as the genuine registry of the given TAO.
     * @param contract - The registry a credential names.
     * @param taoDid - The TAO that accredited its issuer.
     * @returns Completion when it is that TAO's.
     * @throws UntrustedRegistry otherwise; RPC errors.
     */
    async trust(contract, taoDid) {
      if (!isAddress(contract)) throw new UntrustedRegistry('The registry is not an address.');
      const registry = getAddress(contract);
      let entry = recognised.get(registry);
      if (!entry || entry.until < Date.now()) {
        entry = { until: Date.now() + cacheMs, taoDid: inspect(registry) };
        recognised.set(registry, entry);
        // A failed inspection is asked again next time, not remembered.
        entry.taoDid.catch(() => recognised.delete(registry));
      }
      if ((await entry.taoDid) !== taoDid)
        throw new UntrustedRegistry(
          'The registry belongs to another TAO than the one that accredited the issuer.',
        );
    },
    /**
     * Read a record from a registry {@link CertificateRegistries.trust} accepted.
     * @param contract - The registry.
     * @param statusKey - The record's key.
     * @returns The record.
     */
    async status(contract, statusKey) {
      return new Contract(getAddress(contract), REGISTRY_ABI, provider).certificateStatus(
        statusKey,
      );
    },
  };
}
