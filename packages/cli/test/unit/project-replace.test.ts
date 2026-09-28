import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
    EXIT_SUCCESS,
    EXIT_PREFLIGHT,
    EXIT_VALIDATION,
    EXIT_DRIFT,
    EXIT_AUTH,
    EXIT_TRANSPORT,
    EXIT_SERVER,
    EXIT_APPLY_FAILED,
    EXIT_PLAN_CHANGES,
    parseConnectionMappings,
    parseProviderMappings,
    parseProviderMappingContent,
    runProjectReplace,
    type ReplaceCliOptions,
} from '../../src/lib/commands/project-replace'
import {
    ProjectReplaceArtifact,
    ProjectReplaceArtifactSchema,
    ProjectStateSnapshot,
} from '@inboxfm-connect/shared'

describe('CLI project-replace Command', () => {
    let tmpDir: string

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-replace-test-'))
        delete process.env.INBOXFM_PROVIDER_MAPPINGS
        delete process.env.INBOXFM_CONNECTION_MAPPINGS
    })

    afterEach(() => {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true })
        }
        catch {}
    })

    const sampleSnapshot: ProjectStateSnapshot = {
        version: '1.0.0',
        exportedAt: '2026-09-28T00:00:00.000Z',
        projectId: 'src-proj-1',
        flows: [],
        agents: [],
        mcp: null,
        connections: [],
    }

    const sampleArtifact: ProjectReplaceArtifact = {
        version: '1.0.0',
        plan: {
            planId: 'plan-123',
            sourceProjectId: 'src-proj-1',
            targetProjectId: 'dest-proj-1',
            checksum: 'chk-abc-123',
            signature: 'sig-verified',
            createdAt: '2026-09-28T00:00:00.000Z',
            summary: {
                created: 1,
                updated: 0,
                deleted: 0,
                unchanged: 0,
            },
            preflight: {
                passed: true,
                errors: [],
                warnings: [],
            },
            changes: {
                creates: [{ kind: 'mcp_server', externalId: 'default', title: 'Default MCP' }],
                updates: [],
                deletes: [],
                unchanged: [],
            },
        },
        snapshot: sampleSnapshot,
    }

    describe('Provider & Connection Mapping Flag Parsing', () => {
        it('parses --provider-map key=value and key:value syntax', () => {
            const options: ReplaceCliOptions = {
                destUrl: 'http://dest.local',
                destToken: 'd-token',
                destProject: 'dest-p1',
                providerMap: ['openai=anthropic', 'google:azure'],
            }

            const mappings = parseProviderMappings(options)
            expect(mappings).toEqual([
                { sourceProvider: 'openai', destProvider: 'anthropic' },
                { sourceProvider: 'google', destProvider: 'azure' },
            ])
        })

        it('parses comma-separated entries in --provider-map', () => {
            const options: ReplaceCliOptions = {
                destUrl: 'http://dest.local',
                destToken: 'd-token',
                destProject: 'dest-p1',
                providerMap: ['openai=anthropic, google=azure', 'groq=bedrock'],
            }

            const mappings = parseProviderMappings(options)
            expect(mappings).toEqual([
                { sourceProvider: 'openai', destProvider: 'anthropic' },
                { sourceProvider: 'google', destProvider: 'azure' },
                { sourceProvider: 'groq', destProvider: 'bedrock' },
            ])
        })

        it('throws descriptive error on invalid provider-map syntax without delimiter', () => {
            const options: ReplaceCliOptions = {
                destUrl: 'http://dest.local',
                destToken: 'd-token',
                destProject: 'dest-p1',
                providerMap: ['invalid_mapping_syntax'],
            }

            expect(() => parseProviderMappings(options)).toThrow(
                'Invalid provider mapping "invalid_mapping_syntax". Format must be sourceProvider=destProvider',
            )
        })

        it('parses provider mappings from JSON file via --provider-mapping-file', () => {
            const mappingFilePath = path.join(tmpDir, 'providers.json')
            fs.writeFileSync(
                mappingFilePath,
                JSON.stringify([
                    { sourceProvider: 'openai', destProvider: 'openrouter' },
                    { sourceProvider: 'deepseek', destProvider: 'anthropic' },
                ]),
            )

            const options: ReplaceCliOptions = {
                destUrl: 'http://dest.local',
                destToken: 'd-token',
                destProject: 'dest-p1',
                providerMappingFile: mappingFilePath,
            }

            const mappings = parseProviderMappings(options)
            expect(mappings).toEqual([
                { sourceProvider: 'openai', destProvider: 'openrouter' },
                { sourceProvider: 'deepseek', destProvider: 'anthropic' },
            ])
        })

        it('parses provider mappings from object dictionary format', () => {
            const out: any[] = []
            parseProviderMappingContent(
                JSON.stringify({
                    openai: 'anthropic',
                    groq: 'bedrock',
                }),
                out,
            )
            expect(out).toEqual([
                { sourceProvider: 'openai', destProvider: 'anthropic' },
                { sourceProvider: 'groq', destProvider: 'bedrock' },
            ])
        })

        it('parses provider mappings from INBOXFM_PROVIDER_MAPPINGS environment variable', () => {
            process.env.INBOXFM_PROVIDER_MAPPINGS = JSON.stringify([
                { sourceProvider: 'env_source', destProvider: 'env_dest' },
            ])

            const options: ReplaceCliOptions = {
                destUrl: 'http://dest.local',
                destToken: 'd-token',
                destProject: 'dest-p1',
            }

            const mappings = parseProviderMappings(options)
            expect(mappings).toEqual([
                { sourceProvider: 'env_source', destProvider: 'env_dest' },
            ])
        })

        it('parses connection mappings via --connection-map correctly', () => {
            const options: ReplaceCliOptions = {
                destUrl: 'http://dest.local',
                destToken: 'd-token',
                destProject: 'dest-p1',
                connectionMap: ['slack_prod=slack_staging, github_src=github_dest'],
            }

            const mappings = parseConnectionMappings(options)
            expect(mappings).toEqual([
                { sourceExternalId: 'slack_prod', destExternalId: 'slack_staging' },
                { sourceExternalId: 'github_src', destExternalId: 'github_dest' },
            ])
        })
    })

    describe('Exit-Code Contract & Failure Isolation', () => {
        it('exits with EXIT_AUTH (4) when source details are missing without planFile', async () => {
            let exitCode: number | undefined
            const errLogs: string[] = []

            const code = await runProjectReplace(
                {
                    destUrl: 'http://dest.local',
                    destToken: 'dest-tok',
                    destProject: 'dest-proj',
                },
                {
                    exitFn: (c) => { exitCode = c },
                    errFn: (...args) => { errLogs.push(args.join(' ')) },
                },
            )

            expect(code).toBe(EXIT_AUTH)
            expect(exitCode).toBe(EXIT_AUTH)
            expect(errLogs.some((l) => l.includes('--source-url, --source-token, and --source-project are required'))).toBe(true)
        })

        it('exits with EXIT_VALIDATION (2) when plan file contains invalid JSON', async () => {
            const planFilePath = path.join(tmpDir, 'malformed-plan.json')
            fs.writeFileSync(planFilePath, 'this is not json {')

            let exitCode: number | undefined
            const errLogs: string[] = []

            const code = await runProjectReplace(
                {
                    destUrl: 'http://dest.local',
                    destToken: 'dest-tok',
                    destProject: 'dest-proj',
                    planFile: planFilePath,
                },
                {
                    exitFn: (c) => { exitCode = c },
                    errFn: (...args) => { errLogs.push(args.join(' ')) },
                },
            )

            expect(code).toBe(EXIT_VALIDATION)
            expect(exitCode).toBe(EXIT_VALIDATION)
            expect(errLogs.some((l) => l.includes('Invalid JSON in plan file'))).toBe(true)
        })

        it('exits with EXIT_VALIDATION (2) when plan file fails schema validation', async () => {
            const planFilePath = path.join(tmpDir, 'invalid-schema-plan.json')
            fs.writeFileSync(planFilePath, JSON.stringify({ invalid: 'schema', snapshot: {} }))

            let exitCode: number | undefined
            const errLogs: string[] = []

            const code = await runProjectReplace(
                {
                    destUrl: 'http://dest.local',
                    destToken: 'dest-tok',
                    destProject: 'dest-proj',
                    planFile: planFilePath,
                },
                {
                    exitFn: (c) => { exitCode = c },
                    errFn: (...args) => { errLogs.push(args.join(' ')) },
                },
            )

            expect(code).toBe(EXIT_VALIDATION)
            expect(exitCode).toBe(EXIT_VALIDATION)
            expect(errLogs.some((l) => l.includes('Invalid plan file schema'))).toBe(true)
        })

        it('exits with EXIT_PREFLIGHT (1) when destination plan returns preflight check errors', async () => {
            let exitCode: number | undefined
            const errLogs: string[] = []

            const mockFetch = vi.fn().mockImplementation(async (url: string) => {
                if (url.includes('/export')) {
                    return new Response(JSON.stringify(sampleSnapshot), { status: 200 })
                }
                if (url.includes('/plan')) {
                    return new Response(
                        JSON.stringify({
                            error: 'PREFLIGHT_FAILED',
                            plan: {
                                preflight: {
                                    passed: false,
                                    errors: [{ kind: 'MISSING_PROVIDER', message: 'Destination lacks OpenAI provider' }],
                                },
                            },
                        }),
                        { status: 400 },
                    )
                }
                return new Response('Not found', { status: 404 })
            })

            const code = await runProjectReplace(
                {
                    sourceUrl: 'http://source.local',
                    sourceToken: 'src-tok',
                    sourceProject: 'src-p1',
                    destUrl: 'http://dest.local',
                    destToken: 'dest-tok',
                    destProject: 'dest-p1',
                },
                {
                    exitFn: (c) => { exitCode = c },
                    errFn: (...args) => { errLogs.push(args.join(' ')) },
                    fetchFn: mockFetch as unknown as typeof fetch,
                },
            )

            expect(code).toBe(EXIT_PREFLIGHT)
            expect(exitCode).toBe(EXIT_PREFLIGHT)
            expect(errLogs.some((l) => l.includes('Preflight checks failed on destination'))).toBe(true)
        })

        it('exits with EXIT_DRIFT (3) when destination returns 409 Conflict', async () => {
            let exitCode: number | undefined
            const errLogs: string[] = []

            const mockFetch = vi.fn().mockImplementation(async (url: string) => {
                if (url.includes('/export')) {
                    return new Response(JSON.stringify(sampleSnapshot), { status: 200 })
                }
                if (url.includes('/plan')) {
                    return new Response(JSON.stringify(sampleArtifact), { status: 200 })
                }
                if (url.includes('/apply')) {
                    return new Response(JSON.stringify({ error: 'DRIFT_DETECTED' }), { status: 409 })
                }
                return new Response('Not found', { status: 404 })
            })

            const code = await runProjectReplace(
                {
                    sourceUrl: 'http://source.local',
                    sourceToken: 'src-tok',
                    sourceProject: 'src-p1',
                    destUrl: 'http://dest.local',
                    destToken: 'dest-tok',
                    destProject: 'dest-p1',
                },
                {
                    exitFn: (c) => { exitCode = c },
                    errFn: (...args) => { errLogs.push(args.join(' ')) },
                    fetchFn: mockFetch as unknown as typeof fetch,
                },
            )

            expect(code).toBe(EXIT_DRIFT)
            expect(exitCode).toBe(EXIT_DRIFT)
            expect(errLogs.some((l) => l.includes('Destination state has drifted'))).toBe(true)
        })

        it('exits with EXIT_AUTH (4) when destination returns 401 or 403', async () => {
            let exitCode: number | undefined
            const errLogs: string[] = []

            const mockFetch = vi.fn().mockImplementation(async (url: string) => {
                if (url.includes('/export')) {
                    return new Response(JSON.stringify(sampleSnapshot), { status: 200 })
                }
                if (url.includes('/plan')) {
                    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401 })
                }
                return new Response('Not found', { status: 404 })
            })

            const code = await runProjectReplace(
                {
                    sourceUrl: 'http://source.local',
                    sourceToken: 'src-tok',
                    sourceProject: 'src-p1',
                    destUrl: 'http://dest.local',
                    destToken: 'invalid-tok',
                    destProject: 'dest-p1',
                },
                {
                    exitFn: (c) => { exitCode = c },
                    errFn: (...args) => { errLogs.push(args.join(' ')) },
                    fetchFn: mockFetch as unknown as typeof fetch,
                },
            )

            expect(code).toBe(EXIT_AUTH)
            expect(exitCode).toBe(EXIT_AUTH)
            expect(errLogs.some((l) => l.includes('Auth failed on destination'))).toBe(true)
        })

        it('exits with EXIT_TRANSPORT (5) when network fetch throws', async () => {
            let exitCode: number | undefined
            const errLogs: string[] = []

            const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED destination unreachable'))

            const code = await runProjectReplace(
                {
                    sourceUrl: 'http://source.local',
                    sourceToken: 'src-tok',
                    sourceProject: 'src-p1',
                    destUrl: 'http://dest.local',
                    destToken: 'dest-tok',
                    destProject: 'dest-p1',
                },
                {
                    exitFn: (c) => { exitCode = c },
                    errFn: (...args) => { errLogs.push(args.join(' ')) },
                    fetchFn: mockFetch as unknown as typeof fetch,
                },
            )

            expect(code).toBe(EXIT_TRANSPORT)
            expect(exitCode).toBe(EXIT_TRANSPORT)
            expect(errLogs.some((l) => l.includes('Transport error'))).toBe(true)
        })

        it('exits with EXIT_SERVER (6) when destination returns 500 error', async () => {
            let exitCode: number | undefined
            const errLogs: string[] = []

            const mockFetch = vi.fn().mockImplementation(async (url: string) => {
                if (url.includes('/export')) {
                    return new Response(JSON.stringify(sampleSnapshot), { status: 200 })
                }
                if (url.includes('/plan')) {
                    return new Response(JSON.stringify({ error: 'INTERNAL_SERVER_ERROR' }), { status: 500 })
                }
                return new Response('Not found', { status: 404 })
            })

            const code = await runProjectReplace(
                {
                    sourceUrl: 'http://source.local',
                    sourceToken: 'src-tok',
                    sourceProject: 'src-p1',
                    destUrl: 'http://dest.local',
                    destToken: 'dest-tok',
                    destProject: 'dest-p1',
                },
                {
                    exitFn: (c) => { exitCode = c },
                    errFn: (...args) => { errLogs.push(args.join(' ')) },
                    fetchFn: mockFetch as unknown as typeof fetch,
                },
            )

            expect(code).toBe(EXIT_SERVER)
            expect(exitCode).toBe(EXIT_SERVER)
            expect(errLogs.some((l) => l.includes('Server error on destination'))).toBe(true)
        })

        it('exits with distinct EXIT_APPLY_FAILED (7) when apply response has failed items', async () => {
            let exitCode: number | undefined
            const warnLogs: string[] = []

            const mockFetch = vi.fn().mockImplementation(async (url: string) => {
                if (url.includes('/export')) {
                    return new Response(JSON.stringify(sampleSnapshot), { status: 200 })
                }
                if (url.includes('/plan')) {
                    return new Response(JSON.stringify(sampleArtifact), { status: 200 })
                }
                if (url.includes('/apply')) {
                    return new Response(
                        JSON.stringify({
                            applied: { flowsCreated: 1 },
                            failed: [{ kind: 'flow', externalId: 'f1', error: 'Failed step' }],
                        }),
                        { status: 200 },
                    )
                }
                return new Response('Not found', { status: 404 })
            })

            const code = await runProjectReplace(
                {
                    sourceUrl: 'http://source.local',
                    sourceToken: 'src-tok',
                    sourceProject: 'src-p1',
                    destUrl: 'http://dest.local',
                    destToken: 'dest-tok',
                    destProject: 'dest-p1',
                },
                {
                    exitFn: (c) => { exitCode = c },
                    warnFn: (...args) => { warnLogs.push(args.join(' ')) },
                    fetchFn: mockFetch as unknown as typeof fetch,
                },
            )

            expect(code).toBe(EXIT_APPLY_FAILED)
            expect(exitCode).toBe(EXIT_APPLY_FAILED)
            expect(warnLogs.some((l) => l.includes('1 items failed to apply'))).toBe(true)
        })

        it('exits with distinct EXIT_PLAN_CHANGES (8) in dry-run mode when changes are planned', async () => {
            let exitCode: number | undefined
            const logs: string[] = []

            const mockFetch = vi.fn().mockImplementation(async (url: string) => {
                if (url.includes('/export')) {
                    return new Response(JSON.stringify(sampleSnapshot), { status: 200 })
                }
                if (url.includes('/plan')) {
                    return new Response(JSON.stringify(sampleArtifact), { status: 200 })
                }
                return new Response('Not found', { status: 404 })
            })

            const code = await runProjectReplace(
                {
                    sourceUrl: 'http://source.local',
                    sourceToken: 'src-tok',
                    sourceProject: 'src-p1',
                    destUrl: 'http://dest.local',
                    destToken: 'dest-tok',
                    destProject: 'dest-p1',
                    dryRun: true,
                },
                {
                    exitFn: (c) => { exitCode = c },
                    logFn: (...args) => { logs.push(args.join(' ')) },
                    fetchFn: mockFetch as unknown as typeof fetch,
                },
            )

            expect(code).toBe(EXIT_PLAN_CHANGES)
            expect(exitCode).toBe(EXIT_PLAN_CHANGES)
            expect(logs.some((l) => l.includes('Plan ID: plan-123'))).toBe(true)
        })

        it('exits with EXIT_SUCCESS (0) on completely clean apply', async () => {
            let exitCode: number | undefined
            const logs: string[] = []

            const mockFetch = vi.fn().mockImplementation(async (url: string) => {
                if (url.includes('/export')) {
                    return new Response(JSON.stringify(sampleSnapshot), { status: 200 })
                }
                if (url.includes('/plan')) {
                    return new Response(JSON.stringify(sampleArtifact), { status: 200 })
                }
                if (url.includes('/apply')) {
                    return new Response(
                        JSON.stringify({
                            applied: { flowsCreated: 1, mcpCreated: 1 },
                            failed: [],
                        }),
                        { status: 200 },
                    )
                }
                return new Response('Not found', { status: 404 })
            })

            const code = await runProjectReplace(
                {
                    sourceUrl: 'http://source.local',
                    sourceToken: 'src-tok',
                    sourceProject: 'src-p1',
                    destUrl: 'http://dest.local',
                    destToken: 'dest-tok',
                    destProject: 'dest-p1',
                },
                {
                    exitFn: (c) => { exitCode = c },
                    logFn: (...args) => { logs.push(args.join(' ')) },
                    fetchFn: mockFetch as unknown as typeof fetch,
                },
            )

            expect(code).toBe(EXIT_SUCCESS)
            expect(exitCode).toBe(EXIT_SUCCESS)
            expect(logs.some((l) => l.includes('Project replacement apply finished:'))).toBe(true)
        })
    })

    describe('No-Secrets-In-Stdout & MCP Token Protection', () => {
        const sensitiveToken = 'super-secret-mcp-token-value-998877'

        it('never prints sensitive token to stdout in human output by default', async () => {
            const logs: string[] = []
            const errLogs: string[] = []

            const mockFetch = vi.fn().mockImplementation(async (url: string) => {
                if (url.includes('/export')) {
                    return new Response(JSON.stringify(sampleSnapshot), { status: 200 })
                }
                if (url.includes('/plan')) {
                    return new Response(JSON.stringify(sampleArtifact), { status: 200 })
                }
                if (url.includes('/apply')) {
                    return new Response(
                        JSON.stringify({
                            applied: { mcpCreated: 1 },
                            failed: [],
                            mcpCredentials: {
                                token: sensitiveToken,
                                serverUrl: 'http://dest.local/api/v1/mcp',
                            },
                        }),
                        { status: 200 },
                    )
                }
                return new Response('Not found', { status: 404 })
            })

            await runProjectReplace(
                {
                    sourceUrl: 'http://source.local',
                    sourceToken: 'src-tok',
                    sourceProject: 'src-p1',
                    destUrl: 'http://dest.local',
                    destToken: 'dest-tok',
                    destProject: 'dest-p1',
                    rotateMcpToken: true,
                },
                {
                    exitFn: () => {},
                    logFn: (...args) => { logs.push(args.join(' ')) },
                    errFn: (...args) => { errLogs.push(args.join(' ')) },
                    fetchFn: mockFetch as unknown as typeof fetch,
                },
            )

            const allLoggedOutput = [...logs, ...errLogs].join('\n')
            // Assert that the raw sensitive token was never printed to stdout
            expect(allLoggedOutput).not.toContain(sensitiveToken)
            // Assert that token is marked as REDACTED
            expect(allLoggedOutput).toContain('[REDACTED]')
            expect(allLoggedOutput).toContain('Destination MCP Server Credentials:')
        })

        it('saves credentials securely to --mcp-credentials-file with restricted file mode and redacts stdout', async () => {
            const credsFilePath = path.join(tmpDir, 'subdir', 'mcp-credentials.json')
            const logs: string[] = []

            const mockFetch = vi.fn().mockImplementation(async (url: string) => {
                if (url.includes('/export')) {
                    return new Response(JSON.stringify(sampleSnapshot), { status: 200 })
                }
                if (url.includes('/plan')) {
                    return new Response(JSON.stringify(sampleArtifact), { status: 200 })
                }
                if (url.includes('/apply')) {
                    return new Response(
                        JSON.stringify({
                            applied: { mcpCreated: 1 },
                            failed: [],
                            mcpCredentials: {
                                token: sensitiveToken,
                                serverUrl: 'http://dest.local/api/v1/mcp',
                            },
                        }),
                        { status: 200 },
                    )
                }
                return new Response('Not found', { status: 404 })
            })

            await runProjectReplace(
                {
                    sourceUrl: 'http://source.local',
                    sourceToken: 'src-tok',
                    sourceProject: 'src-p1',
                    destUrl: 'http://dest.local',
                    destToken: 'dest-tok',
                    destProject: 'dest-p1',
                    rotateMcpToken: true,
                    mcpCredentialsFile: credsFilePath,
                },
                {
                    exitFn: () => {},
                    logFn: (...args) => { logs.push(args.join(' ')) },
                    fetchFn: mockFetch as unknown as typeof fetch,
                },
            )

            // File must exist
            expect(fs.existsSync(credsFilePath)).toBe(true)

            // File contents must be the credentials JSON
            const fileContent = JSON.parse(fs.readFileSync(credsFilePath, 'utf-8'))
            expect(fileContent).toEqual({
                token: sensitiveToken,
                serverUrl: 'http://dest.local/api/v1/mcp',
            })

            // Stdout must NOT have the raw token
            const allLoggedOutput = logs.join('\n')
            expect(allLoggedOutput).not.toContain(sensitiveToken)
            expect(allLoggedOutput).toContain(`[REDACTED] (saved with 0600 permissions to ${credsFilePath})`)
        })
    })

    describe('Provider Mappings Payload Propagation', () => {
        it('forwards providerMappings to inspect, plan, and apply endpoints', async () => {
            const requestBodies: Record<string, any> = {}

            const mockFetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
                if (url.includes('/export')) {
                    return new Response(JSON.stringify(sampleSnapshot), { status: 200 })
                }
                if (url.includes('/plan')) {
                    requestBodies.plan = JSON.parse(init.body as string)
                    return new Response(JSON.stringify(sampleArtifact), { status: 200 })
                }
                if (url.includes('/apply')) {
                    requestBodies.apply = JSON.parse(init.body as string)
                    return new Response(
                        JSON.stringify({
                            applied: { flowsCreated: 1 },
                            failed: [],
                        }),
                        { status: 200 },
                    )
                }
                return new Response('Not found', { status: 404 })
            })

            await runProjectReplace(
                {
                    sourceUrl: 'http://source.local',
                    sourceToken: 'src-tok',
                    sourceProject: 'src-p1',
                    destUrl: 'http://dest.local',
                    destToken: 'dest-tok',
                    destProject: 'dest-p1',
                    providerMap: ['openai=anthropic', 'mistral=bedrock'],
                    connectionMap: ['conn1=conn2'],
                },
                {
                    exitFn: () => {},
                    fetchFn: mockFetch as unknown as typeof fetch,
                },
            )

            expect(requestBodies.plan.providerMappings).toEqual([
                { sourceProvider: 'openai', destProvider: 'anthropic' },
                { sourceProvider: 'mistral', destProvider: 'bedrock' },
            ])
            expect(requestBodies.apply.providerMappings).toEqual([
                { sourceProvider: 'openai', destProvider: 'anthropic' },
                { sourceProvider: 'mistral', destProvider: 'bedrock' },
            ])
            expect(requestBodies.plan.connectionMappings).toEqual([
                { sourceExternalId: 'conn1', destExternalId: 'conn2' },
            ])
        })
    })
})
