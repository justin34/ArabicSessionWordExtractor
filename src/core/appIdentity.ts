/**
 * Who the app is to learners (GLOSSARY: Installer). The Installer's config in package.json
 * repeats these; a test keeps the two the same.
 */

export const APP_NAME = 'Arabic Session Word Extractor';
export const APP_ID = 'com.justin34.arabicsessionwordextractor';

/**
 * Development runs (`npm start`, `npm run dev`) keep their data in this folder under
 * %APPDATA%, the app's name before the rename, so they never touch a packaged build's data
 * (kept in %APPDATA%\Arabic Session Word Extractor).
 */
export const DEV_DATA_FOLDER = 'interactive-language-learning';

/** Where packaged builds look for updates: this repo's GitHub Releases. */
export const UPDATE_REPO = { owner: 'justin34', repo: 'ArabicSessionWordExtractor' } as const;
