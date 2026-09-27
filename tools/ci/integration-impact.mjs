import path from 'node:path'

function select({ changed, packages, manifest, previousManifest }) {
    const dependenciesChanged = ['dependencies', 'overrides', 'resolutions'].some((field) => JSON.stringify(manifest[field]) !== JSON.stringify(previousManifest[field]))
    const sharedChanged = dependenciesChanged || changed.some((file) => /^(packages\/core\/(utils|formula|piece-types|execution)\/|packages\/integrations\/(framework|common)\/)/.test(file) || ['bun.lock', 'tsconfig.base.json'].includes(file))
    const lintConfigChanged = changed.includes('.eslintrc.json') || changed.some((file) => /^\.prettier/.test(file))
    const directlyAffected = packages.filter((file) => changed.some((change) => change.startsWith(`${path.posix.dirname(file)}/`)))
    return {
        build: sharedChanged ? packages : directlyAffected,
        lint: lintConfigChanged ? packages : directlyAffected,
    }
}

export const integrationImpact = { select }
