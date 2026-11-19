// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
/**
 * EBSI's Ledger API, Core API v1: POST /v1/ledger, JSON-RPC to the network.
 *
 * Reads need no token. A write is a transaction the client encoded from the
 * registry's ABI and signed itself, sent as `eth_sendRawTransaction` with a
 * bearer token from /v1/auth/token; the token's scope must cover the target
 * registry and function, or, for a Trusted Contract (the certificate registry
 * and its governance), `ledger:invoke`. Errors follow the migration guide:
 * a missing or insufficient token is JSON-RPC -32600 at HTTP 200.
 */

import express from 'express';
import {Interface, Transaction, getAddress} from 'ethers';
import {REGISTRY_ABIS, SCOPE_FUNCTIONS} from './abis.js';
import {secp256k1Jwk, methodJwk, thumbprint} from './keys.js';

/** Methods any client may call. */
const READS = new Set([
  'eth_call',
  'eth_chainId',
  'eth_blockNumber',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_getTransactionCount',
  'eth_getBalance',
  'eth_getCode',
  'eth_getStorageAt',
  'eth_getLogs',
  'eth_estimateGas',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
  'eth_feeHistory',
  'eth_syncing',
  'net_version',
  'web3_clientVersion',
]);

/** What the pilot's Ledger API v4 forwards without a token (api-pilot.ebsi.eu/ledger/v4). */
const PILOT_READS = new Set([
  'eth_blockNumber',
  'eth_call',
  'eth_chainId',
  'eth_estimateGas',
  'eth_getBlockByHash',
  'eth_getBlockByNumber',
  'eth_getBlockReceipts',
  'eth_getCode',
  'eth_getLogs',
  'eth_getTransactionByHash',
  'eth_getTransactionCount',
  'eth_getTransactionReceipt',
  'net_version',
]);

const MAX_BATCH = 1024;

const rpcError = (id, code, message) => ({jsonrpc: '2.0', id: id ?? null, error: {code, message}});

/**
 * The Ledger API.
 * @param {object} config From readConfig.
 * @param {object} chain From connectChain.
 * @param {(token: string) => object|undefined} verifyToken From authorisation.
 * @returns {import('express').Router} The router.
 */
