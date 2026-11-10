import { expect, type Page } from '@playwright/test';

/** Public JSON row used by the console API browser contracts. */
export type Row = Record<string, unknown>;
/** Captured browser API mutation, including the existing bearer header. */
export type ApiCall = { path: string; body: Row; authorization: string | undefined };
/** Synthetic existing operator profile for isolated browser checks. */
export type OperatorProfile = {
  username: string;
  roles: string[];
  governance_roles: string[];
  organization: string;
  organization_kind: string;
  emergency_suspension_scope: string;
  governance_contract: string;
};
/** HTTP fixture reply from an individual scenario override. */
export type Reply = { status?: number; json: unknown };

export const credentialId = 'urn:uuid:11111111-1111-4111-8111-111111111111';
export const proposalId = '22222222-2222-4222-8222-222222222222';
export const fields = [
  {
    key: 'certificateNumber',
    kind: 'text',
    section: 'certificate',
    label: { sk: 'Číslo osvedčenia', en: 'Certificate number' },
    hint: {},
    required: true,
    organization: false,
    default: '',
  },
  {
    key: 'holderName',
    kind: 'text',
    section: 'holder',
    label: { sk: 'Meno a priezvisko', en: 'Full name' },
    hint: {},
    required: true,
    organization: false,
    default: '',
  },
  {
    key: 'certificationBody',
    kind: 'text',
    section: 'certificate',
    label: { sk: 'Vydavateľ osvedčenia', en: 'Certification body' },
    hint: {},
    required: true,
    organization: true,
    default: '',
  },
];

/**
 * Install the existing public API shapes and an isolated tab session.
 * @param page - Browser page receiving API routing and session initialization.
 * @param options - Initial roles, authentication state and optional request override.
 * @returns Mutable API state and captured mutation requests.
 * @throws Playwright routing or initialization errors.
 */
