import type { PluginContext, I18nextToolkitConfig } from '../../types.js'
import { safePluralRules } from '../../utils/plural-rules.js'

// Checks if a string looks like natural language (contains spaces, punctuation, etc.)
const naturalLanguageChars = /[ ,?!;]/
const looksLikeNaturalLanguage = (s: string) => naturalLanguageChars.test(s)

/**
 * Extracts translation keys from comments in source code using regex patterns.
 * Supports extraction from single-line (//) and multi-line comments.
 *
 * @param code - The source code to analyze
 * @param pluginContext - Context object with helper methods to add found keys
 * @param config - Configuration object containing extraction settings
 * @param scopeResolver - Function to resolve scope information for variables (optional)
 *
 * @example
 * ```typescript
 * const code = `
 *   // t('user.name', 'User Name')
 *   /* t('app.title', { defaultValue: 'My App', ns: 'common' }) *\/
 * `
 *
 * const context = createPluginContext(allKeys)
 * extractKeysFromComments(code, context, config, scopeResolver)
 * // Extracts: user.name and app.title with their respective settings
 * ```
 */
export function extractKeysFromComments (
  code: string,
  pluginContext: PluginContext,
  config: I18nextToolkitConfig,
  scopeResolver?: (varName: string) => { defaultNs?: string; keyPrefix?: string } | undefined
): void {
  // Hardcode the function name to 't' to prevent parsing other functions like 'test()'.
  const functionNameToFind = 't'

  // Use a reliable word boundary (\b) to match 't(...)' but not 'http.get(...)'.
  const keyRegex = new RegExp(`\\b${functionNameToFind}\\s*\\(\\s*(['"\`])(.*?)\\1`, 'g')

  // Prepare preservePatterns for filtering
  const rawPreservePatterns = config.extract.preservePatterns || []
  const preservePatterns = rawPreservePatterns.map(globToRegex)
  const nsSeparator = config.extract.nsSeparator ?? ':'
  const primaryLanguage = config.extract.primaryLanguage || config.locales[0] || 'en'

  const matchesPreserve = (key: string, ns?: string) => {
    // 1) regex-style matches (existing behavior)
    if (preservePatterns.some(re => re.test(key))) return true
    // 2) namespace:* style patterns => preserve entire namespace
    for (const rp of rawPreservePatterns) {
      if (typeof rp !== 'string') continue
      if (rp.endsWith(`${nsSeparator}*`)) {
        const nsPrefix = (typeof nsSeparator === 'string' && nsSeparator.length > 0)
          ? rp.slice(0, -(nsSeparator.length + 1))
          : rp.slice(0, -1)
        // support '*' as a wildcard namespace
        if (nsPrefix === '*' || (ns && nsPrefix === ns)) return true
      }
    }
    return false
  }

  const commentTexts = collectCommentTexts(code)

  for (const text of commentTexts) {
    let match: RegExpExecArray | null
    while ((match = keyRegex.exec(text)) !== null) {
      let key = match[2]

      // Validate that the key is not empty or whitespace-only
      if (!key || key.trim() === '') {
        continue // Skip empty keys
      }

      // We'll check preservePatterns after namespace resolution below

      let ns: string | false | undefined
      const remainder = text.slice(match.index + match[0].length)

      const localeMap = tryParseLocaleMapFromComment(remainder, config.locales, primaryLanguage)
      const defaultValue = localeMap?.defaultValue ?? parseDefaultValueFromComment(remainder)
      const localeDefaults = localeMap?.localeDefaults
      const explicitDefaultFromLocaleMap = Boolean(localeMap)
      const context = parseContextFromComment(remainder)
      const count = parseCountFromComment(remainder)
      const ordinal = parseOrdinalFromComment(remainder)

      // Check if key ends with _ordinal suffix (like in ast-visitors)
      let isOrdinalByKey = false
      const pluralSeparator = config.extract.pluralSeparator ?? '_'
      if (key.endsWith(`${pluralSeparator}ordinal`)) {
        isOrdinalByKey = true
        // Normalize the key by stripping the suffix
        key = key.slice(0, -(pluralSeparator.length + 7)) // Remove "_ordinal"

        // Validate that the key is still not empty after normalization
        if (!key || key.trim() === '') {
          continue // Skip keys that become empty after normalization
        }

        // Re-check preservePatterns after key normalization (will check namespace-aware helper)
        if (matchesPreserve(key, ns as string | undefined)) {
          continue // Skip normalized keys that match preserve patterns
        }
      }

      const isOrdinal = ordinal === true || isOrdinalByKey

      // 1. Check for namespace in options object first (e.g., { ns: 'common' })
      ns = parseNsFromComment(remainder)

      // 2. If not in options, check for separator in key (e.g., 'common:button.save')
      const nsSeparator = config.extract.nsSeparator ?? ':'
      if (!ns && nsSeparator && key.includes(nsSeparator)) {
        const parts = key.split(nsSeparator)

        // If the candidate namespace looks like natural language, don't split
        if (!looksLikeNaturalLanguage(parts[0])) {
          ns = parts.shift()
          key = parts.join(nsSeparator)

          // Validate that the key didn't become empty after namespace removal
          if (!key || key.trim() === '') {
            continue // Skip keys that become empty after namespace removal
          }

          // Re-check preservePatterns after namespace processing (namespace-aware)
          if (matchesPreserve(key, ns as string | undefined)) {
            continue // Skip processed keys that match preserve patterns
          }
        }
      }

      // 3. If no explicit namespace found, try to resolve from scope
      // This allows commented t() calls to inherit namespace from useTranslation scope
      if (!ns && scopeResolver) {
        const scopeInfo = scopeResolver('t')
        if (scopeInfo?.defaultNs) {
          ns = scopeInfo.defaultNs
        }
      }

      // Final preserve check for keys without prior namespace normalization
      if (matchesPreserve(key, ns as string | undefined)) {
        continue
      }

      // 4. Final fallback to configured default namespace
      if (!ns) ns = config.extract.defaultNS

      const commentExtras =
        localeDefaults !== undefined
          ? { localeDefaults, ...(explicitDefaultFromLocaleMap ? { explicitDefault: true as const } : {}) }
          : {}

      // 5. Handle context and count combinations based on disablePlurals setting
      if (config.extract.disablePlurals) {
        // When plurals are disabled, ignore count for key generation
        if (context) {
          // Only generate context variants (no base key when context is static)
          pluginContext.addKey({ key: `${key}_${context}`, ns, defaultValue: defaultValue ?? key, ...commentExtras })
        } else {
          // Simple key (ignore count)
          pluginContext.addKey({ key, ns, defaultValue: defaultValue ?? key, ...commentExtras })
        }
      } else {
        // Original plural handling logic when plurals are enabled
        if (context && count) {
          // Generate context+plural combinations
          generateContextPluralKeys(key, defaultValue ?? key, ns, context, pluginContext, config, isOrdinal, localeDefaults, explicitDefaultFromLocaleMap)

          // Only generate base plural forms if generateBasePluralForms is not disabled
          const shouldGenerateBaseForms = config.extract?.generateBasePluralForms !== false
          if (shouldGenerateBaseForms) {
            generatePluralKeys(key, defaultValue ?? key, ns, pluginContext, config, isOrdinal, localeDefaults, explicitDefaultFromLocaleMap)
          }
        } else if (context) {
          // Just context variants
          pluginContext.addKey({ key, ns, defaultValue: defaultValue ?? key, ...commentExtras })
          pluginContext.addKey({ key: `${key}_${context}`, ns, defaultValue: defaultValue ?? key, ...commentExtras })
        } else if (count) {
          // Just plural variants
          generatePluralKeys(key, defaultValue ?? key, ns, pluginContext, config, isOrdinal, localeDefaults, explicitDefaultFromLocaleMap)
        } else {
          // Simple key
          pluginContext.addKey({ key, ns, defaultValue: defaultValue ?? key, ...commentExtras })
        }
      }
    }
  }
}

