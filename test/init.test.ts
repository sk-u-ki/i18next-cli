import { vol } from 'memfs'
import { vi, describe, it, expect, beforeEach, afterEach, Mock } from 'vitest'
import { runInit } from '../src/init'
import inquirer from 'inquirer'
import { resolve } from 'path'
import { name as pkgName } from '../package.json'

// Mocks
vi.mock('fs/promises', async () => {
  const memfs = await vi.importActual<typeof import('memfs')>('memfs')
  return memfs.fs.promises
})
vi.mock('inquirer')
vi.mock('../src/heuristic-config', () => ({
  detectConfig: vi.fn(),
}))

describe('init', () => {
  const mockAnswers = {
    fileType: 'TypeScript (i18next.config.ts)',
    locales: ['en', 'de'],
    input: 'src/**/*.tsx',
    output: 'public/locales/{{language}}/{{namespace}}.json',
  }

  beforeEach(() => {
    vol.reset()
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(process, 'cwd').mockReturnValue('/')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should create a TypeScript config file (without local CLI package)', async () => {
    vi.mocked(inquirer.prompt).mockResolvedValue(mockAnswers)

    await runInit()

    const configPath = resolve('/', 'i18next.config.ts')
    const content = await vol.promises.readFile(configPath, 'utf-8')

    // No local package → plain export, no defineConfig
    expect(content).not.toContain('defineConfig')
    expect(content).toContain('export default')
    expect(content).toContain('locales: [\n    "en",\n    "de"\n  ]')
    expect(content).toContain('input: "src/**/*.tsx"')
  })

  it('should create a TypeScript config file with defineConfig when locally installed', async () => {
    vol.fromJSON({
      '/package.json': JSON.stringify({ devDependencies: { [pkgName]: '^1.0.0' } }),
    })
    vi.mocked(inquirer.prompt).mockResolvedValue(mockAnswers)

    await runInit()

    const configPath = resolve('/', 'i18next.config.ts')
    const content = await vol.promises.readFile(configPath, 'utf-8')

    expect(content).toContain(`import { defineConfig } from '${pkgName}'`)
    expect(content).toContain('export default defineConfig')
    expect(content).toContain('locales: [\n    "en",\n    "de"\n  ]')
    expect(content).toContain('input: "src/**/*.tsx"')
  })

  it('should create a JavaScript (CJS) config file', async () => {
    vi.mocked(inquirer.prompt).mockResolvedValue({
      ...mockAnswers,
      fileType: 'JavaScript (i18next.config.js)',
    })

    // CJS project without local CLI package
    vol.fromJSON({
      '/package.json': JSON.stringify({ name: 'my-cjs-project' }),
    })

    await runInit()

    const configPath = resolve('/', 'i18next.config.js')
    const content = await vol.promises.readFile(configPath, 'utf-8')

    expect(content).toContain(`/** @type {import('${pkgName}').I18nextToolkitConfig} */`)
    expect(content).toContain('module.exports =')
    expect(content).not.toContain('export default')
    // No local install → no defineConfig / require
    expect(content).not.toContain('defineConfig')
    expect(content).not.toContain('require')
  })

  it('should create a JavaScript (CJS) config file with defineConfig when locally installed', async () => {
    vi.mocked(inquirer.prompt).mockResolvedValue({
      ...mockAnswers,
      fileType: 'JavaScript (i18next.config.js)',
    })

    vol.fromJSON({
      '/package.json': JSON.stringify({ name: 'my-cjs-project', devDependencies: { [pkgName]: '^1.0.0' } }),
    })

    await runInit()

    const configPath = resolve('/', 'i18next.config.js')
    const content = await vol.promises.readFile(configPath, 'utf-8')

    expect(content).toContain(`const { defineConfig } = require('${pkgName}')`)
    expect(content).toContain('module.exports = defineConfig')
  })

  it('should create a JavaScript (ESM) config file', async () => {
    vi.mocked(inquirer.prompt).mockResolvedValue({
      ...mockAnswers,
      fileType: 'JavaScript (i18next.config.js)',
    })

    // ESM project without local CLI package
    vol.fromJSON({
      '/package.json': JSON.stringify({ type: 'module' }),
    })

    await runInit()

    const configPath = resolve('/', 'i18next.config.js')
    const content = await vol.promises.readFile(configPath, 'utf-8')

    expect(content).toContain(`/** @type {import('${pkgName}').I18nextToolkitConfig} */`)
    expect(content).toContain('export default')
    expect(content).not.toContain('module.exports')
    // No local install → no defineConfig / import
    expect(content).not.toContain('defineConfig')
  })

  it('should create a JavaScript (ESM) config file with defineConfig when locally installed', async () => {
    vi.mocked(inquirer.prompt).mockResolvedValue({
      ...mockAnswers,
      fileType: 'JavaScript (i18next.config.js)',
    })

    vol.fromJSON({
      '/package.json': JSON.stringify({ type: 'module', dependencies: { [pkgName]: '^1.0.0' } }),
    })

    await runInit()

    const configPath = resolve('/', 'i18next.config.js')
    const content = await vol.promises.readFile(configPath, 'utf-8')

    expect(content).toContain(`import { defineConfig } from '${pkgName}'`)
    expect(content).toContain('export default defineConfig')
  })

  it('should suggest defaults from the heuristic scan if a structure is detected', async () => {
    // Import the module to get a handle on the mocked function
    const heuristicConfig = await import('../src/heuristic-config')
    const detected = {
      locales: ['en', 'fr', 'es'],
      extract: {
        input: ['app/**/*.{js,jsx,ts,tsx}'],
        output: 'app/i18n/locales/{{language}}/{{namespace}}.json',
      },
    }

    // Access the mock directly on the imported function and set its implementation
    ;(heuristicConfig.detectConfig as Mock).mockResolvedValue(detected)

    vi.mocked(inquirer.prompt).mockResolvedValue({
      fileType: 'TypeScript (i18next.config.ts)',
      locales: detected.locales,
      input: detected.extract.input.join(','),
      output: detected.extract.output,
    })

    await runInit()

    const promptCalls = vi.mocked(inquirer.prompt).mock.calls[0][0] as unknown as any[]

    expect(promptCalls.find(q => q.name === 'locales').default).toBe('en,fr,es')
    expect(promptCalls.find(q => q.name === 'input').default).toBe('app/**/*.{js,jsx,ts,tsx}')
    expect(promptCalls.find(q => q.name === 'output').default).toBe('app/i18n/locales/{{language}}/{{namespace}}.json')

    const configPath = resolve(process.cwd(), 'i18next.config.ts')
    const content = await vol.promises.readFile(configPath, 'utf-8')
    expect(content).toContain('output: "app/i18n/locales/{{language}}/{{namespace}}.json"')
  })
})
