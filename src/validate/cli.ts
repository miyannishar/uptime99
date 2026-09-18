import { runIntegrityChecks } from './integrity'

const problems = runIntegrityChecks()
if (problems.length > 0) {
  console.error(`✗ ${problems.length} data problem(s):`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log('✓ all data files valid')