/**
 * Generates plural keys for a given base key
 */
function pluralCommentExtras (
  localeDefaults: Record<string, string> | undefined,
  explicitDefault: boolean
): { localeDefaults: Record<string, string>; explicitDefault?: true } | Record<string, never> {
  if (!localeDefaults) return {}
  return explicitDefault
    ? { localeDefaults, explicitDefault: true }
    : { localeDefaults }
}

function generatePluralKeys (
  key: string,
  defaultValue: string,
  ns: string | false | undefined,
  pluginContext: PluginContext,
  config: I18nextToolkitConfig,
  isOrdinal = false,
  localeDefaults?: Record<string, string>,
  explicitLocaleMap?: boolean
): void {
  const pExtras = pluralCommentExtras(localeDefaults, Boolean(explicitLocaleMap))
  try {
    const type = isOrdinal ? 'ordinal' : 'cardinal'

    // Generate plural forms for ALL target languages to ensure we have all necessary keys
    const allPluralCategories = new Set<string>()

    for (const locale of config.locales) {
      try {
        const pluralRules = safePluralRules(locale, { type })
        const categories = pluralRules.resolvedOptions().pluralCategories
        categories.forEach(cat => allPluralCategories.add(cat))
      } catch (e) {
        // If a locale is invalid, fall back to English rules
        const englishRules = safePluralRules('en', { type })
        const categories = englishRules.resolvedOptions().pluralCategories
        categories.forEach(cat => allPluralCategories.add(cat))
      }
    }

    const pluralCategories = Array.from(allPluralCategories).sort()
    const pluralSeparator = config.extract.pluralSeparator ?? '_'

    // If the only plural category is "other", prefer emitting the base key instead of "key_other"
    if (pluralCategories.length === 1 && pluralCategories[0] === 'other') {
      // Emit base key only
      pluginContext.addKey({
        key,
        ns,
        defaultValue,
        hasCount: true,
        ...pExtras
      })
      return
    }

    // Generate keys for each plural category
    for (const category of pluralCategories) {
      const finalKey = isOrdinal
        ? `${key}${pluralSeparator}ordinal${pluralSeparator}${category}`
        : `${key}${pluralSeparator}${category}`

      pluginContext.addKey({
        key: finalKey,
        ns,
        defaultValue,
        hasCount: true,
        isOrdinal,
        ...pExtras
      })
    }
  } catch (e) {
    // Fallback if Intl API fails
    pluginContext.addKey({ key, ns, defaultValue, ...pExtras })
  }
}

