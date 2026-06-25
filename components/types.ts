import type { ValidationResult } from "../lib/contentValidation";

export type {
  ValidationResult,
  ValidationCheck,
} from "../lib/contentValidation";

export interface Article {
  url: string;
  title_en: string;
  title_th: string;
  date: string;
  // Top-level Minghui section (e.g. "Cultivation"); subcategory is the leaf
  // (e.g. "Cultivation Insights"). Both are derived from the article breadcrumb.
  category?: string;
  subcategory?: string;
  filePath?: string;
  // Set by the content validator. Lives on the lightweight catalog entry so the
  // "Needs review" tab can filter from the per-day index without loading each
  // article's full JSON.
  status?: "PASS" | "FAILED";
  statusDesc?: string;
}

export interface ArticleDetails {
  published_date: string;
  category: string;
  subcategory?: string;
  url: string;
  title_th: string;
  title_en: string;
  content_th: string;
  content_en: string;
  // Full per-rule validation detail, persisted in the per-article JSON.
  validation?: ValidationResult;
}
