import fs from 'node:fs'

const metadata = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const failures = []
if (metadata.license !== 'MIT') failures.push('package.json must declare MIT')
if (metadata.name !== 'atest-wallet') failures.push('package.json must declare the atest-wallet package')
if (!fs.existsSync('LICENSE.md')) failures.push('LICENSE.md is missing')
else {
  const license = fs.readFileSync('LICENSE.md', 'utf8')
  if (!/^MIT License$/m.test(license) || !/Permission is hereby granted/.test(license)) {
    failures.push('LICENSE.md must contain the MIT License text')
  }
}
if (!fs.existsSync('THIRD_PARTY_NOTICES.md')) failures.push('THIRD_PARTY_NOTICES.md is missing')
if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log('Wallet package license, identity and third-party notice entry point are valid.')