/**
 * Generates context + plural combination keys
 */
function generateContextPluralKeys (
  key: string,
  defaultValue: string,
  ns: string | false | undefined,
  context: string,
  pluginContext: PluginContext,
  config: I18nextToolkitConfig,
  isOrdinal = false,
  localeDefaults?: Record<string, string>,
  explicitLocaleMap?: boolean
): void {
  const pExtras = pluralCommentExtras(localeDefaults, Boolean(explicitLocaleMap))
  try {
    const type = isOrdinal ? 'ordinal' : 'cardinal'

    // Generate plural forms for ALL target languages to ensure we have all necessary keys
    const allPluralCategories = new Set<string>()

    for (const locale of config.locales) {
      try {
        const pluralRules = safePluralRules(locale, { type })
        const categories = pluralRules.resolvedOptions().pluralCategories
        categories.forEach(cat => allPluralCategories.add(cat))
      } catch (e) {
        // If a locale is invalid, fall back to English rules
        const englishRules = safePluralRules(config.extract.primaryLanguage || 'en', { type })
        const categories = englishRules.resolvedOptions().pluralCategories
        categories.forEach(cat => allPluralCategories.add(cat))
      }
    }

    const pluralCategories = Array.from(allPluralCategories).sort()
    const pluralSeparator = config.extract.pluralSeparator ?? '_'

    // Generate keys for each context + plural combination
    for (const category of pluralCategories) {
      const finalKey = isOrdinal
        ? `${key}_${context}${pluralSeparator}ordinal${pluralSeparator}${category}`
        : `${key}_${context}${pluralSeparator}${category}`

      pluginContext.addKey({
        key: finalKey,
        ns,
        defaultValue,
        hasCount: true,
        isOrdinal,
        ...pExtras
      })
    }
  } catch (e) {
    // Fallback if Intl API fails
    pluginContext.addKey({ key: `${key}_${context}`, ns, defaultValue, ...pExtras })
  }
}

