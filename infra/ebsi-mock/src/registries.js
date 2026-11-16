// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
/**
 * The read side of EBSI's Core API v1 registries, answered from the registry
 * contracts on the ledger (hub.ebsi.eu/api/migration-guide):
 *
 *   /v1/did-registry/identifiers[/{did}]      DID documents, `valid-at` history
 *   /v1/issuers-registry/issuers[/{did}/...]  accreditations (attributes)
 *   /v1/schemas-registry/schemas[/{id}]       credential schemas
 *   /v1/timestamp/timestamps[/{id}]           timestamps
 *   /v1/<registry>/abi and /details           what a client encodes writes with
 *
 * Writes go through POST /v1/ledger (ledger.js), as on EBSI.
 */

import express from 'express';
import {getBytes, hexlify, isError, toUtf8Bytes, toUtf8String} from 'ethers';
import {ISSUER_TYPES} from './abis.js';

/** RFC 9457 problem, typed as EBSI types its problems. */
export function problem(res, status, type, title, detail) {
  return res
    .status(status)
    .type('application/problem+json')
    .json({type: type ? `urn:ebsi:problems:${type}` : 'about:blank', title, status, ...(detail ? {detail} : {})});
}

/**
 * The page a list request asks for: `page[after]` (1-based page number) and `page[size]` (at most 50).
 * @param {import('express').Request} req The request.
 * @returns {{page: number, size: number}} The page.
 */
function pageOf(req) {
  const size = Math.max(1, Math.min(Number(req.query['page[size]'] ?? 10) || 10, 50));
  const page = Math.max(1, Number(req.query['page[after]'] ?? 1) || 1);
  return {page, size};
}

/**
 * EBSI's list shape.
 * @param {string} self The collection's URL without its query.
 * @param {{page: number, size: number}} page Requested page.
 * @param {bigint} total Items in the collection.
 * @param {object[]} items This page's items.
 * @returns {object} `{self, items, total, pageSize, links}`.
 */
function list(self, {page, size}, total, items) {
  const last = Math.max(1, Math.ceil(Number(total) / size));
  const link = (n) => `${self}?page[after]=${n}&page[size]=${size}`;
  return {
    self: link(page),
    items,
    total: Number(total),
    pageSize: size,
    links: {first: link(1), prev: link(Math.max(1, page - 1)), next: link(Math.min(last, page + 1)), last: link(last)},
  };
}

/** A path parameter decoded once, as Express hands it over still encoded for `:` in DIDs. */
const param = (value) => decodeURIComponent(String(value));

/** Unix seconds of a `valid-at` (date or date-time), or undefined for none. */
function validAt(value) {
  if (value === undefined) return undefined;
  const ms = Date.parse(String(value));
  return Number.isNaN(ms) ? NaN : Math.floor(ms / 1000);
}

/**
 * Mount the registries' read API.
 * @param {object} chain From connectChain.
 * @param {object} config From readConfig.
 * @returns {import('express').Router} The router.
 */
