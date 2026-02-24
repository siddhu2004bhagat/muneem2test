/**
 * OCR Correction Service
 * 
 * Manages user corrections for adaptive learning and biasing.
 * Persists corrections securely in IndexedDB using AES-GCM encryption.
 * 
 * @module correction.service
 */

import {
  saveOCRCorrection,
  loadOCRCorrections,
  type OCRCorrection
} from '@/lib/localStore';
import type { OCRResult } from './ocrHybrid.service';

/**
 * Fuzzy match threshold (0-1)
 * Higher = more strict matching
 */
const FUZZY_THRESHOLD = 0.6;

/**
 * CorrectionService - Adaptive OCR Learning
 * 
 * Manages user corrections and applies adaptive biasing to recognition results.
 */
export class CorrectionService {
  private corrections: OCRCorrection[] = [];
  private correctionMap: Map<string, OCRCorrection> = new Map();
  private initialized = false;

  /**
   * Initialize service and load corrections from IndexedDB
   */
  async initialize(pin = '1234'): Promise<void> {
    if (this.initialized) return;

    try {
      this.corrections = await loadOCRCorrections(pin);
      this.buildCorrectionMap();
      this.initialized = true;
      console.log(`[CorrectionService] Loaded ${this.corrections.length} corrections`);
    } catch (error) {
      console.error('[CorrectionService] Failed to load corrections:', error);
      this.corrections = [];
      this.correctionMap.clear();
    }
  }

  /**
   * Build fast lookup map (normalized text -> correction)
   */
  private buildCorrectionMap(): void {
    this.correctionMap.clear();
    for (const correction of this.corrections) {
      const normalized = this.normalizeText(correction.recognizedText);
      this.correctionMap.set(normalized, correction);
    }
  }

  /**
   * Save a new correction
   */
  async saveCorrection(correction: OCRCorrection, pin = '1234'): Promise<void> {
    try {
      await saveOCRCorrection(correction, pin);
      this.corrections.push(correction);

      const normalized = this.normalizeText(correction.recognizedText);
      this.correctionMap.set(normalized, correction);

      console.log(`[CorrectionService] Saved correction: "${correction.recognizedText}" → "${correction.correctedText}"`);
    } catch (error) {
      console.error('[CorrectionService] Failed to save correction:', error);
      throw error;
    }
  }

  /**
   * List all corrections (optionally filtered)
   */
  async listCorrections(filter?: {
    locale?: string;
    minConfidence?: number;
    limit?: number;
  }): Promise<OCRCorrection[]> {
    if (!this.initialized) await this.initialize();

    let results = [...this.corrections];

    if (filter?.locale) {
      results = results.filter(c => c.locale === filter.locale);
    }

    if (filter?.minConfidence !== undefined) {
      results = results.filter(c => c.confidence >= filter.minConfidence);
    }

    if (filter?.limit) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  /**
   * Find correction by stroke ID
   */
  async findByStrokeId(strokeId: string): Promise<OCRCorrection | undefined> {
    if (!this.initialized) await this.initialize();
    return this.corrections.find(c => c.strokeIds.includes(strokeId));
  }

  /**
   * Apply adaptive bias to recognition results
   * 
   * Uses fuzzy matching to find similar recognized tokens in correction history
   * and replaces/boosts them accordingly.
   */
  async applyAdaptiveBias(recognizedTokens: OCRResult[]): Promise<OCRResult[]> {
    if (!this.initialized) await this.initialize();

    if (this.corrections.length === 0) {
      return recognizedTokens; // No corrections to apply
    }

    const biasedTokens: OCRResult[] = [];

    for (const token of recognizedTokens) {
      const normalized = this.normalizeText(token.text);

      // Exact match
      const exactMatch = this.correctionMap.get(normalized);
      if (exactMatch) {
        // Find if this is a sub-token replacement or full text.
        // We assume token length is smaller or equal.
        biasedTokens.push({
          ...token,
          text: exactMatch.correctedText,
          confidence: Math.min(0.95, token.confidence + 0.15), // Boost confidence
          tags: [...(token.tags || []), 'biased', 'exact-match']
        });
        continue;
      }

      // Fuzzy match
      const fuzzyMatch = this.findFuzzyMatch(normalized);
      if (fuzzyMatch && fuzzyMatch.score >= FUZZY_THRESHOLD) {
        biasedTokens.push({
          ...token,
          text: fuzzyMatch.correction.correctedText,
          confidence: Math.min(0.9, token.confidence + 0.1 * fuzzyMatch.score), // Boost based on match score
          tags: [...(token.tags || []), 'biased', 'fuzzy-match']
        });
        continue;
      }

      // No match, keep original
      biasedTokens.push(token);
    }

    return biasedTokens;
  }

  /**
   * Find fuzzy match using Levenshtein distance
   */
  private findFuzzyMatch(normalized: string): { correction: OCRCorrection; score: number } | null {
    let bestMatch: { correction: OCRCorrection; score: number } | null = null;

    for (const correction of this.corrections) {
      const candidateNormalized = this.normalizeText(correction.recognizedText);
      const score = this.similarity(normalized, candidateNormalized);

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { correction, score };
      }
    }

    return bestMatch;
  }

  /**
   * Calculate similarity score (0-1) using normalized Levenshtein distance
   */
  private similarity(a: string, b: string): number {
    if (a === b) return 1.0;
    if (a.length === 0 || b.length === 0) return 0.0;

    const distance = this.levenshteinDistance(a, b);
    const maxLen = Math.max(a.length, b.length);
    return 1 - distance / maxLen;
  }

  /**
   * Levenshtein distance (edit distance)
   */
  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * Normalize text for matching
   * - Lowercase
   * - Remove extra whitespace
   * - Normalize currency symbols
   * - Normalize digits
   * - Convert common misreads like 'O' to '0'
   */
  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/₹|rs\.?|inr/gi, '₹')
      .replace(/[०-९]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x0966 + 0x0030)) // Devanagari digits to ASCII
      .replace(/o/g, '0'); // Common OCR mistake mapping for numbers
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalCorrections: number;
    averageConfidence: number;
    locales: string[];
  } {
    if (this.corrections.length === 0) {
      return { totalCorrections: 0, averageConfidence: 0, locales: [] };
    }

    const avgConfidence = this.corrections.reduce((sum, c) => sum + c.confidence, 0) / this.corrections.length;
    const locales = [...new Set(this.corrections.map(c => c.locale).filter(Boolean))];

    return {
      totalCorrections: this.corrections.length,
      averageConfidence: avgConfidence,
      locales: locales as string[]
    };
  }

  /**
   * Clear all corrections (for testing/reset)
   */
  async clearAll(): Promise<void> {
    this.corrections = [];
    this.correctionMap.clear();
    console.log('[CorrectionService] Cleared all corrections');
  }
}

// Singleton instance
let correctionServiceInstance: CorrectionService | null = null;

/**
 * Get singleton CorrectionService instance
 */
export function getCorrectionService(): CorrectionService {
  if (!correctionServiceInstance) {
    correctionServiceInstance = new CorrectionService();
  }
  return correctionServiceInstance;
}

export default CorrectionService;

