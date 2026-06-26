import type { StoredValidation } from "../lib/contentValidation";
import type { ArticleCore } from "../lib/gdrive";

export type {
  ValidationResult,
  ValidationCheck,
  StoredValidation,
  StoredFailure,
} from "../lib/contentValidation";

// The shared article base and the catalog/list-item type are defined in the
// storage layer (lib/gdrive) as the single source of truth, and re-exported here
// so UI code keeps importing all its types from one module. `export type` is
// erased at compile time, so no googleapis runtime reaches the client bundle.
export type { ArticleCore, Article } from "../lib/gdrive";

// The full per-article record persisted to Drive and returned by /api/article.
// Extends ArticleCore (url, titles, date, category) with the body + validation,
// so its shared fields can't drift from the catalog Article. A missing breadcrumb
// leaves category unset (the reader omits the badge) rather than mislabeling it.
export interface ArticleDetails extends ArticleCore {
  content_th: string;
  content_en: string;
  // Slim, text-free validation record persisted in the per-article JSON.
  validation?: StoredValidation;
}
