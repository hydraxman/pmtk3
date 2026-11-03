import type { ChapterGuide } from './content.js';
export interface PublicImage { url: string; title: string; sha256: string; kind: 'original' | 'reproduction' }
export interface PublicDemo {
  id: string; title: string; description: string; source: string; sourceSha256: string;
  chapters: string[]; guide: string; runnable: boolean;
  status: string; kind: 'original' | 'reproduction' | 'helper' | 'unavailable';
  imageCount: number; thumbnail?: PublicImage; detail: string;
}
export interface PublicDetail extends PublicDemo {
  images: PublicImage[];
  attempt?: { id: string; finishedAt: string; seconds?: number };
  reproduction?: { method: string; description: string; differences: string[];
    seed: number; metrics: Record<string, string | number>; checks: { name: string; passed: boolean; detail?: string }[] };
}
export interface PublicCatalog {
  schema: 1; generatedAt: string; sourceCommit: string; repository: string;
  chapters: (ChapterGuide & { count: number })[];
  guides: ChapterGuide[];
  stats: { sources: number; runnable: number; originalSuccesses: number; reproductions: number;
    mapped: number; unmapped: number; uniqueImages: number; chapterCount: number };
  entries: PublicDemo[];
}
