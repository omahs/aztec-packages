import { createDebugOnlyLogger } from '@aztec/foundation/log';

import { join, sep } from 'node:path';
import { unzip } from 'unzipit';

import { FileManager } from '../file-manager/file-manager.js';
import { NoirDependencyConfig, NoirGitDependencyConfig } from '../package-config.js';
import { NoirPackage } from '../package.js';
import { DependencyResolver } from './dependency-resolver.js';

/**
 * Downloads dependencies from github
 */
export class GithubDependencyResolver implements DependencyResolver {
  #fm: FileManager;
  #log = createDebugOnlyLogger('');

  constructor(fm: FileManager) {
    this.#fm = fm;
  }

  /**
   * Resolves a dependency from github. Returns null if URL is for a different website.
   * @param _pkg - The package to resolve the dependency for
   * @param dependency - The dependency configuration
   * @returns asd
   */
  async resolveDependency(_pkg: NoirPackage, dependency: NoirDependencyConfig): Promise<NoirPackage | null> {
    // TODO accept ssh urls?
    // TODO github authentication?
    if (!('git' in dependency) || !dependency.git.startsWith('https://github.com')) {
      return null;
    }

    const archivePath = await this.#fetchZipFromGithub(dependency);
    const libPath = await this.#extractZip(dependency, archivePath);
    return NoirPackage.atPath(libPath, this.#fm);
  }

  async #fetchZipFromGithub(dependency: Pick<NoirGitDependencyConfig, 'git' | 'tag'>): Promise<string> {
    if (!dependency.git.startsWith('https://github.com')) {
      throw new Error('Only github dependencies are supported');
    }

    const url = new URL(`${dependency.git}/archive/${dependency.tag ?? 'HEAD'}.zip`);
    const localArchivePath = join(
      'archives',
      url.pathname
        // remove leading slash
        .slice(1)
        .replaceAll(sep, '_'),
    );

    // TODO should check signature before accepting any file
    if (this.#fm.hasFileSync(localArchivePath)) {
      this.#log('using cached archive', { url: url.href, path: localArchivePath });
      return localArchivePath;
    }

    const response = await fetch(url, {
      method: 'GET',
    });

    if (!response.ok || !response.body) {
      throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
    }

    await this.#fm.writeFile(localArchivePath, response.body);
    return localArchivePath;
  }

  async #extractZip(dependency: NoirGitDependencyConfig, archivePath: string): Promise<string> {
    const gitUrl = new URL(dependency.git);
    const extractLocation = join(
      'libs',
      gitUrl.pathname
        // remove leading slash
        .slice(1)
        .replaceAll('/', '_') +
        '@' +
        (dependency.tag ?? 'HEAD'),
    );
    const packagePath = join(extractLocation, dependency.directory ?? '');

    // TODO check contents before reusing old results
    if (this.#fm.hasFileSync(packagePath)) {
      return packagePath;
    }

    const { entries } = await unzip(this.#fm.readFileSync(archivePath, 'binary'));

    for (const entry of Object.values(entries)) {
      if (entry.isDirectory) {
        continue;
      }

      const name = stripSegments(entry.name, 1);
      if (dependency.directory && !name.startsWith(dependency.directory)) {
        continue;
      }
      const path = join(extractLocation, name);
      await this.#fm.writeFile(path, (await entry.blob()).stream());
    }

    return packagePath;
  }
}

/**
 * Strips the first n segments from a path
 */
function stripSegments(path: string, count: number): string {
  const segments = path.split(sep).filter(Boolean);
  return segments.slice(count).join(sep);
}