const RESERVED_T_OPTION_KEYS = new Set([
  'defaultValue',
  'ns',
  'context',
  'count',
  'ordinal',
  'returnObjects',
  'keySeparator',
  'nsSeparator',
  'interpolation',
  'lng',
  'fallbackLng',
])

/**
 * Returns the inner slice of the first `{ ... }` object after optional leading comma,
 * or null if not found. Handles strings and brace nesting.
 *
 * @internal
 */
function extractFirstObjectLiteralInner (remainder: string): string | null {
  const open = /^\s*,\s*\{/.exec(remainder)
  if (!open) return null
  const startBrace = open.index + open[0].length - 1
  let depth = 1
  let i = startBrace + 1
  let inStr: "'" | '"' | '`' | null = null
  let escaped = false
  for (; i < remainder.length; i++) {
    const c = remainder[i]
    if (inStr) {
      if (escaped) {
        escaped = false
        continue
      }
      if (c === '\\') {
        escaped = true
        continue
      }
      if (c === inStr) {
        inStr = null
        continue
      }
      continue
    }
    if (c === '\'' || c === '"' || c === '`') {
      inStr = c
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        return remainder.slice(startBrace + 1, i)
      }
    }
  }
  return null
}

function normalizeLocaleTag (s: string): string {
  return s.replace(/_/g, '-').toLowerCase()
}

/**
 * Parses `ident: 'string'` pairs from object literal body (no outer braces).
 *
 * @internal
 */
