// Recognising a TAO's certificate registry on the chain alone: EBSI's Proxy Factory deployed it
// and its governance from the registered templates, the two name each other, and the governance
// serves the TAO that accredited the certificate's TI. Each TAO has its own pair; the wallet keeps
// no list of them.
import { utils } from 'ethers'
import { registryTao, trustRegistry, UntrustedRegistry } from './index'

const FACTORY = '0x' + 'fa'.repeat(20)
const REGISTRY = '0x' + 'aa'.repeat(20)
const GOVERNANCE = '0x' + 'bb'.repeat(20)
const TAO = 'did:ebsi:zTao'

jest.mock('@infrastructure/config/Ebsi', () => ({
  ebsi: { isConfigured: () => true, ledger: () => 'http://ebsi.test/ledger' },
  certificates: {
    registry: () => '',
    factory: () => '0x' + 'fa'.repeat(20),
    templates: () => ({
      registry: { name: 'CertificateRegistry', version: '1' },
      governance: { name: 'CertificateGovernance', version: '1' },
    }),
    chainId: () => 1337,
  },
}))

const contracts = new utils.Interface([
  'function getDeploymentInfo(address) view returns (tuple(bytes32 templateId, address deployer, uint256 deploymentTimestamp, bool isActive, string deployerDID, address owner))',
  'function governance() view returns (address)',
  'function certificateRegistry() view returns (address)',
  'function taoDid() view returns (string)',
])
const templateId = (name: string) =>
  utils.keccak256(utils.defaultAbiCoder.encode(['string', 'string'], [name, '1']))

/** A chain where the factory deployed what `deployed` says, answering the wallet's eth_calls. */
const chain = (overrides: { deployed?: Record<string, string>; governed?: string; tao?: string; active?: boolean } = {}) => {
  const deployed = overrides.deployed ?? {
    [REGISTRY]: templateId('CertificateRegistry'),
    [GOVERNANCE]: templateId('CertificateGovernance'),
  }
  global.fetch = jest.fn(async (_url: any, init: any) => {
    const { to, data } = JSON.parse(init.body).params[0]
    const call = contracts.parseTransaction({ data })
    let result: string
    if (to === FACTORY && call.name === 'getDeploymentInfo') {
      const template = deployed[String(call.args[0]).toLowerCase()] ?? utils.hexZeroPad('0x', 32)
      result = contracts.encodeFunctionResult('getDeploymentInfo', [
        [template, FACTORY, 1, overrides.active ?? true, 'did:ebsi:zRoot', FACTORY],
      ])
    } else if (call.name === 'governance') result = contracts.encodeFunctionResult('governance', [GOVERNANCE])
    else if (call.name === 'certificateRegistry')
      result = contracts.encodeFunctionResult('certificateRegistry', [overrides.governed ?? REGISTRY])
    else if (call.name === 'taoDid') result = contracts.encodeFunctionResult('taoDid', [overrides.tao ?? TAO])
    else throw new Error(`unexpected call ${call.name} to ${to}`)
    return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result }) } as any
  }) as any
}

describe("a TAO's certificate registry", () => {
  it('is trusted for the TAO its governance serves', async () => {
    chain()
    await expect(registryTao(REGISTRY)).resolves.toBe(TAO)
    await expect(trustRegistry(REGISTRY, TAO)).resolves.toBeUndefined()
  })

  it("is not trusted for another TAO's TI", async () => {
    chain()
    await expect(trustRegistry(REGISTRY, 'did:ebsi:zOtherTao')).rejects.toBeInstanceOf(UntrustedRegistry)
  })

  it('is not trusted unless the factory deployed it from the registry template', async () => {
    const other = '0x' + 'ab'.repeat(20)
    chain()
    await expect(trustRegistry(other, TAO)).rejects.toBeInstanceOf(UntrustedRegistry)
  })

  it('is not trusted when its governance governs another registry', async () => {
    const registry = '0x' + 'ac'.repeat(20)
    chain({
      deployed: { [registry]: templateId('CertificateRegistry'), [GOVERNANCE]: templateId('CertificateGovernance') },
      governed: REGISTRY,
    })
    await expect(trustRegistry(registry, TAO)).rejects.toBeInstanceOf(UntrustedRegistry)
  })

  it('is not trusted once the factory deactivated it', async () => {
    const registry = '0x' + 'ad'.repeat(20)
    chain({
      deployed: { [registry]: templateId('CertificateRegistry'), [GOVERNANCE]: templateId('CertificateGovernance') },
      active: false,
    })
    await expect(trustRegistry(registry, TAO)).rejects.toBeInstanceOf(UntrustedRegistry)
  })
})
