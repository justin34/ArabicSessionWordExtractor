import { existsSync, readFileSync } from 'node:fs';
import type { Store } from '../store';
import type { DetailSection, WordDetails } from '../types';
import { builtInDetailModules, DEFAULT_DETAIL_MODULES, type DetailModule, type DetailSources } from './modules';

/**
 * Which Detail Modules the word panel shows, in order: a built-in module by its id, or a
 * module of its own. Leaving a module out disables it.
 */
export type DetailModuleConfig = ReadonlyArray<string | DetailModule>;

/** A module that has not answered by then is skipped, so one slow source never holds the panel. */
const MODULE_TIMEOUT_MS = 5000;

/** The configured modules: unknown ids and repeats are skipped with a warning. */
export function resolveDetailModules(
  config: DetailModuleConfig,
  builtIns: Map<string, DetailModule>,
): DetailModule[] {
  const modules: DetailModule[] = [];
  const seen = new Set<string>();
  for (const item of config) {
    const module = typeof item === 'string' ? builtIns.get(item) : item;
    if (!module) {
      console.warn(`Unknown Detail Module "${String(item)}" is skipped.`);
      continue;
    }
    if (seen.has(module.id)) {
      console.warn(`Detail Module "${module.id}" is listed twice; only the first is shown.`);
      continue;
    }
    seen.add(module.id);
    modules.push(module);
  }
  return modules;
}

/**
 * The word panel's modules as configured in a JSON file holding an array of module ids,
 * e.g. `["form", "definitions", "sessions"]`. Undefined, for the default, when the file
 * does not exist or is not such an array.
 */
export function readDetailModuleConfig(path: string): string[] | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value;
    console.warn(`${path} is not an array of Detail Module ids; the default modules are shown.`);
  } catch (err) {
    console.warn(`${path} could not be read (${(err as Error).message}); the default modules are shown.`);
  }
  return undefined;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer after ${ms} ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** The click-a-word panel's content, built from the configured Detail Modules (ADR 0002). */
export class WordDetailsBuilder {
  private readonly modules: DetailModule[];

  constructor(
    private readonly store: Store,
    sources: DetailSources,
    config: DetailModuleConfig = DEFAULT_DETAIL_MODULES,
    private readonly timeoutMs = MODULE_TIMEOUT_MS,
  ) {
    this.modules = resolveDetailModules(config, builtInDetailModules(sources));
  }

  /** Ids of the modules shown, in order. */
  moduleIds(): string[] {
    return this.modules.map((m) => m.id);
  }

  /**
   * The sections of every enabled module for a Lemma, in configured order; `surface` is
   * the form clicked. A module that fails, times out or has no data is left out. Undefined
   * for a Lemma that is not in the Vocabulary.
   */
  async details(lemmaId: number, surface?: string): Promise<WordDetails | undefined> {
    const lemma = this.store.getLemma(lemmaId);
    if (!lemma) return undefined;
    const word = { lemma, surface };
    const results = await Promise.allSettled(
      this.modules.map((m) => withTimeout(Promise.resolve().then(() => m.build(word)), this.timeoutMs)),
    );
    const sections: DetailSection[] = [];
    results.forEach((result, i) => {
      const { id, title } = this.modules[i];
      if (result.status === 'rejected') {
        console.error(`Detail Module "${id}" failed for Lemma ${lemmaId}:`, result.reason);
        return;
      }
      const blocks = result.value?.filter(Boolean) ?? [];
      if (blocks.length > 0) sections.push({ moduleId: id, title, blocks });
    });
    return { lemmaId: lemma.id, lemma: lemma.lemma, sections };
  }
}