function parseStringPropertyPairs (inner: string): Record<string, string> {
  const out: Record<string, string> = {}
  const prop = /([a-zA-Z_$][\w$]*)\s*:\s*(['"])((?:\\.|(?!\2).)*)\2/g
  let m: RegExpExecArray | null
  while ((m = prop.exec(inner)) !== null) {
    out[m[1]] = m[3]
  }
  return out
}

/**
 * When the second argument is `{ en: '…', ua: '…' }` (no reserved i18next option keys),
 * returns locale strings limited to configured locales. Otherwise returns null.
 *
 * @internal
 */
export function tryParseLocaleMapFromComment (
  remainder: string,
  configLocales: string[],
  primaryLanguage: string
): { localeDefaults: Record<string, string>; defaultValue: string } | null {
  const inner = extractFirstObjectLiteralInner(remainder)
  if (!inner) return null

  for (const name of RESERVED_T_OPTION_KEYS) {
    const re = new RegExp(`(?:^|[,{]\\s*)${name}\\s*:`, 'm')
    if (re.test(inner)) return null
  }

  const rawPairs = parseStringPropertyPairs(inner)
  if (Object.keys(rawPairs).length === 0) return null

  const localeDefaults: Record<string, string> = {}
  for (const k of Object.keys(rawPairs)) {
    if (RESERVED_T_OPTION_KEYS.has(k)) return null
    const hit = configLocales.find(loc => normalizeLocaleTag(loc) === normalizeLocaleTag(k))
    if (hit) localeDefaults[hit] = rawPairs[k]
  }
  if (Object.keys(localeDefaults).length === 0) return null

  const primaryCanon =
    configLocales.find(loc => normalizeLocaleTag(loc) === normalizeLocaleTag(primaryLanguage)) ??
    configLocales[0]
  let defaultValue: string | undefined = primaryCanon ? localeDefaults[primaryCanon] : undefined
  if (defaultValue === undefined) {
    for (const loc of configLocales) {
      if (localeDefaults[loc] !== undefined) {
        defaultValue = localeDefaults[loc]
        break
      }
    }
  }
  if (defaultValue === undefined) defaultValue = Object.values(localeDefaults)[0]

  return { localeDefaults, defaultValue }
}

/**
 * Parses default value from the remainder of a comment after a translation function call.
 * Supports both string literals and object syntax with defaultValue property.
 *
 * @param remainder - The remaining text after the translation key
 * @returns The parsed default value or undefined if none found
 *
 * @internal
 */
function parseDefaultValueFromComment (remainder: string): string | undefined {
  // Simple string default: , 'VALUE' or , "VALUE"
  const dvString = /^\s*,\s*(['"])(.*?)\1/.exec(remainder)
  if (dvString) return dvString[2]

  // Object with defaultValue: , { defaultValue: 'VALUE', ... }
  const dvObj = /^\s*,\s*\{[^}]*defaultValue\s*:\s*(['"])(.*?)\1/.exec(remainder)
  if (dvObj) return dvObj[2]

  return undefined
}

/**
 * Parses namespace from the remainder of a comment after a translation function call.
 * Looks for namespace specified in options object syntax.
 *
 * @param remainder - The remaining text after the translation key
 * @returns The parsed namespace or undefined if none found
 *
 * @internal
 */
function parseNsFromComment (remainder: string): string | undefined {
  // Look for ns in an options object, e.g., { ns: 'common' }
  const nsObj = /^\s*,\s*\{[^}]*ns\s*:\s*(['"])(.*?)\1/.exec(remainder)
  if (nsObj) return nsObj[2]

  return undefined
}

/**
 * Collects all comment texts from source code, both single-line and multi-line.
 * Deduplicates comments to avoid processing the same text multiple times.
 *
 * @param src - The source code to extract comments from
 * @returns Array of unique comment text content
 *
 * @internal
 */
function collectCommentTexts (src: string): string[] {
  const texts: string[] = []
  const seen = new Set<string>()

  const commentRegex = /\/\/(.*)|\/\*([\s\S]*?)\*\//g
  let cmatch: RegExpExecArray | null
  while ((cmatch = commentRegex.exec(src)) !== null) {
    const content = cmatch[1] ?? cmatch[2]
    const s = content.trim()
    if (s && !seen.has(s)) {
      seen.add(s)
      texts.push(s)
    }
  }

  return texts
}

/**
 * Parses context from the remainder of a comment after a translation function call.
 * Looks for context specified in options object syntax.
 *
 * @param remainder - The remaining text after the translation key
 * @returns The parsed context value or undefined if none found
 *
 * @internal
 */
function parseContextFromComment (remainder: string): string | undefined {
  // Look for context in an options object, e.g., { context: 'male' }
  const contextObj = /^\s*,\s*\{[^}]*context\s*:\s*(['"])(.*?)\1/.exec(remainder)
  if (contextObj) return contextObj[2]

  return undefined
}

/**
 * Parses count from the remainder of a comment after a translation function call.
 * Looks for count specified in options object syntax.
 *
 * @param remainder - The remaining text after the translation key
 * @returns The parsed count value or undefined if none found
 *
 * @internal
 */
function parseCountFromComment (remainder: string): number | undefined {
  // Look for count in an options object, e.g., { count: 1 }
  const countObj = /^\s*,\s*\{[^}]*count\s*:\s*(\d+)/.exec(remainder)
  if (countObj) return parseInt(countObj[1], 10)

  return undefined
}

/**
 * Parses ordinal flag from the remainder of a comment after a translation function call.
 * Looks for ordinal specified in options object syntax.
 *
 * @param remainder - The remaining text after the translation key
 * @returns The parsed ordinal value or undefined if none found
 *
 * @internal
 */
function parseOrdinalFromComment (remainder: string): boolean | undefined {
  // Look for ordinal in an options object, e.g., { ordinal: true }
  const ordinalObj = /^\s*,\s*\{[^}]*ordinal\s*:\s*(true|false)/.exec(remainder)
  if (ordinalObj) return ordinalObj[1] === 'true'

  return undefined
}

/**
 * Converts a glob pattern to a regular expression.
 * Supports basic glob patterns with * wildcards.
 *
 * @param glob - The glob pattern to convert
 * @returns A RegExp that matches the glob pattern
 *
 * @internal
 */
function globToRegex (glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  const regexString = `^${escaped.replace(/\*/g, '.*')}$`
  return new RegExp(regexString)
}
