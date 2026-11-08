/**
 * The Credits screen's content: the data sources and components the app is built from,
 * with their licences. Each licence's full text is a file in `licenses/` at the repo root,
 * bundled into the app from there.
 */

/** Every licence text in `licenses/`, by its path there, e.g. `camel-tools.txt`. */
export const LICENSE_TEXTS: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../../licenses/**/*.txt', { query: '?raw', import: 'default', eager: true }),
  ).map(([path, text]) => [path.replace('../../licenses/', ''), text]),
);

export interface Credit {
  name: string;
  /** What the app uses it for. */
  use: string;
  /** Who made it, as they ask to be credited. */
  by: string;
  licence: string;
  url: string;
  /** Licence text files in `licenses/`; empty when the terms live with the service. */
  files: string[];
  /** Anything else the attribution asks for, e.g. a citation. */
  note?: string;
}

export interface CreditGroup {
  title: string;
  credits: Credit[];
}

const PYTHON_PACKAGES: Array<[name: string, licence: string, file: string]> = [
  ['cachetools', 'MIT', 'cachetools.txt'],
  ['certifi', 'MPL 2.0', 'certifi.txt'],
  ['charset-normalizer', 'MIT', 'charset_normalizer.txt'],
  ['colorama', 'BSD 3-Clause', 'colorama.txt'],
  ['docopt', 'MIT', 'docopt.txt'],
  ['editdistance', 'MIT', 'editdistance.txt'],
  ['emoji', 'BSD 3-Clause', 'emoji.txt'],
  ['idna', 'BSD 3-Clause', 'idna.txt'],
  ['muddler', 'MIT', 'muddler.txt'],
  ['pyrsistent', 'MIT', 'pyrsistent.txt'],
  ['regex', 'Apache 2.0 and CNRI-Python', 'regex.txt'],
  ['requests', 'Apache 2.0', 'requests.txt'],
  ['six', 'MIT', 'six.txt'],
  ['tqdm', 'MPL 2.0 and MIT', 'tqdm.txt'],
  ['urllib3', 'MIT', 'urllib3.txt'],
];

export const CREDITS: CreditGroup[] = [
  {
    title: 'Word data',
    credits: [
      {
        name: 'Wiktionary',
        use: 'Definitions, etymologies and quick glosses, from the English Wiktionary’s Arabic entries (only their headword, part of speech, senses and etymology are kept).',
        by: 'Wiktionary contributors',
        licence: 'CC BY-SA 4.0',
        url: 'https://en.wiktionary.org',
        files: ['wiktionary-CC-BY-SA-4.0.txt'],
      },
      {
        name: 'wiktextract and kaikki.org',
        use: 'Extracted the Wiktionary entries the dictionary is built from.',
        by: 'Tatu Ylonen',
        licence: 'Attribution requested',
        url: 'https://kaikki.org',
        files: [],
        note: 'Tatu Ylonen. 2022. Wiktextract: Wiktionary as Machine-Readable Structured Data. In Proceedings of LREC 2022.',
      },
      {
        name: 'Tatoeba',
        use: 'Arabic–English example sentences.',
        by: 'Tatoeba contributors',
        licence: 'CC BY 2.0 FR',
        url: 'https://tatoeba.org',
        files: ['tatoeba-CC-BY-2.0-FR.txt'],
      },
    ],
  },
  {
    title: 'Arabic analysis',
    credits: [
      {
        name: 'CAMeL Tools',
        use: 'Finds each word’s Lemma, root, pattern, part of speech and pronunciation.',
        by: 'CAMeL Lab, New York University Abu Dhabi',
        licence: 'MIT',
        url: 'https://github.com/CAMeL-Lab/camel_tools',
        files: ['camel-tools.txt'],
        note: 'Ossama Obeid et al. 2020. CAMeL Tools: An Open Source Python Toolkit for Arabic Natural Language Processing. In Proceedings of LREC 2020.',
      },
      {
        name: 'CAMeL MSA morphology database and disambiguation model (calima-msa-r13)',
        use: 'The Modern Standard Arabic analyses CAMeL Tools chooses from.',
        by: 'CAMeL Lab; derived from Aramorph 1.2.1 (QAMUS LLC, Trustees of the University of Pennsylvania, Jon Dehdari)',
        licence: 'GPL v2',
        url: 'https://github.com/CAMeL-Lab/camel_tools',
        files: ['camel-msa-data-GPL-2.0.txt'],
      },
      {
        name: 'Python',
        use: 'Runs the Arabic analysis helper.',
        by: 'Python Software Foundation',
        licence: 'PSF License',
        url: 'https://www.python.org',
        files: ['python.txt'],
      },
      ...PYTHON_PACKAGES.map(
        ([name, licence, file]): Credit => ({
          name,
          use: 'A Python package the analysis helper uses.',
          by: `${name} authors`,
          licence,
          url: `https://pypi.org/project/${name}/`,
          files: [`python-packages/${file}`, ...(name === 'requests' ? ['python-packages/requests-NOTICE.txt'] : [])],
        }),
      ),
    ],
  },
  {
    title: 'App',
    credits: [
      {
        name: 'Electron',
        use: 'The desktop app shell. It includes Chromium, whose licences ship with the app as LICENSES.chromium.html.',
        by: 'Electron contributors, GitHub Inc.',
        licence: 'MIT',
        url: 'https://www.electronjs.org',
        files: ['electron.txt'],
      },
      {
        name: 'React',
        use: 'Draws the screens.',
        by: 'Meta Platforms, Inc. and affiliates',
        licence: 'MIT',
        url: 'https://react.dev',
        files: ['react.txt'],
      },
      {
        name: 'Noto Naskh Arabic',
        use: 'The Arabic typeface.',
        by: 'The Noto Project Authors',
        licence: 'SIL Open Font License 1.1',
        url: 'https://github.com/notofonts/arabic',
        files: ['noto-naskh-arabic-OFL-1.1.txt'],
      },
    ],
  },
  {
    title: 'Online services (with your own keys)',
    credits: [
      {
        name: 'Soniox',
        use: 'Speech-to-text.',
        by: 'Soniox',
        licence: 'Soniox terms of service',
        url: 'https://soniox.com',
        files: [],
      },
      {
        name: 'Deepgram',
        use: 'Speech-to-text, when there is no Soniox key.',
        by: 'Deepgram',
        licence: 'Deepgram terms of service',
        url: 'https://deepgram.com',
        files: [],
      },
      {
        name: 'Google Cloud Translation',
        use: 'Sentence translations.',
        by: 'Google',
        licence: 'Google Cloud terms of service',
        url: 'https://cloud.google.com/translate',
        files: [],
      },
    ],
  },
];
