import {
  $appLanguage,
  APP_LANGUAGE_STORAGE_KEY,
  APP_LANGUAGES,
  type AppLanguage,
  normalizeAppLanguage,
  setAppLanguage
} from './app-language'

export type WorkflowLanguage = AppLanguage

export const WORKFLOW_LANGUAGE_STORAGE_KEY = APP_LANGUAGE_STORAGE_KEY
export const WORKFLOW_LANGUAGES = APP_LANGUAGES

export const normalizeWorkflowLanguage = normalizeAppLanguage
export const $workflowLanguage = $appLanguage

export function setWorkflowLanguage(language: WorkflowLanguage) {
  setAppLanguage(language)
}
