import type { StoredValidation } from "../lib/contentValidation";

export type {
  ValidationResult,
  ValidationCheck,
  StoredValidation,
  StoredFailure,
} from "../lib/contentValidation";

// The catalog/list-item type is defined in the storage layer (lib/gdrive) as the
// single source of truth, and re-exported here so UI code keeps importing all its
// types from one module. `export type` is erased at compile time, so no googleapis
// runtime reaches the client bundle.
export type { Article } from "../lib/gdrive";

export interface ArticleDetails {
  // The article's publish date (YYYY-MM-DD).
  date: string;
  // Optional: a missing breadcrumb leaves category unset rather than defaulting to
  // a real section, so the reader simply omits the badge.
  category?: string;
  subcategory?: string;
  url: string;
  title_th: string;
  title_en: string;
  content_th: string;
  content_en: string;
  // Slim, text-free validation record persisted in the per-article JSON.
  validation?: StoredValidation;
}
