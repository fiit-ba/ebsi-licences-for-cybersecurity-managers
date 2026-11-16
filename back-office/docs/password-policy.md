# Account password policy

Every account password must contain **15–128 Unicode code points**
and receive a **zxcvbn-ts score of at least 3 out of 4**. This applies to initial
administrator bootstrap, organization registration, account administration, staff
password changes, recovery/activation completion and password-based login. Length is checked before
strength estimation; oversized candidates are rejected, not truncated.

The checker runs on the server with pinned `@zxcvbn-ts/core` 4.2.0,
`@zxcvbn-ts/language-common` 4.1.3 and `@zxcvbn-ts/language-en` 4.1.1. Common
password/word dictionaries, keyboard graphs, repetition, sequences, dates and
character substitutions contribute to its estimate. Username, email and names are
passed as bounded per-call inputs. They do not modify the shared dictionaries.
Neither passwords nor matching account words are sent to a service, logged or
returned in policy errors. Dictionaries are dependencies installed from the
lockfile, not application-managed data files.

No uppercase, lowercase, digit or punctuation quota applies. Spaces and Unicode
are allowed, and a sufficiently unpredictable all-numeric password can pass.
Repeated symbols or long keyboard sequences can fail even at the maximum length.
Prefer a password-manager-generated secret or a phrase with unrelated words.

## Design choice

| Approach                          | Benefits                                                                           | Limits and use here                                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Application-maintained dictionary | Exact known-password refusals; simple lookups.                                     | Requires dataset maintenance and misses transformations or predictable combinations on its own. Not maintained separately.  |
| Strength-estimation library       | Combines maintained dictionaries with pattern matching and account-specific words. | Heuristic, language-dependent and more expensive than a lookup. Used locally with pinned versions and a strict input bound. |
| Length and character composition  | Length is easy to explain and supports long phrases.                               | Character-class quotas permit predictable variants and discourage phrases. Length bounds are used; class quotas are not.    |
| Length plus strength estimation   | Supports phrases while refusing many predictable passwords.                        | Selected combination; account context and bounded work are required.                                                        |

The 15-character minimum follows the single-factor password length guidance in
[NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html#passwords).
The score threshold is an application decision, not a certification or measured
cracking time. See the library's [scoring description](https://zxcvbn-ts.github.io/zxcvbn/guide/getting-started/)
and [matching options](https://zxcvbn-ts.github.io/zxcvbn/guide/options/).

Common and English language packages do not provide comprehensive Slovak or other
language coverage. Scoring does not query a complete breach corpus and cannot
prove uniqueness, absence from breaches or resistance to a particular attacker.
Login throttling and salted scrypt hashing remain separate protections.

## Responses and lifecycle

The policy returns one of `password_too_short`, `password_too_long` or
`password_too_weak`. Registration exposes a `WeakPassword` response with policy
codes; account administration keeps its `WeakPassword` envelope; recovery returns
static actionable field messages. Endpoint-specific input/authority refusals can
occur before policy evaluation. In particular, registration rejects passwords
longer than 128 characters as an invalid input field.

The policy itself neither trims nor normalizes a password. Registration and staff
operations retain their supplied password; recovery/activation completion trims
surrounding whitespace before applying the policy and hashing. Login compares the
exact submitted value to the stored hash and applies the same policy using current
account details. A matching hash alone does not permit a short, oversized or weak
password to authenticate. Refusals use the generic invalid-credentials response;
password-policy details are not disclosed during login.

Passwords are stored only as salted scrypt hashes, so database rows cannot be
inspected for password length or strength without the plaintext. A password that
fails the policy must be replaced through account administration or recovery.
Bootstrap does not overwrite existing passwords. Metadata-only account updates
do not require plaintext; subsequent login checks use the updated account details.
Policy checks do not rewrite hashes or revoke issued sessions. User-requested
password changes invalidate sessions and consume recovery state through their
owning transaction.

See [validation](validation.md) for isolated tests.
