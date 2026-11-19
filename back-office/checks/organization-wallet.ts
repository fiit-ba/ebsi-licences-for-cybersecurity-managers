import pg from 'pg';
import { configuredOrganizations } from '../server/accreditation/runtime.ts';
import { developmentWallet } from '../server/accreditation/development-wallet.ts';
import { trustedSchemaRegistry } from '../server/schemas/tsr.ts';

/*
 * The own wallet of a TAO or TI the installation check appoints, played inside the backend
 * container (checks/installation.ts pipes this file in). On EBSI each organization registers its
 * DID before it is appointed, and once it registered in the back-office it lists the
 * back-office's keys in its DID document and stores the accreditation it was issued.
 *
 *   register <wallet> <accreditor username>  register the wallet's DID
 *   complete <wallet> <organization id>      list the keys, store the accreditation, check it
 */
if (process.env.ATEST_INSTALLATION_TEST !== 'isolated')
  throw new Error(
    'Use only a task-owned disposable installation (ATEST_INSTALLATION_TEST=isolated).',
  );
const [phase, index, subject] = process.argv.slice(2);
const database = new pg.Pool();
const organizations = configuredOrganizations(
  database,
  trustedSchemaRegistry(process.env.PLR_TSR_URL!),
);
try {
  if (!organizations.publication)
    throw new Error('The organization wallet needs the development EBSI service.');
  const wallet = developmentWallet(database, organizations.publication, Number(index));
  if (phase === 'register') {
    // With the onboarding authorisation its accreditor-to-be gives it.
    const {
      rows: [accreditor],
    } = await database.query(
      'SELECT o.id FROM accredited_organizations o JOIN operator_accounts a ON a.id=o.account_id WHERE a.username=$1',
      [subject],
    );
    if (!accreditor) throw new Error('No organization has the account ' + subject + '.');
    await organizations.onboarding.ensureAuthority(accreditor.id);
    await wallet.register(accreditor.id);
  } else if (phase === 'complete') {
    // The worker creates its keys and issues its accreditation after it registered.
    for (let attempt = 0; ; attempt++) {
      const {
        rows: [organization],
      } = await database.query(
        'SELECT accreditation_credential FROM accredited_organizations WHERE id=$1',
        [subject],
      );
      if (organization?.accreditation_credential) break;
      if (attempt >= 60)
        throw new Error('The back-office issued no accreditation within 10 minutes.');
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
    await wallet.complete(subject);
    if (!(await organizations.onboarding.check(subject)).accredited)
      throw new Error(
        'The organization is not accredited in EBSI after storing its accreditation.',
      );
  } else throw new Error('Name the phase: register or complete.');
} finally {
  organizations.close();
  await database.end();
}