export async function apiFixture(
  page: Page,
  options: {
    roles?: string[];
    authenticated?: boolean;
    override?: (path: string, body: Row, method: string) => Promise<Reply | undefined>;
  } = {},
) {
  const state = {
    profile: {
      username: 'alice',
      roles: options.roles ?? ['plr_issuer', 'plr_status_manager', 'plr_verifier', 'plr_auditor'],
      governance_roles: ['A', 'B'],
      organization: 'Odborná akadémia',
      organization_kind: 'ti',
      emergency_suspension_scope: 'own',
      governance_contract: '',
    } as OperatorProfile,
    calls: [] as ApiCall[],
    reads: [] as string[],
    certificates: [
      {
        credential_id: credentialId,
        holder_reference: 'HOLDER-0142',
        reference: 'AT-2026-0142',
        issuer: 'Odborná akadémia',
        state: 'active',
        effective_state: 'active',
        collected: true,
        issued_at: '2026-10-03T10:00:00Z',
        valid_until: '2030-10-03T10:00:00Z',
        allowed_actions: ['suspend', 'revoke'],
        has_open_proposal: false,
        can_emergency_suspend: true,
      },
    ] as Row[],
    proposals: [] as Row[],
    notices: { items: [] as Row[], total: 0, waiting: 0 },
    presentation: { status: 'pending' } as Row,
    registration: { organization: 'Nová organizácia' },
    offer: {
      credential_id: credentialId,
      offer_uri:
        'openid-credential-offer://?credential_offer_uri=https%3A%2F%2Fregistry.example%2Foffer%2Fone',
      pin: '928417',
      offer_expires_at: '2030-12-01T00:00:00Z',
      certificate_number: 'AT-2026-0142',
    },
  };
  await page.addInitScript(
    ({ authenticated }) => {
      localStorage.setItem('plr.lang', 'sk');
      if (authenticated && !sessionStorage.getItem('atest.fixture.initialized')) {
        sessionStorage.setItem('plr.token', 'test-access-token');
        sessionStorage.setItem('plr.user', 'alice');
      }
      sessionStorage.setItem('atest.fixture.initialized', 'true');
    },
    { authenticated: options.authenticated !== false },
  );
  await page.route('**/api-ledger', (route) =>
    route.fulfill({
      json: {
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32000, message: 'Isolated ledger unavailable' },
      },
    }),
  );
  await page.route('**/api-backend/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api-backend/, '').replace(/\/$/, '');
    const body = request.method() === 'POST' ? (request.postDataJSON() as Row) : {};
    if (request.method() === 'POST')
      state.calls.push({ path, body, authorization: request.headers().authorization });
    else state.reads.push(path);
    const custom = await options.override?.(path, body, request.method());
    if (custom) {
      await route.fulfill({ status: custom.status ?? 200, json: custom.json });
      return;
    }
    let value: unknown;
    if (path === '/api/api-token-auth')
      value = {
        access: 'test-access-token',
        refresh: 'ignored-refresh',
        user_id: 1,
        username: 'alice',
        email: '',
      };
    else if (path === '/registry/me') value = state.profile;
    else if (path === '/registry/notifications') value = state.notices;
    else if (path === '/registry/certificate-scheme')
      value = {
        schemas: [
          {
            credential_type: 'TrainingCertificate',
            name: { sk: 'Školenie', en: 'Training' },
            version: 1,
            fields,
          },
        ],
        organization: state.profile.organization,
        accreditation_ended: false,
      };
    else if (path === '/registry/issue' || path === '/registry/reoffer') value = state.offer;
    else if (path === '/registry/certificates')
      value = {
        results: state.certificates,
        total: state.certificates.length,
        next: null,
        unreadable: 0,
        summary: {
          all: state.certificates.length,
          valid: state.certificates.filter(
            (row) => row.state === 'active' && Boolean(row.collected),
          ).length,
          suspended: state.certificates.filter((row) => row.state === 'suspended').length,
          revoked: state.certificates.filter((row) => row.state === 'revoked').length,
        },
      };
    else if (path === '/registry/proposals')
      value = { results: state.proposals, total: state.proposals.length };
    else if (path === '/registry/propose') {
      state.proposals.push({
        proposal_id: proposalId,
        credential_id: credentialId,
        reference: 'AT-2026-0142',
        action: body.action,
        proposed_by: 'alice',
        approved: false,
        can_approve: false,
        reason_code: body.reason_code,
        reason_note: body.reason_note,
        proposed_at: '2026-11-03T10:00:00Z',
      });
      value = {
        proposal_id: proposalId,
        action: body.action,
        state: 'active',
        awaiting: 'second approver',
      };
    } else if (path === '/registry/approve')
      value = {
        proposal_id: proposalId,
        applied: false,
        awaiting: 'governance contract',
        state: 'active',
      };
    else if (path === '/registry/reject') {
      state.proposals = [];
      value = { proposal_id: proposalId, rejected: true };
    } else if (path === '/registry/emergency-suspend') {
      state.certificates[0].state = 'suspended';
      state.certificates[0].effective_state = 'suspended';
      value = { state: 'suspended' };
    } else if (path === '/registry/presentation-offer')
      value = {
        state: 'presentation-state',
        offer_uri: 'openid://?request_uri=https%3A%2F%2Fregistry.example%2Frequest%2Fone',
      };
    else if (path === '/registry/presentation-result') value = state.presentation;
    else if (path === '/registry/presentation-exchange')
      value = { state: 'presentation-state', expires_at: '2030-12-01T00:00:00Z' };
    else if (path === '/registry/schemas')
      value = {
        can_manage: true,
        registers_in_mock: false,
        schemas: [
          {
            credential_type: 'TrainingCertificate',
            name: { sk: 'Školenie', en: 'Training' },
            retired_at: null,
            current_version: 1,
            pending_version: null,
            versions: [
              {
                version: 1,
                fields,
                registered_at: '2026-10-01T00:00:00Z',
                proposed_at: '2026-09-30T00:00:00Z',
                tsr_id: 'schema-one',
                schema_address: 'https://registry.example/schemas/one',
              },
            ],
          },
        ],
      };
    else if (path === '/registry/trust-chain')
      value = {
        organization: { name: 'RootTAO', kind: 'rtao' },
        selects: 'tao',
        available_schemas: [
          { credential_type: 'TrainingCertificate', name: { sk: 'Školenie', en: 'Training' } },
        ],
        accredited: [],
      };
    else if (path === '/registry/trust-chain/select')
      value = {
        organization_id: 'organization-one',
        name: body.name,
        kind: 'tao',
        invitation: 'invitation-once',
        invitation_expires_at: '2030-12-01T00:00:00Z',
      };
    else if (path === '/organizations/v1/registrations') value = state.registration;
    else if (path === '/registry/audit')
      value = {
        results: [],
        chain: {
          intact: true,
          verified: 0,
          entries: 0,
          altered: [],
          missing_predecessor: [],
          forks: [],
        },
      };
    else if (path === '/registry/governance/roles')
      value = { enabled: false, roles: [], addresses: {}, console_roles: ['A', 'B'] };
    else if (path === '/registry/anchors') value = { anchors: [] };
    else {
      await route.fulfill({
        status: 404,
        json: { detail: 'Unexpected fixture API path: ' + path },
      });
      return;
    }
    await route.fulfill({ json: value });
  });
  return state;
}

/**
 * Sign in through the existing username/password form.
 * @param page - Browser page displaying the authentication form.
 * @returns Completion after authenticated operator navigation appears.
 * @throws Playwright assertion or interaction failures.
 */
export async function signIn(page: Page): Promise<void> {
  await page.getByLabel('Používateľ', { exact: true }).fill('alice');
  await page.getByLabel('Heslo', { exact: true }).fill('Q7!Vx2#Bm9@Kp4$Zs8%Fj6&Wy3');
  await page.getByRole('button', { name: 'Prihlásiť', exact: true }).click();
  await expect(page.locator('.sidebar')).toBeVisible();
}