export function ledgerRouter(config, chain, verifyToken) {
  const registries = Object.fromEntries(
    Object.keys(REGISTRY_ABIS).map((name) => [getAddress(config.contracts[name]), {name, abi: new Interface(REGISTRY_ABIS[name])}]),
  );
  const invoke = new Set(config.invoke.map((address) => getAddress(address)));
  /**
   * Whether a ledger:invoke token may call a contract: a named Trusted Contract, EBSI's Proxy
   * Factory, or a contract it deployed (each TAO's certificate registry and governance).
   * @param {string} target The contract.
   * @returns {Promise<boolean>} Whether it is a Trusted Contract.
   */
  const trusted = async (target) => invoke.has(target) || (await chain.deployedByFactory(target));

  /**
   * Forward one request to the network as it is.
   * @param {object} request A JSON-RPC request.
   * @returns {Promise<object>} The network's response.
   */
  async function forward(request) {
    try {
      const upstream = await fetch(config.rpc, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: request.id ?? 1, method: request.method, params: request.params ?? []}),
        signal: AbortSignal.timeout(30_000),
      });
      const body = await upstream.json();
      return {...body, id: request.id ?? null};
    } catch (error) {
      return rpcError(request.id, -32603, `ledger unreachable: ${error.message ?? error}`);
    }
  }

  /**
   * Why a signed transaction may not go through with this token, if it may not.
   * @param {Transaction} tx The decoded transaction.
   * @param {object|undefined} claims The token's claims.
   * @returns {Promise<string|undefined>} The refusal.
   */
  async function refusal(tx, claims) {
    if (!claims) return 'missing or invalid access token';
    const scopes = String(claims.scope ?? '').split(' ');
    if (!tx.to) return 'contract creation is not offered by the Ledger API';
    const target = getAddress(tx.to);
    if (invoke.has(target)) return scopes.includes('ledger:invoke') ? undefined : 'missing scope ledger:invoke';
    const registry = registries[target];
    if (!registry) {
      if (await chain.deployedByFactory(target)) return scopes.includes('ledger:invoke') ? undefined : 'missing scope ledger:invoke';
      return `${target} is neither a registry nor a Trusted Contract`;
    }
    let call;
    try {
      call = registry.abi.parseTransaction({data: tx.data, value: tx.value});
    } catch {
      call = null;
    }
    if (!call) return 'unknown registry function';
    const allowed = Object.entries(SCOPE_FUNCTIONS[registry.name]).filter(([, functions]) => functions.includes(call.name));
    const granted = allowed.find(([scope]) => scopes.includes(scope));
    if (!granted) return `missing scope ${allowed.map(([scope]) => scope).join(' or ')} for ${call.name}`;
    if (call.name === 'insertDidDocument') {
      // The token's subject is the DID being registered, with the key it presented.
      if (call.args.did !== claims.sub) return 'insertDidDocument must register the token subject';
      const jwk = call.args.isSecp256k1 ? secp256k1Jwk(call.args.publicKey) : undefined;
      if (!jwk || thumbprint(jwk) !== claims.cnf?.jkt) return 'publicKey does not match the token cnf.jkt';
    }
    if (call.name === 'addVerificationMethod' || call.name === 'rollVerificationMethod') {
      const args = call.name === 'rollVerificationMethod' ? call.args.args : call.args;
      const jwk = methodJwk({publicKey: args.publicKey, isSecp256k1: args.isSecp256k1});
      if (!jwk || args.vMethodId !== thumbprint(jwk)) return 'vMethodId must be the RFC 7638 thumbprint of publicKey';
    }
    return undefined;
  }

  /**
   * Answer one JSON-RPC request.
   * @param {object} request The request.
   * @param {object|undefined} claims The bearer token's claims, if valid.
   * @returns {Promise<object>} The response.
   */
  async function answer(request, claims, pilot = false) {
    if (!request || typeof request !== 'object' || request.jsonrpc !== '2.0' || typeof request.method !== 'string')
      return rpcError(request?.id, -32600, 'invalid request');
    if ((pilot ? PILOT_READS : READS).has(request.method)) return forward(request);
    if (request.method !== 'eth_sendRawTransaction') return rpcError(request.id, -32601, `method ${request.method} not found`);
    let tx;
    try {
      tx = Transaction.from(request.params?.[0]);
    } catch {
      return rpcError(request.id, -32602, 'params[0] is not a signed transaction');
    }
    if (!tx.signature) return rpcError(request.id, -32602, 'the transaction is not signed');
    // The pilot's Ledger API takes Trusted Contract calls; registry writes go to each registry.
    if (pilot && tx.to && !(await trusted(getAddress(tx.to))))
      return rpcError(request.id, -32600, 'send registry transactions to the registry\'s JSON-RPC sendSignedTransaction');
    const why = await refusal(tx, claims);
    if (why) return rpcError(request.id, -32600, why);
    return forward(request);
  }

  /**
   * A registry's JSON-RPC on the pilot: `sendSignedTransaction` of a transaction signed by its
   * sender, under the scope's token. The transaction builders (`insertDidDocument`…) are not
   * offered: the back-office builds its transactions itself.
   * @param {string} registry The registry the endpoint is for (`didRegistry`, `issuersRegistry`).
   * @param {object} request The JSON-RPC request.
   * @param {object|undefined} claims The access token's claims.
   * @returns {Promise<object>} The JSON-RPC response.
   */
  async function registryCall(registry, request, claims) {
    if (!request || request.jsonrpc !== '2.0') return rpcError(request?.id, -32600, 'invalid request');
    if (request.method !== 'sendSignedTransaction')
      return rpcError(request.id, -32601, `method ${request.method} is not offered by the development service`);
    const params = request.params?.[0];
    let tx;
    try {
      tx = Transaction.from(params?.signedRawTransaction);
    } catch {
      return rpcError(request.id, -32602, 'signedRawTransaction is not a signed transaction');
    }
    const unsigned = params?.unsignedTransaction ?? {};
    if (
      params?.protocol !== 'eth' ||
      !tx.signature ||
      !tx.to ||
      getAddress(tx.to) !== getAddress(config.contracts[registry]) ||
      getAddress(unsigned.to ?? '0x0000000000000000000000000000000000000000') !== getAddress(tx.to) ||
      String(unsigned.data).toLowerCase() !== tx.data.toLowerCase() ||
      BigInt(unsigned.nonce ?? -1) !== BigInt(tx.nonce)
    )
      return rpcError(request.id, -32602, 'the signed transaction is not the unsigned one, or not to this registry');
    const why = await refusal(tx, claims);
    if (why) return rpcError(request.id, -32600, why);
    return forward({jsonrpc: '2.0', id: request.id, method: 'eth_sendRawTransaction', params: [params.signedRawTransaction]});
  }

  const router = express.Router();
  for (const [path, registry] of [
    ['/did-registry/v5/jsonrpc', 'didRegistry'],
    ['/trusted-issuers-registry/v5/jsonrpc', 'issuersRegistry'],
  ])
    router.post(path, express.json({limit: '4mb', type: () => true}), async (req, res, next) => {
      try {
        const bearer = /^Bearer (\S+)$/.exec(req.get('authorization') ?? '')?.[1];
        const claims = bearer ? verifyToken(bearer) : undefined;
        if (!claims)
          return res.status(401).type('application/problem+json').json({title: 'Unauthorized', status: 401, type: 'about:blank', detail: 'Invalid or missing JWT'});
        return res.json(await registryCall(registry, req.body, claims));
      } catch (error) {
        next(error);
      }
    });
  router.all(['/v1/ledger', '/ledger/v4/blockchains/besu'], express.json({limit: '4mb', type: () => true}), async (req, res, next) => {
    try {
      if (req.method !== 'POST') return res.set('allow', 'POST').status(405).end();
      const bearer = /^Bearer (\S+)$/.exec(req.get('authorization') ?? '')?.[1];
      const claims = bearer ? verifyToken(bearer) : undefined;
      const pilot = req.path.startsWith('/ledger/v4');
      const body = req.body;
      if (Array.isArray(body)) {
        if (!body.length) return res.json(rpcError(null, -32600, 'empty batch'));
        if (body.length > MAX_BATCH) return res.json(rpcError(null, -32005, 'batch too large'));
        const responses = await Promise.all(body.map((request) => answer(request, claims, pilot)));
        return res.json(responses.filter((_, index) => body[index]?.id !== undefined));
      }
      const response = await answer(body, claims, pilot);
      if (body?.id === undefined) return res.status(204).end();
      return res.json(response);
    } catch (error) {
      next(error);
    }
  });
  return router;
}
