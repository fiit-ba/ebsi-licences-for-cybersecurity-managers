import { startTestEbsi, startTestLedger } from '../server/lifecycle/fixtures/ledger.ts';

// Start the development ledger (anvil with the EBSI registries, the certificate registry and its
// governance deployed by contracts/) and the development EBSI service over it, for checks run
// outside `npm test`: browser suites and checks/*.ts. Prints their environment as shell exports,
// then keeps both running until interrupted.
const { record, anvil } = await startTestLedger();
const { base, service } = await startTestEbsi(record);
console.log(`export BACK_OFFICE_TEST_LEDGER='${JSON.stringify(record)}'`);
console.log(`export BACK_OFFICE_TEST_EBSI_URL=${base}`);

/**
 * Stop the ledger and the EBSI service.
 * @returns Never; the process exits.
 */
function stop() {
  anvil.kill();
  service.kill();
  process.exit(0);
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
