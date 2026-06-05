import { atom } from 'nanostores'

import { persistString, storedString } from '@/lib/storage'

export type AppLanguage = 'en' | 'zh'

export const APP_LANGUAGE_STORAGE_KEY = 'hermes.desktop.language.v1'
export const APP_LANGUAGES: readonly AppLanguage[] = ['en', 'zh']

export function normalizeAppLanguage(value: null | string | undefined): AppLanguage {
  return value === 'en' ? 'en' : 'zh'
}

export const $appLanguage = atom<AppLanguage>(normalizeAppLanguage(storedString(APP_LANGUAGE_STORAGE_KEY)))

$appLanguage.subscribe(language => persistString(APP_LANGUAGE_STORAGE_KEY, language))

export function setAppLanguage(language: AppLanguage) {
  $appLanguage.set(normalizeAppLanguage(language))
}
