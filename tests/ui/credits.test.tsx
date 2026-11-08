// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CREDITS, LICENSE_TEXTS } from '../../src/renderer/credits';
import { FakeBridge, renderApp } from './harness';

afterEach(cleanup);

const LICENSES_DIR = join(__dirname, '..', '..', 'licenses');

function licenceFiles(dir = LICENSES_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? licenceFiles(join(dir, e.name)) : [relative(LICENSES_DIR, join(dir, e.name)).replaceAll('\\', '/')],
  );
}

async function openCredits(bridge = new FakeBridge()) {
  const user = userEvent.setup();
  renderApp({ bridge });
  await user.click(screen.getByRole('button', { name: 'Credits' }));
  return { user };
}

const creditFor = (name: string) => screen.getByRole('link', { name }).closest('li') as HTMLElement;

describe('Credits screen', () => {
  it('credits CAMeL, Wiktionary and Tatoeba with their licences', async () => {
    await openCredits();

    expect(screen.getByRole('heading', { name: 'Credits and licences' })).toBeTruthy();
    expect(within(creditFor('CAMeL Tools')).getByText('MIT')).toBeTruthy();
    expect(within(creditFor('CAMeL MSA morphology database and disambiguation model (calima-msa-r13)')).getByText('GPL v2')).toBeTruthy();
    expect(within(creditFor('Wiktionary')).getByText('CC BY-SA 4.0')).toBeTruthy();
    expect(within(creditFor('Wiktionary')).getByText(/Wiktionary contributors/)).toBeTruthy();
    expect(within(creditFor('Tatoeba')).getByText('CC BY 2.0 FR')).toBeTruthy();
    expect(within(creditFor('wiktextract and kaikki.org')).getByText(/Ylonen.*LREC 2022/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Tatoeba' }).getAttribute('href')).toBe('https://tatoeba.org');
  });

  it('shows the full licence text kept in the repo', async () => {
    const { user } = await openCredits();

    await user.click(within(creditFor('Tatoeba')).getByRole('button', { name: /Show licence text/ }));
    const text = within(creditFor('Tatoeba')).getByLabelText('Licence text: tatoeba-CC-BY-2.0-FR.txt');
    expect(text.textContent).toMatch(/Paternité 2\.0/);
    expect(text.textContent).toMatch(/Contrat Public Creative Commons/);
  });

  it("shows the bundled dictionary's attribution notice when there is one", async () => {
    const bridge = new FakeBridge();
    bridge.notice = 'dictionary.db, built 2026-11-07\n\nDefinitions: English Wiktionary';
    await openCredits(bridge);

    expect((await screen.findByLabelText('Dictionary notice')).textContent).toMatch(/built 2026-11-07/);
  });
});

describe('Licence files', () => {
  it('every credited licence file is in licenses/, and every file there is credited', () => {
    const credited = CREDITS.flatMap((g) => g.credits.flatMap((c) => c.files));
    const onDisk = licenceFiles().filter((f) => f.endsWith('.txt'));

    expect(credited.filter((f) => LICENSE_TEXTS[f] === undefined)).toEqual([]);
    expect(onDisk.filter((f) => !credited.includes(f))).toEqual([]);
    expect(Object.keys(LICENSE_TEXTS).sort()).toEqual(onDisk.sort());
  });

  it('hold the full licence texts', () => {
    expect(LICENSE_TEXTS['wiktionary-CC-BY-SA-4.0.txt']).toMatch(/Attribution-ShareAlike 4\.0 International/);
    expect(LICENSE_TEXTS['camel-msa-data-GPL-2.0.txt']).toMatch(/GNU GENERAL PUBLIC LICENSE\s+Version 2/);
    expect(LICENSE_TEXTS['camel-tools.txt']).toMatch(/MIT License/);
  });
});
