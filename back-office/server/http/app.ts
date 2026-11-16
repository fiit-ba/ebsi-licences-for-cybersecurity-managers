import { jsonBody, maxJsonBytes, maxLoginBytes, readBody } from './body.ts';
import { send, sendRequestObject } from './response.ts';
import { OperatorManagementError } from '../identity/administration/management-error.ts';
import { CredentialVerificationError } from '../verification/credential.ts';
import { IssuanceError } from '../issuance/claims.ts';
import { IssuanceInputError } from '../issuance/input.ts';
import { issuanceScheme } from '../issuance/schemes.ts';
import { SchemaError } from '../schemas/definition.ts';
import { canManageSchemas } from '../schemas/management.ts';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { accreditationRefusal, organizationProfile } from '../accreditation/profile.ts';
import { AccreditationError } from '../accreditation/invitations.ts';
import { passwordMatches } from '../identity/auth/passwords.ts';
import { passwordPolicyCodes } from '../identity/auth/password-policy.ts';
import type { BackOfficeServerOptions } from './types.ts';
import type { OperatorAccount } from '../identity/auth/accounts.ts';
import { PasswordRecoveryError } from '../identity/recovery/password-recovery.ts';
import { clientAddress } from './client-address.ts';
import { trimIdentityField } from '../identity/input-text.ts';
import { verifierRefusal } from '../verification/http.ts';

const schemaCommands = new Map<
  string,
  { method: 'propose' | 'confirm' | 'retire'; status: number }
>([
  ['/registry/schemas/', { method: 'propose', status: 201 }],
  ['/registry/schemas/confirm/', { method: 'confirm', status: 200 }],
  ['/registry/schemas/retire/', { method: 'retire', status: 200 }],
]);
const statusDecisions = new Map<string, 'approved' | 'rejected'>([
  ['/registry/approve/', 'approved'],
  ['/registry/reject/', 'rejected'],
]);
const trustChainCommands = new Map<
  string,
  { method: 'select' | 'renew' | 'setLifespan' | 'revoke' | 'setSchemas'; status: number }
>([
  ['/registry/trust-chain/select/', { method: 'select', status: 201 }],
  ['/registry/trust-chain/invitation/', { method: 'renew', status: 200 }],
  ['/registry/trust-chain/lifespan/', { method: 'setLifespan', status: 200 }],
  ['/registry/trust-chain/revoke/', { method: 'revoke', status: 200 }],
  ['/registry/trust-chain/schemas/', { method: 'setSchemas', status: 200 }],
]);

/**
 * Create the Back Office HTTP server with explicitly enabled domain adapters.
 *
 * @param options - Account/token services, optional domain/static handlers, registration flag,
 * readiness and error reporter.
 * @returns A Node HTTP server; the caller owns listen and shutdown.
 */
