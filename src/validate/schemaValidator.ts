import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { loadJson } from './loadJson'

export type ValidateFn = (payload: unknown) => { valid: boolean; errors: string[] }

export function compileSchema(schemaRelPath: string): ValidateFn {
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  const validator = ajv.compile(loadJson(schemaRelPath) as object)

  return (payload: unknown) => {
    const valid = validator(payload) as boolean
    const errors = (validator.errors ?? []).map(
      (e) => `${e.instancePath || '/'}: ${e.message}${
        'additionalProperty' in (e.params ?? {})
          ? ` ('${(e.params as { additionalProperty: string }).additionalProperty}')`
          : ''
      }`,
    )
    return { valid, errors }
  }
}
