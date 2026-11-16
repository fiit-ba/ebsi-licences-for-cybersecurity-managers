/** Normalization inputs with fixed success and refusal expectations. */
export const claimCompatibilityCases = [
  ...['  value  ', '\u0085value\u0085', 42, 1.5, false, true, [], {}, null, ''].map((value) => ({
    kind: 'text',
    value,
  })),
  ...[
    '2026-11-04',
    '20261104',
    20261104,
    '2026-W45-3',
    '2026W453',
    '2026-W45',
    '2026-02-30',
    '0000-01-01',
    false,
    null,
    '',
  ].map((value) => ({ kind: 'date', value })),
  ...[
    1,
    1.5,
    true,
    false,
    '+2',
    '002',
    '1_000',
    '١٢',
    '１２',
    ' 2 ',
    '1.0',
    '2e0',
    '-1',
    '0',
    [],
    {},
    null,
    '',
  ].map((value) => ({ kind: 'integer', value })),
];

/** Existing serializer requests with captured complete success/refusal bodies. */
export const issuanceInputCases: Record<string, unknown>[] = [
  {},
  { holder_reference: '', claims: {} },
  { holder_reference: null, claims: null },
  ...[true, [], {}, 'x'.repeat(256), 42, '\u0085reference\u0085', '🔐'.repeat(200)].map(
    (holder_reference) => ({ holder_reference, claims: { certificateNumber: '42' } }),
  ),
  ...[[], true, 'text', {}, { id: 'forbidden' }].map((claims) => ({
    holder_reference: 'ref',
    claims,
  })),
  ...[null, '', true, {}, 'x'.repeat(256), 42].map((issuer_did) => ({
    holder_reference: 'ref',
    claims: { n: '42' },
    issuer_did,
  })),
  ...[null, 'Type', {}, [null], [true], [''], ['x'.repeat(256)], ['ProfessionalLicense'], []].map(
    (credential_types) => ({ holder_reference: 'ref', claims: { n: '42' }, credential_types }),
  ),
  ...['2030-02-30', '2030-11-04', '20301104', '2030-11-04T12:30:00+02:00', null, 42].map(
    (valid_until) => ({ holder_reference: 'ref', claims: { n: '42' }, valid_until }),
  ),
  {
    holder_reference: 'ref',
    claims: { n: '42' },
    valid_from: '2030-11-04',
    valid_until: '2030-11-03',
  },
  { holder_reference: 'ref', claims: { n: '42' }, valid_until: '2000-01-01' },
];
