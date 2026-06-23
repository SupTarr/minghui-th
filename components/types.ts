export interface Article {
  url: string;
  title_en: string;
  title_th: string;
  date: string;
  filePath?: string;
}

export interface ArticleDetails {
  published_date: string;
  category: string;
  url: string;
  title_th: string;
  title_en: string;
  content_th: string;
  content_en: string;
}