export function backOfficeServer(options: BackOfficeServerOptions) {
  const {
    walletBackups,
    accounts,
    tokens,
    passwordRecovery,
    trustedProxyHops = 0,
    loginThrottle,
    operatorManagement = undefined,
    schemaCatalog = undefined,
    schemaManagement = undefined,
    issuanceSchemes = undefined,
    issuer = undefined,
    presentations = undefined,
    verification,
    consoleVerifierName = 'Atest · Register odbornej spôsobilosti',
    listCertificates = undefined,
    notifications = undefined,
    statusProposals = undefined,
    emergencySuspend = undefined,
    audit = undefined,
    listAnchors = undefined,
    invitations = undefined,
    trustChain = undefined,
    accreditation,
    consoleAssets = undefined,
    registrationEnabled = true,
    registrationThrottle,
    governanceProfile = { contract: '', consoleRoles: ['A', 'B'] },
    governance,
    ready = undefined,
    reportError = console.error,
  } = options;
  if (!Number.isSafeInteger(trustedProxyHops) || trustedProxyHops < 0 || trustedProxyHops > 8)
    throw new Error('Configure zero to eight trusted proxy hops.');

  /**
   * Dispatch one request with current authentication, role checks and bounded parsing.
   *
   * @param request - Incoming HTTP request.
   * @param response - Response receiving JSON, protocol or console content.
   * @returns Completion after dispatch and response handling.
   * @throws Domain, database, adapter or stream errors; the outer server boundary converts refusals
   * and failures to HTTP responses.
   */
  async function handle(request: IncomingMessage, response: ServerResponse) {
    if (request.url?.startsWith('/api-backend/'))
      request.url = request.url.slice('/api-backend'.length);
    const path = request.url!.split('?')[0];
    if (walletBackups && (await walletBackups(request, response, path))) return;
    if (
      passwordRecovery &&
      request.method === 'POST' &&
      [
        '/api/password_reset/',
        '/api/password_reset/validate_token/',
        '/api/password_reset/confirm/',
      ].includes(path)
    ) {
      const input = await jsonBody(
        request,
        path === '/api/password_reset/confirm/' ? maxLoginBytes : maxJsonBytes,
      );
      if (input.status) return send(response, input.status, input.body);
      const result =
        path === '/api/password_reset/'
          ? await passwordRecovery.requestReset(
              input.body,
              clientAddress(request, trustedProxyHops),
            )
          : path === '/api/password_reset/validate_token/'
            ? await passwordRecovery.validateToken(input.body)
            : await passwordRecovery.confirmReset(input.body);
      return send(response, 200, result);
    }
    if (consoleAssets && path === '/console/config.json' && request.method === 'GET') {
      return send(response, 200, {
        registration_available: Boolean(registrationEnabled && invitations),
      });
    }
    if (consoleAssets?.(request, response)) return;
    if (verification && (await verification.publicHttp(request, response, path))) return;

    if (presentations && request.method === 'GET') {
      if (path === '/auth/jwks')
        return send(response, 200, {
          keys: [...(issuer ? await issuer.authorizationKeys() : []), ...presentations!.jwks.keys],
        });
      const state = /^\/presentation-requests\/([A-Za-z0-9_-]{43})$/.exec(path)?.[1];
      if (state) {
        const jwt = await presentations!.requestObject(state);
        return jwt
          ? sendRequestObject(response, jwt)
          : send(response, 404, { error: 'invalid_request' });
      }
    }
    if (presentations && path === '/auth/direct_post' && request.method === 'POST') {
      const input = await readBody(request, 'application/x-www-form-urlencoded', 768 * 1024);
      if (input.status) return send(response, input.status, { error: 'invalid_request' });
      const params = new URLSearchParams(input.text);
      // OpenID4VP 1.0: state and a JSON vp_token; a presentation_submission is the draft's.
      if (
        ['state', 'vp_token'].some((key) => params.getAll(key).length !== 1) ||
        params.has('presentation_submission')
      ) {
        return send(response, 400, { error: 'invalid_request' });
      }
      try {
        const accepted = await presentations!.submit(Object.fromEntries(params));
        return accepted
          ? send(response, 200, {})
          : send(response, 400, { error: 'invalid_request' });
      } catch (error) {
        if (error instanceof CredentialVerificationError) {
          return send(response, 400, { error: 'invalid_vp_token', error_description: error.code });
        }
        throw error;
      }
    }

    if (issuer && request.method === 'GET') {
      if (path === '/auth/jwks')
        return send(response, 200, { keys: await issuer.authorizationKeys() });
      if (path === '/.well-known/openid-credential-issuer')
        return send(response, 200, await issuer!.metadata());
      if (
        [
          '/.well-known/oauth-authorization-server',
          '/.well-known/openid-configuration',
          '/auth/.well-known/openid-configuration',
        ].includes(path)
      )
        return send(response, 200, issuer!.authorizationMetadata);
      const code = /^\/offers\/([A-Za-z0-9_-]{43})\/?$/.exec(path)?.[1];
      if (code) {
        const offer = await issuer!.registration.offer(code);
        return offer ? send(response, 200, offer) : send(response, 404, { error: 'invalid_offer' });
      }
    }
    // OpenID4VCI 1.0 Nonce Endpoint: a fresh c_nonce for the credential request's key proof.
    if (issuer && path === '/nonce' && request.method === 'POST') {
      const { nonce } = await issuer!.nonces.issue();
      response.setHeader('cache-control', 'no-store');
      return send(response, 200, { c_nonce: nonce });
    }
    if (issuer && path === '/auth/token' && request.method === 'POST') {
      const input = await readBody(request, 'application/x-www-form-urlencoded', maxJsonBytes);
      if (input.status) return send(response, input.status, { error: 'invalid_request' });
      const params = new URLSearchParams(input.text);
      if ([...params.keys()].some((key) => params.getAll(key).length > 1)) {
        return send(response, 400, { error: 'invalid_request' });
      }
      const result = await issuer!.tokens.exchange(Object.fromEntries(params));
      return send(response, result.status, result.body);
    }
    if (issuer && ['/credentials', '/credentials/'].includes(path) && request.method === 'POST') {
      const input = await jsonBody(request, 12 * 1024);
      if (input.status) return send(response, input.status, { error: 'invalid_request' });
      const token = /^Bearer (\S+)$/.exec(request.headers.authorization ?? '')?.[1];
      const result = await issuer!.redemption.redeem(token, input.body);
      if (result.status === 401)
        response.setHeader('www-authenticate', 'Bearer error="invalid_token"');
      return send(response, result.status, result.body);
    }

    if (path === '/health/ready' && request.method === 'GET') {
      await ready!();
      return send(response, 200, { status: 'ready' });
    }

    if (schemaCatalog && path === '/registry/schema-names/' && request.method === 'GET') {
      return send(response, 200, { schemas: await schemaCatalog!.names() });
    }

    if (path === '/api/api-token-auth' && request.method === 'POST') {
      const retry =
        loginThrottle && (await loginThrottle(clientAddress(request, trustedProxyHops)));
      if (retry) {
        response.setHeader('retry-after', String(retry));
        return send(response, 429, { detail: 'Request was throttled.' });
      }
      const input = await jsonBody(request, maxLoginBytes);
      if (input.status) return send(response, input.status, input.body);
      const { username: suppliedUsername, password } = input.body;
      const username =
        typeof suppliedUsername === 'string' ? trimIdentityField(suppliedUsername) : '';
      if (!username || typeof password !== 'string' || !password) {
        return send(response, 400, { detail: 'Username and password are required.' });
      }
      const account = await accounts.byUsername(username);
      const valid =
        (await passwordMatches(password, account?.password_hash)) &&
        !!account &&
        passwordPolicyCodes(password, {
          username: account.username,
          email: account.email,
          firstName: account.first_name,
          lastName: account.last_name,
        }).length === 0;
      const refusal = valid && accreditationRefusal(account);
      if (refusal) return send(response, 401, refusal);
      if (!valid || !account?.active) {
        return send(response, 401, {
          detail: 'No active account found with the given credentials',
        });
      }
      return send(response, 200, {
        ...(await tokens.pair(account)),
        user_id: account.id,
        username: account.username,
        email: account.email,
      });
    }

    if (
      path === '/organizations/v1/registrations/' &&
      request.method === 'POST' &&
      registrationEnabled &&
      invitations
    ) {
      const retry =
        registrationThrottle &&
        (await registrationThrottle(clientAddress(request, trustedProxyHops)));
      if (retry) {
        response.setHeader('retry-after', String(retry));
        return send(response, 429, { detail: 'Request was throttled.' });
      }
      const input = await jsonBody(request);
      if (input.status) return send(response, input.status, input.body);
      return send(response, 201, await invitations!.register(input.body));
    }

    const manageAccounts =
      operatorManagement &&
      path === '/admin/accounts/' &&
      ['GET', 'POST'].includes(request.method!);
    const staffOptions =
      operatorManagement && path === '/admin/accounts/options/' && request.method === 'GET';
    const staffAccount =
      operatorManagement && request.method === 'GET'
        ? /^\/admin\/accounts\/([1-9]\d{0,9})\/$/.exec(path)
        : null;
    const deleteAccount =
      operatorManagement && path === '/admin/accounts/delete/' && request.method === 'POST';
    const changePassword =
      operatorManagement && path === '/admin/password-change/' && request.method === 'POST';
    const groupRoute = operatorManagement
      ? /^\/admin\/groups\/(options\/|[1-9]\d{0,9}\/|delete\/)?$/.exec(path)
      : null;
    const manageGroups = groupRoute && ['GET', 'POST'].includes(request.method!);
    const profile = path === '/registry/me/' && request.method === 'GET';
    const notificationList =
      notifications && path === '/registry/notifications/' && request.method === 'GET';
    const command =
      invitations && request.method === 'POST' ? trustChainCommands.get(path) : undefined;
    const readChain = trustChain && path === '/registry/trust-chain/' && request.method === 'GET';
    const accreditationState =
      accreditation && path === '/registry/accreditation/' && request.method === 'GET';
    const listSchemas =
      schemaManagement && path === '/registry/schemas/' && request.method === 'GET';
    const schemaCommand =
      schemaManagement && request.method === 'POST' ? schemaCommands.get(path) : undefined;
    const certificateScheme =
      issuanceSchemes && path === '/registry/certificate-scheme/' && request.method === 'GET';
    const issue = issuer && path === '/registry/issue/' && request.method === 'POST';
    const reoffer = issuer && path === '/registry/reoffer/' && request.method === 'POST';
    const presentationOffer =
      (presentations || verification) &&
      path === '/registry/presentation-offer/' &&
      request.method === 'GET';
    const presentationResult =
      (presentations || verification) &&
      path === '/registry/presentation-result/' &&
      request.method === 'GET';
    const presentationExchange =
      verification && path === '/registry/presentation-exchange/' && request.method === 'POST';
    const certificates =
      listCertificates && path === '/registry/certificates/' && request.method === 'GET';
    const proposals =
      statusProposals && path === '/registry/proposals/' && request.method === 'GET';
    const propose = statusProposals && path === '/registry/propose/' && request.method === 'POST';
    const decision =
      statusProposals && request.method === 'POST' ? statusDecisions.get(path) : undefined;
    const withdraw = statusProposals && path === '/registry/withdraw/' && request.method === 'POST';
    const emergency =
      emergencySuspend && request.method === 'POST' && path === '/registry/emergency-suspend/';
    const auditLog = audit && request.method === 'GET' && path === '/registry/audit/';
    const governanceRoute =
      governance && /^\/registry\/governance\/(roles|vote|admin|admin\/check|sync)\/$/.exec(path);
    const anchors = listAnchors && request.method === 'GET' && path === '/registry/anchors/';
    const auditDisclosure =
      audit &&
      request.method === 'POST' &&
      ['/registry/audit/commitment-preimage/', '/registry/audit/reason-preimage/'].includes(path);
    if (
      manageAccounts ||
      staffOptions ||
      staffAccount ||
      deleteAccount ||
      changePassword ||
      manageGroups ||
      proposals ||
      propose ||
      decision ||
      withdraw ||
      profile ||
      notificationList ||
      command ||
      readChain ||
      accreditationState ||
      listSchemas ||
      schemaCommand ||
      certificateScheme ||
      certificates ||
      issue ||
      reoffer ||
      presentationOffer ||
      presentationResult ||
      presentationExchange ||
      emergency ||
      auditLog ||
      auditDisclosure ||
      anchors ||
      governanceRoute
    ) {
      const token = /^Bearer (\S+)$/.exec(request.headers.authorization ?? '')?.[1];
      const id = token && (await tokens.accountId(token));
      const account = (id && (await accounts.byId(id))) as OperatorAccount | undefined;
      const refusal = accreditationRefusal(account);
      if (refusal) return send(response, 401, refusal);
      if (!account?.active || (await tokens.accountId(token, account.auth_version ?? 0)) !== id) {
        return send(response, 401, {
          code: 'token_not_valid',
          detail: 'A valid access token is required.',
        });
      }
      if (notificationList) return send(response, 200, await notifications!(account.id));
      if (governanceRoute) {
        const operation = governanceRoute[1];
        if (operation === 'roles' && request.method === 'GET')
          return send(response, 200, await governance!.roles(account.id));
        if (operation !== 'roles' && request.method === 'POST') {
          const input = await jsonBody(request);
          if (input.status) return send(response, input.status, input.body);
          if (operation === 'vote') {
            const result = await governance!.vote(account.id, input.body);
            return send(response, result.status, result.body);
          }
          if (operation === 'admin')
            return send(response, 200, await governance!.admin(account.id, input.body));
          if (operation === 'admin/check')
            return send(response, 200, await governance!.check(input.body));
          return send(response, 200, await governance!.sync(input.body));
        }
        return send(response, 405, { detail: 'Method not allowed.' });
      }
      if (changePassword) {
        const input = await jsonBody(request, maxLoginBytes);
        if (input.status) return send(response, input.status, input.body);
        return send(
          response,
          200,
          await operatorManagement!.changePassword(account.id, input.body, account.auth_version),
        );
      }
      if (deleteAccount) {
        const input = await jsonBody(request);
        if (input.status) return send(response, input.status, input.body);
        return send(
          response,
          200,
          await operatorManagement!.staff.remove(account.id, input.body, account.auth_version),
        );
      }
      if (manageGroups) {
        const groups = operatorManagement!.groups;
        const tail = groupRoute![1];
        if (request.method === 'GET') {
          if (tail === 'options/') return send(response, 200, await groups.options(account.id));
          if (tail && tail !== 'delete/')
            return send(response, 200, await groups.read(account.id, Number(tail.slice(0, -1))));
          if (!tail)
            return send(
              response,
              200,
              await groups.list(
                account.id,
                new URL(request.url!, 'http://back-office.invalid').searchParams,
              ),
            );
        } else if (!tail || tail === 'delete/') {
          const input = await jsonBody(request, 128 * 1024);
          if (input.status) return send(response, input.status, input.body);
          return send(
            response,
            !tail && input.body.group_id === undefined ? 201 : 200,
            await groups.save(account.id, input.body, tail === 'delete/', account.auth_version),
          );
        }
        return send(response, 404, { detail: 'Unknown administration operation.' });
      }
      if (staffOptions)
        return send(response, 200, await operatorManagement!.staff.options(account.id));
      if (staffAccount) {
        const target = Number(staffAccount[1]);
        if (target > 2147483647)
          return send(response, 404, { detail: 'Unknown operator account.' });
        return send(response, 200, await operatorManagement!.staff.read(account.id, target));
      }
      if (manageAccounts) {
        if (!account.roles.includes('plr_admin') && !account.is_staff) {
          return send(response, 403, {
            reason: 'AdministratorRequired',
            detail: 'An administrator role is required.',
          });
        }
        if (request.method === 'GET') {
          const query = new URL(request.url!, 'http://back-office.invalid').searchParams;
          return send(response, 200, await operatorManagement!.list(account.id, query));
        }
        const input = await jsonBody(request, maxLoginBytes);
        if (input.status) return send(response, input.status, input.body);
        return send(
          response,
          input.body.account_id === undefined ? 201 : 200,
          account.roles.includes('plr_admin') && input.body.roles !== undefined
            ? await operatorManagement!.save(account.id, input.body, account.auth_version)
            : await operatorManagement!.staff.save(account.id, input.body, account.auth_version),
        );
      }
      if (auditLog || auditDisclosure || anchors) {
        if (!account.roles.includes('plr_auditor')) {
          return send(response, 403, {
            reason: 'RoleRequired',
            detail: 'This needs one of these roles: plr_auditor.',
          });
        }
        if (anchors)
          return send(
            response,
            200,
            await listAnchors!(
              account.id,
              new URL(request.url!, 'http://back-office.invalid').searchParams,
            ),
          );
        if (auditLog)
          return send(
            response,
            200,
            await audit!.list(
              account.id,
              new URL(request.url!, 'http://back-office.invalid').searchParams,
            ),
          );
        const input = await jsonBody(request);
        if (input.status) return send(response, input.status, input.body);
        const method =
          path === '/registry/audit/commitment-preimage/' ? 'commitmentPreimage' : 'reasonPreimage';
        return send(response, 200, await audit![method](account.id, input.body));
      }
      if (emergency) {
        if (
          !['plr_status_manager', 'plr_tao', 'plr_rtao'].some((role) =>
            account.roles.includes(role),
          )
        ) {
          return send(response, 403, {
            reason: 'RoleRequired',
            detail: 'This needs one of these roles: plr_status_manager, plr_tao, plr_rtao.',
          });
        }
        const input = await jsonBody(request);
        if (input.status) return send(response, input.status, input.body);
        return send(response, 200, await emergencySuspend!(account.id, input.body));
      }
      if (proposals || propose || decision || withdraw) {
        if (
          !account.roles.includes('plr_status_manager') &&
          !(proposals && account.roles.includes('plr_auditor'))
        ) {
          return send(response, 403, {
            reason: 'RoleRequired',
            detail: 'This needs one of these roles: plr_status_manager.',
          });
        }
        if (proposals) {
          const query = new URL(request.url!, 'http://back-office.invalid').searchParams;
          return send(response, 200, await statusProposals!.list(account.id, query));
        }
        const input = await jsonBody(request);
        if (input.status) return send(response, input.status, input.body);
        if (propose)
          return send(response, 201, await statusProposals!.propose(account.id, input.body));
        if (withdraw)
          return send(response, 200, await statusProposals!.withdraw(account.id, input.body));
        return send(
          response,
          200,
          await statusProposals!.decide(account.id, input.body.proposal_id, decision!),
        );
      }
      if (certificates) {
        const roles = ['plr_issuer', 'plr_status_manager', 'plr_auditor', 'plr_tao', 'plr_rtao'];
        if (!roles.some((role) => account.roles.includes(role))) {
          return send(response, 403, {
            reason: 'RoleRequired',
            detail:
              'This needs one of these roles: plr_issuer, plr_status_manager, plr_auditor, plr_tao, plr_rtao.',
          });
        }
        const query = new URL(request.url!, 'http://back-office.invalid').searchParams;
        return send(response, 200, await listCertificates!(account.id, query));
      }
      if (presentationOffer || presentationResult || presentationExchange) {
        if (!account.roles.includes('plr_verifier')) {
          return send(response, 403, {
            reason: 'RoleRequired',
            detail: 'A verifier role is required.',
          });
        }
        const query = new URL(request.url!, 'http://back-office.invalid').searchParams;
        if (verification) {
          if (presentationExchange) {
            const input = await jsonBody(request, 96 * 1024);
            if (input.status) return send(response, input.status, input.body);
            return send(
              response,
              201,
              await verification.service.exchange.start(
                input.body.invitation,
                { operator: account.id },
                consoleVerifierName,
                input.body.fields,
              ),
            );
          }
          if (presentationOffer) {
            const offer = await verification.service.offer(
              { operator: account.id },
              query.get('scope') ?? undefined,
            );
            return send(response, 200, { offer_uri: offer.request_uri, state: offer.state });
          }
          const result = await verification.service.read(query.get('state') ?? '', {
            operator: account.id,
          });
          // The console returns only progress before completion.
          return send(response, 200, 'outcome' in result ? result : { status: result.status });
        }
        const result = presentationOffer
          ? await presentations!.offer(account.id, query.get('scope'))
          : await presentations!.result(account.id, query.get('state'));
        return result
          ? send(response, 200, result)
          : send(response, 404, { detail: 'Presentation request not found.' });
      }
      if (issue || reoffer) {
        if (!account.roles.includes('plr_issuer')) {
          return send(response, 403, {
            reason: 'RoleRequired',
            detail: 'An issuer role is required.',
          });
        }
        const input = await jsonBody(request, 96 * 1024);
        if (input.status) return send(response, input.status, input.body);
        if (reoffer)
          return send(response, 200, await issuer!.registration.reoffer(account.id, input.body));
        return send(response, 201, await issuer!.registration.register(account.id, input.body));
      }
      if (certificateScheme)
        return send(response, 200, await issuanceScheme(account, issuanceSchemes!));
      if (accreditationState) {
        const refresh =
          Boolean(
            new URL(request.url!, 'http://back-office.invalid').searchParams.get('refresh'),
          ) && account.roles.some((role) => ['plr_issuer', 'plr_auditor'].includes(role));
        return send(response, 200, await accreditation!.state(refresh));
      }
      if (listSchemas || schemaCommand) {
        if (!account.roles.length) {
          return send(response, 403, {
            reason: 'RoleRequired',
            detail: 'An operator role is required.',
          });
        }
        if (listSchemas) return send(response, 200, await schemaManagement!.list(account));
        if (!canManageSchemas(account)) {
          return send(response, 403, {
            reason: 'NotRootTao',
            detail: 'Only the RootTAO defines certificate schemas.',
          });
        }
        const input = await jsonBody(request, 96 * 1024);
        if (input.status) return send(response, input.status, input.body);
        return send(
          response,
          schemaCommand!.status,
          await schemaManagement![schemaCommand!.method](account.id, input.body),
        );
      }
      if (!profile) {
        const eligibleRoles =
          command?.method === 'setLifespan' ? ['plr_tao'] : ['plr_rtao', 'plr_tao'];
        if (!eligibleRoles.some((role) => account.roles.includes(role))) {
          return send(response, 403, {
            reason: 'RoleRequired',
            detail: 'An accreditor role is required.',
          });
        }
        if (readChain) return send(response, 200, await trustChain!.read(account.id));
        const input = await jsonBody(request);
        if (input.status) return send(response, input.status, input.body);
        const result = await invitations![command!.method](account.id, input.body);
        return send(response, command!.status, result);
      }
      return send(response, 200, {
        account_id: account.id,
        username: account.username,
        roles: account.roles,
        governance_roles: governanceProfile.consoleRoles.filter((role) =>
          account.governance_roles?.includes(role),
        ),
        ...organizationProfile(account),
        governance_contract: governanceProfile.contract,
        lifecycle_mode: statusProposals
          ? statusProposals!.governanceEnabled === false
            ? 'local'
            : 'governance'
          : null,
        capabilities: {
          certificates: Boolean(listCertificates),
          issuance: Boolean(issuer),
          verification: Boolean(presentations || verification),
          status_management: Boolean(statusProposals),
          emergency_suspension: Boolean(emergencySuspend),
          audit: Boolean(audit),
          anchors: Boolean(listAnchors),
          trust_chain: Boolean(invitations && trustChain),
          schemas: Boolean(schemaManagement),
          accounts: Boolean(operatorManagement),
        },
      });
    }

    return send(response, 404, { detail: 'Not found.' });
  }

  return createServer((request, response) => {
    handle(request, response).catch((error) => {
      if (error instanceof OperatorManagementError && error.body.reason === 'SessionChanged')
        return send(response, 401, { code: 'token_not_valid', detail: error.body.detail });
      if (error instanceof PasswordRecoveryError) {
        if (error.retryAfter) response.setHeader('retry-after', String(error.retryAfter));
        return send(response, error.status, error.body);
      }
      const verificationFailure = verifierRefusal(error);
      if (verificationFailure)
        return send(response, verificationFailure.status, verificationFailure.body);
      if (
        error instanceof OperatorManagementError ||
        error instanceof AccreditationError ||
        error instanceof SchemaError ||
        error instanceof IssuanceError ||
        error instanceof IssuanceInputError
      )
        return send(response, error.status, error.body);
      reportError(error);
      if (response.headersSent) response.destroy();
      else {
        const backupRequest =
          walletBackups &&
          /^\/wallet-backups\/[A-Za-z0-9_-]{43}\/$/.test(request.url!.split('?')[0]);
        send(response, backupRequest ? 500 : 503, {
          detail: backupRequest ? 'Internal server error.' : 'Back Office is unavailable.',
        });
      }
    });
  });
}
