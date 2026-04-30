import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface CliPackageMeta {
  name: string
  description: string
  version: string
}

let cached: CliPackageMeta | undefined

/**
 * Reads this package's root `package.json` (works from `src/` in tests and from `dist/esm/` when published).
 */
export function getCliPackageMeta (): CliPackageMeta {
  if (cached) return cached
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'package.json')
    if (existsSync(candidate)) {
      try {
        const raw = JSON.parse(readFileSync(candidate, 'utf-8')) as {
          name?: string
          version?: string
          description?: string
        }
        if (raw.name != null && raw.version != null) {
          cached = {
            name: raw.name,
            version: raw.version,
            description: raw.description ?? '',
          }
          return cached
        }
      } catch {
        // keep walking
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error('Could not resolve this package\'s package.json (needed for CLI name/version).')
}