export function registriesRouter(chain, config) {
  const router = express.Router();
  const {contracts} = chain;
  const base = `${config.base}/v1`;

  const describe = (name, contract, linked) => {
    router.get(`/v1/${name}/abi`, (_req, res) =>
      res.json({contractAddress: contract.target, abi: JSON.parse(contract.interface.formatJson())}),
    );
    router.get(`/v1/${name}/details`, (_req, res) => res.json({contractAddress: contract.target, ...linked}));
  };
  describe('did-registry', contracts.didRegistry, {policyRegistryContract: contracts.policiesRegistry.target});
  describe('issuers-registry', contracts.issuersRegistry, {
    didRegistryContract: contracts.didRegistry.target,
    policyRegistryContract: contracts.policiesRegistry.target,
  });
  describe('schemas-registry', contracts.schemasRegistry, {policyRegistryContract: contracts.policiesRegistry.target});
  describe('timestamp', contracts.timestamp, {policyRegistryContract: contracts.policiesRegistry.target});

  router.get('/v1/contracts-registry/contracts', (_req, res) =>
    res.json({items: config.invoke.map((address) => ({contractAddress: address})), total: config.invoke.length}),
  );

  // --- DID Registry ----------------------------------------------------------

  router.get('/v1/did-registry/identifiers', async (req, res, next) => {
    try {
      const page = pageOf(req);
      const result = await contracts.didRegistry.getDids(page.page, page.size);
      const self = `${base}/did-registry/identifiers`;
      res.json(list(self, page, result.total, result.items.map((did) => ({did, href: `${self}/${did}`}))));
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/did-registry/identifiers/:did', async (req, res, next) => {
    try {
      const did = param(req.params.did);
      const at = validAt(req.query['valid-at']);
      if (Number.isNaN(at)) return problem(res, 400, 'invalid-parameter', 'Bad Request', 'valid-at is not a date or date-time');
      const document = await chain.didDocument(did, at);
      if (!document) return problem(res, 404, 'did-not-found', 'Not Found', `${did} is not in the DID Registry`);
      // Exactly application/did+json: the form without @context; anything else
      // the JSON-LD form, as Core API v1 negotiates it.
      if (req.get('accept') === 'application/did+json') {
        const {'@context': _context, ...plain} = document;
        return res.type('application/did+json').send(JSON.stringify(plain));
      }
      return res.type('application/did+ld+json').send(JSON.stringify(document));
    } catch (error) {
      next(error);
    }
  });

  // --- Trusted Issuers Registry ----------------------------------------------

  const issuers = `${base}/issuers-registry/issuers`;

  router.get('/v1/issuers-registry/issuers', async (req, res, next) => {
    try {
      const page = pageOf(req);
      const result = await contracts.issuersRegistry.getIssuers(page.page, page.size);
      res.json(list(issuers, page, result.total, result.items.map((did) => ({did, href: `${issuers}/${did}`}))));
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/issuers-registry/issuers/:did', async (req, res, next) => {
    try {
      const did = param(req.params.did);
      const ids = await chain.issuerAttributes(did);
      if (!ids) return problem(res, 404, 'issuer-not-found', 'Not Found', `${did} is not in the Trusted Issuers Registry`);
      // The current TIR shape: a link to the attributes, not the attributes.
      return res.json({did, attributes: `${issuers}/${did}/attributes`, hasAttributes: ids.length > 0});
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/issuers-registry/issuers/:did/attributes', async (req, res, next) => {
    try {
      const did = param(req.params.did);
      const page = pageOf(req);
      let result;
      try {
        result = await contracts.issuersRegistry.getIssuerAttributes(did, page.page, page.size);
      } catch (error) {
        if (isError(error, 'CALL_EXCEPTION'))
          return problem(res, 404, 'issuer-not-found', 'Not Found', `${did} is not in the Trusted Issuers Registry`);
        throw error;
      }
      const self = `${issuers}/${did}/attributes`;
      res.json(list(self, page, result.total, result.items.map((id) => ({id, href: `${self}/${id}`}))));
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/issuers-registry/issuers/:did/attributes/:attributeId', async (req, res, next) => {
    try {
      const did = param(req.params.did);
      const id = String(req.params.attributeId);
      if (!/^0x[0-9a-fA-F]{64}$/.test(id))
        return problem(res, 400, 'invalid-parameter', 'Bad Request', 'An attribute id is 32 bytes of hex');
      const attribute = await chain.attribute(did, id);
      if (!attribute) return problem(res, 404, 'attribute-not-found', 'Not Found', `No attribute ${id} of ${did}`);
      return res.json({
        did,
        attribute: {
          hash: attribute.attributeId,
          body: attribute.attribData === '0x' ? '' : toUtf8String(attribute.attribData),
          issuerType: ISSUER_TYPES[Number(attribute.issuerType)] ?? 'Undefined',
          tao: attribute.tao,
          rootTao: attribute.rootTao,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/issuers-registry/issuers/:did/attributes/:attributeId/revisions', async (req, res, next) => {
    try {
      const did = param(req.params.did);
      const page = pageOf(req);
      let result;
      try {
        result = await contracts.issuersRegistry.getIssuerAttributeRevisions(did, req.params.attributeId, page.page, page.size);
      } catch (error) {
        if (isError(error, 'CALL_EXCEPTION')) return problem(res, 404, 'attribute-not-found', 'Not Found');
        throw error;
      }
      const self = `${issuers}/${did}/attributes/${req.params.attributeId}/revisions`;
      res.json(list(self, page, result.total, result.items.map((id) => ({id, href: `${self}/${id}`}))));
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/issuers-registry/issuers/:did/proxies', async (req, res, next) => {
    try {
      const did = param(req.params.did);
      const page = pageOf(req);
      let result;
      try {
        result = await contracts.issuersRegistry.getIssuerProxies(did, page.page, page.size);
      } catch (error) {
        if (isError(error, 'CALL_EXCEPTION')) return problem(res, 404, 'issuer-not-found', 'Not Found');
        throw error;
      }
      const self = `${issuers}/${did}/proxies`;
      res.json(list(self, page, result.total, result.items.map((id) => ({proxyId: id, href: `${self}/${id}`}))));
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/issuers-registry/issuers/:did/proxies/:proxyId', async (req, res, next) => {
    try {
      const data = await contracts.issuersRegistry.getIssuerProxyById(param(req.params.did), req.params.proxyId);
      res.json(JSON.parse(data));
    } catch (error) {
      if (isError(error, 'CALL_EXCEPTION')) return problem(res, 404, 'proxy-not-found', 'Not Found');
      next(error);
    }
  });

  // --- Trusted Schemas Registry ----------------------------------------------

  const schemas = `${base}/schemas-registry/schemas`;

  router.get('/v1/schemas-registry/schemas', async (req, res, next) => {
    try {
      const page = pageOf(req);
      const result = await contracts.schemasRegistry.getSchemaIds(page.page, page.size);
      res.json(
        list(
          schemas,
          page,
          result.total,
          result.items.map((bytes) => {
            const schemaId = toUtf8String(bytes);
            return {schemaId, href: `${schemas}/${schemaId}`};
          }),
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/schemas-registry/schemas/:schemaId', async (req, res, next) => {
    try {
      const id = hexlify(toUtf8Bytes(param(req.params.schemaId)));
      let schema;
      try {
        schema = await contracts.schemasRegistry.getLatestSchemaRevision(id);
      } catch (error) {
        if (isError(error, 'CALL_EXCEPTION')) return problem(res, 404, 'schema-not-found', 'Not Found');
        throw error;
      }
      res.type('application/json').send(toUtf8String(schema));
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/schemas-registry/schemas/:schemaId/revisions', async (req, res, next) => {
    try {
      const id = hexlify(toUtf8Bytes(param(req.params.schemaId)));
      const page = pageOf(req);
      let result;
      try {
        result = await contracts.schemasRegistry.getSchemaRevisionIds(id, page.page, page.size);
      } catch (error) {
        if (isError(error, 'CALL_EXCEPTION')) return problem(res, 404, 'schema-not-found', 'Not Found');
        throw error;
      }
      const self = `${schemas}/${param(req.params.schemaId)}/revisions`;
      res.json(list(self, page, result.total, result.items.map((revisionId) => ({revisionId, href: `${self}/${revisionId}`}))));
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/schemas-registry/schemas/:schemaId/revisions/:revisionId', async (req, res, next) => {
    try {
      const id = hexlify(toUtf8Bytes(param(req.params.schemaId)));
      const schema = await contracts.schemasRegistry.getSchemaRevision(id, req.params.revisionId);
      res.type('application/json').send(toUtf8String(schema));
    } catch (error) {
      if (isError(error, 'CALL_EXCEPTION')) return problem(res, 404, 'revision-not-found', 'Not Found');
      next(error);
    }
  });

  // --- Timestamp ---------------------------------------------------------------

  const timestamp = (id, [hash, timestampedBy, blockNumber, data]) => ({
    timestampId: id,
    hash: {algorithm: Number(hash.algorithm), value: hash.value},
    timestampedBy,
    blockNumber: Number(blockNumber),
    data,
  });

  router.get('/v1/timestamp/timestamps', async (req, res, next) => {
    try {
      const page = pageOf(req);
      const result = await contracts.timestamp.getTimestamps(page.page, page.size);
      const self = `${base}/timestamp/timestamps`;
      res.json(list(self, page, result.total, result.items.map((id) => ({timestampId: id, href: `${self}/${id}`}))));
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/timestamp/timestamps/:timestampId', async (req, res, next) => {
    try {
      const id = String(req.params.timestampId);
      if (!/^0x[0-9a-fA-F]{64}$/.test(id)) return problem(res, 400, 'invalid-parameter', 'Bad Request');
      const result = await contracts.timestamp.getTimestampById(id);
      if (Number(result[2]) === 0) return problem(res, 404, 'timestamp-not-found', 'Not Found');
      res.json(timestamp(id, result));
    } catch (error) {
      if (isError(error, 'CALL_EXCEPTION')) return problem(res, 404, 'timestamp-not-found', 'Not Found');
      next(error);
    }
  });

  router.get('/v1/timestamp/hashes/:hashValue', async (req, res, next) => {
    try {
      const value = String(req.params.hashValue);
      if (!/^0x[0-9a-fA-F]{2,256}$/.test(value)) return problem(res, 400, 'invalid-parameter', 'Bad Request');
      const result = await contracts.timestamp.getTimestamp(getBytes(value));
      if (Number(result[2]) === 0) return problem(res, 404, 'timestamp-not-found', 'Not Found');
      res.json(timestamp(undefined, result));
    } catch (error) {
      if (isError(error, 'CALL_EXCEPTION')) return problem(res, 404, 'timestamp-not-found', 'Not Found');
      next(error);
    }
  });

  return router;
}
