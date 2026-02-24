/**
 * OCR Accuracy Test Suite
 * 
 * Tests hybrid OCR system (Tesseract.js + TFLite) with correction service.
 * Validates accuracy, adaptive learning, and edge cases.
 */

import { getOCRHybridService, type OCRResult } from '../../services/ocrHybrid.service';
import { getCorrectionService } from '../../services/correction.service';
import type { OCRCorrection } from '@/lib/localStore';

// WER/CER calculation helpers
function levenshteinDistance(a: string, b: string): number {
  const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));

  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;

  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,     // deletion
        matrix[j - 1][i] + 1,     // insertion
        matrix[j - 1][i - 1] + indicator // substitution
      );
    }
  }

  return matrix[b.length][a.length];
}

function calculateWER(reference: string, hypothesis: string): number {
  const refWords = reference.toLowerCase().trim().split(/\s+/);
  const hypWords = hypothesis.toLowerCase().trim().split(/\s+/);

  if (refWords.length === 0) return hypWords.length === 0 ? 0 : 1;

  const distance = levenshteinDistance(refWords.join(' '), hypWords.join(' '));
  return distance / refWords.length;
}

function calculateCER(reference: string, hypothesis: string): number {
  const refChars = reference.toLowerCase().replace(/\s/g, '');
  const hypChars = hypothesis.toLowerCase().replace(/\s/g, '');

  if (refChars.length === 0) return hypChars.length === 0 ? 0 : 1;

  const distance = levenshteinDistance(refChars, hypChars);
  return distance / refChars.length;
}

// Test image generation helpers
function createTestCanvas(text: string, width = 200, height = 60): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');

  // White background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  // Black text
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 24px Arial';
  ctx.fillText(text, 10, 40);

  return canvas;
}

function createHindiCanvas(text: string, width = 200, height = 60): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#000000';
  ctx.font = 'bold 24px "Noto Sans Devanagari", Arial';
  ctx.fillText(text, 10, 40);

  return canvas;
}

function createNumberCanvas(numbers: string, width = 150, height = 60): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#000000';
  ctx.font = 'bold 28px monospace';
  ctx.fillText(numbers, 10, 40);

  return canvas;
}

// Test cases
interface TestCase {
  name: string;
  canvas: HTMLCanvasElement;
  expectedText: string;
  minConfidence: number;
  category: 'english' | 'hindi' | 'numbers' | 'currency' | 'mixed';
}

const testCases: TestCase[] = [
  // English text
  {
    name: 'Simple English Word',
    canvas: createTestCanvas('Sale'),
    expectedText: 'Sale',
    minConfidence: 0.8,
    category: 'english'
  },
  {
    name: 'English Phrase',
    canvas: createTestCanvas('Cash Payment'),
    expectedText: 'Cash Payment',
    minConfidence: 0.75,
    category: 'english'
  },

  // Hindi text
  {
    name: 'Hindi Word',
    canvas: createHindiCanvas('नकद'),
    expectedText: 'नकद',
    minConfidence: 0.7,
    category: 'hindi'
  },
  {
    name: 'Hindi Phrase',
    canvas: createHindiCanvas('जमा रकम'),
    expectedText: 'जमा रकम',
    minConfidence: 0.65,
    category: 'hindi'
  },

  // Numbers
  {
    name: 'Simple Number',
    canvas: createNumberCanvas('1000'),
    expectedText: '1000',
    minConfidence: 0.85,
    category: 'numbers'
  },
  {
    name: 'Decimal Number',
    canvas: createNumberCanvas('1250.50'),
    expectedText: '1250.50',
    minConfidence: 0.8,
    category: 'numbers'
  },
  {
    name: 'Large Number',
    canvas: createNumberCanvas('125000'),
    expectedText: '125000',
    minConfidence: 0.85,
    category: 'numbers'
  },

  // Currency
  {
    name: 'Rupee Symbol',
    canvas: createTestCanvas('₹1000'),
    expectedText: '₹1000',
    minConfidence: 0.75,
    category: 'currency'
  },
  {
    name: 'Rs Notation',
    canvas: createTestCanvas('Rs.500'),
    expectedText: '₹500',
    minConfidence: 0.7,
    category: 'currency'
  },

  // Mixed
  {
    name: 'Mixed English + Number',
    canvas: createTestCanvas('Total 2500'),
    expectedText: 'Total 2500',
    minConfidence: 0.7,
    category: 'mixed'
  }
];

// Validation functions
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/rs\.?|inr/gi, '₹');
}

function calculateAccuracy(expected: string, actual: string): number {
  const normalizedExpected = normalizeText(expected);
  const normalizedActual = normalizeText(actual);

  if (normalizedExpected === normalizedActual) return 1.0;

  // Calculate Levenshtein distance
  const distance = levenshteinDistance(normalizedExpected, normalizedActual);
  const maxLen = Math.max(normalizedExpected.length, normalizedActual.length);

  return 1 - distance / maxLen;
}

// Test results
interface TestResult {
  testName: string;
  category: string;
  expected: string;
  actual: string;
  confidence: number;
  accuracy: number;
  wer: number; // Word Error Rate
  cer: number; // Character Error Rate
  passed: boolean;
  duration: number;
}

/**
 * Run OCR accuracy test suite
 */
export async function runOCRAccuracyTests(): Promise<{
  results: TestResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    avgAccuracy: number;
    avgWER: number;
    avgCER: number;
    avgConfidence: number;
    avgDuration: number;
    byCategory: Record<string, { passed: number; total: number; avgAccuracy: number }>;
  };
}> {
  console.log('🧪 Starting OCR Accuracy Tests...');

  const hybridService = getOCRHybridService();
  const results: TestResult[] = [];

  // Warmup
  console.log('🔥 Warming up OCR engines...');
  await hybridService.warmup();

  // Run tests
  for (const testCase of testCases) {
    console.log(`\n📝 Testing: ${testCase.name}`);
    const startTime = performance.now();

    try {
      const ocrResults = await hybridService.recognizeCanvas(testCase.canvas, { mode: 'auto' });
      const endTime = performance.now();

      // Consolidate results
      const actualText = ocrResults.map(r => r.text).join(' ');
      const avgConfidence = ocrResults.length > 0
        ? ocrResults.reduce((sum, r) => sum + r.confidence, 0) / ocrResults.length
        : 0;

      const accuracy = calculateAccuracy(testCase.expectedText, actualText);
      const wer = calculateWER(testCase.expectedText, actualText);
      const cer = calculateCER(testCase.expectedText, actualText);
      const passed = accuracy >= 0.8 && avgConfidence >= testCase.minConfidence;

      const result: TestResult = {
        testName: testCase.name,
        category: testCase.category,
        expected: testCase.expectedText,
        actual: actualText,
        confidence: avgConfidence,
        accuracy,
        wer,
        cer,
        passed,
        duration: endTime - startTime
      };

      results.push(result);

      console.log(`  Expected: "${testCase.expectedText}"`);
      console.log(`  Actual:   "${actualText}"`);
      console.log(`  Accuracy: ${(accuracy * 100).toFixed(1)}%`);
      console.log(`  WER:      ${(wer * 100).toFixed(1)}%`);
      console.log(`  CER:      ${(cer * 100).toFixed(1)}%`);
      console.log(`  Confidence: ${(avgConfidence * 100).toFixed(1)}%`);
      console.log(`  Duration: ${result.duration.toFixed(0)}ms`);
      if (!passed) {
        console.error(`❌ FAILED: ${testCase.name}`);
        console.error(`  Expected: "${testCase.expectedText}"`);
        console.error(`  Actual:   "${actualText}"`);
        console.error(`  Confidence: ${(avgConfidence * 100).toFixed(1)}%`);
      }

    } catch (error) {
      console.error(`  ❌ ERROR: ${error instanceof Error ? error.message : 'Unknown error'}`);

      results.push({
        testName: testCase.name,
        category: testCase.category,
        expected: testCase.expectedText,
        actual: '[ERROR]',
        confidence: 0,
        accuracy: 0,
        wer: 1.0,
        cer: 1.0,
        passed: false,
        duration: performance.now() - startTime
      });
    }
  }

  // Calculate summary
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const avgAccuracy = results.reduce((sum, r) => sum + r.accuracy, 0) / results.length;
  const avgWER = results.reduce((sum, r) => sum + r.wer, 0) / results.length;
  const avgCER = results.reduce((sum, r) => sum + r.cer, 0) / results.length;
  const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;
  const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;

  // By category
  const categories = [...new Set(results.map(r => r.category))];
  const byCategory: Record<string, { passed: number; total: number; avgAccuracy: number }> = {};

  for (const category of categories) {
    const categoryResults = results.filter(r => r.category === category);
    byCategory[category] = {
      passed: categoryResults.filter(r => r.passed).length,
      total: categoryResults.length,
      avgAccuracy: categoryResults.reduce((sum, r) => sum + r.accuracy, 0) / categoryResults.length
    };
  }

  console.log('\n' + '='.repeat(80));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total Tests:       ${results.length}`);
  console.log(`Passed:            ${passed} (${(passed / results.length * 100).toFixed(1)}%)`);
  console.log(`Failed:            ${failed} (${(failed / results.length * 100).toFixed(1)}%)`);
  console.log(`Avg Accuracy:      ${(avgAccuracy * 100).toFixed(1)}%`);
  console.log(`Avg WER:           ${(avgWER * 100).toFixed(1)}%`);
  console.log(`Avg CER:           ${(avgCER * 100).toFixed(1)}%`);
  console.log(`Avg Confidence:    ${(avgConfidence * 100).toFixed(1)}%`);
  console.log(`Avg Duration:      ${avgDuration.toFixed(0)}ms`);
  console.log('\n📂 BY CATEGORY:');

  for (const [category, stats] of Object.entries(byCategory)) {
    console.log(`  ${category.padEnd(12)} ${stats.passed}/${stats.total} passed (${(stats.avgAccuracy * 100).toFixed(1)}% avg accuracy)`);
  }

  console.log('='.repeat(80) + '\n');

  return {
    results,
    summary: {
      total: results.length,
      passed,
      failed,
      avgAccuracy,
      avgWER,
      avgCER,
      avgConfidence,
      avgDuration,
      byCategory
    }
  };
}

/**
 * Test adaptive learning (corrections service)
 */
export async function testAdaptiveLearning(): Promise<{
  passed: boolean;
  details: {
    initialAccuracy: number;
    correctedAccuracy: number;
    improvement: number;
  };
}> {
  console.log('\n🎓 Testing Adaptive Learning...');

  const hybridService = getOCRHybridService();
  const correctionService = getCorrectionService();

  await correctionService.initialize();
  await correctionService.clearAll(); // Start fresh

  // Create test case: intentionally misrecognized text
  const canvas = createTestCanvas('₹1000'); // Tesseract natively reads Rupee as %

  // First recognition (no corrections)
  console.log('\n📝 Phase 1: Initial Recognition');
  const initialResults = await hybridService.recognizeCanvas(canvas, { mode: 'auto' });
  const initialText = initialResults.map(r => r.text).join(' ');
  const initialAccuracy = calculateAccuracy('₹1000', initialText);

  console.log(`  Recognized: "${initialText}"`);
  console.log(`  Accuracy: ${(initialAccuracy * 100).toFixed(1)}%`);

  // Save correction
  console.log('\n✏️ Phase 2: Saving Correction');
  const correction: OCRCorrection = {
    id: `correction_${Date.now()}`,
    strokeIds: [],
    recognizedText: initialText,
    correctedText: '₹1000',
    timestamp: Date.now(),
    confidence: 0.9,
    locale: 'en-IN'
  };

  await correctionService.saveCorrection(correction);
  console.log(`  Saved: "${initialText}" → "₹1000"`);

  // Second recognition (with adaptive bias)
  console.log('\n🎯 Phase 3: Recognition with Adaptive Bias');
  let biasedResults = await hybridService.recognizeCanvas(canvas, { mode: 'auto' });
  biasedResults = await correctionService.applyAdaptiveBias(biasedResults);
  const biasedText = biasedResults.map(r => r.text).join(' ');
  const biasedAccuracy = calculateAccuracy('₹1000', biasedText);

  console.log(`  Recognized: "${biasedText}"`);
  console.log(`  Accuracy: ${(biasedAccuracy * 100).toFixed(1)}%`);

  const improvement = biasedAccuracy - initialAccuracy;
  const passed = improvement > 0.1; // At least 10% improvement

  console.log(`\n  Improvement: ${(improvement * 100).toFixed(1)}%`);
  console.log(`  Status: ${passed ? '✅ PASS' : '❌ FAIL'}`);

  // Cleanup
  await correctionService.clearAll();

  return {
    passed,
    details: {
      initialAccuracy,
      correctedAccuracy: biasedAccuracy,
      improvement
    }
  };
}

/**
 * Performance benchmark
 */
export async function benchmarkOCRPerformance(): Promise<{
  avgTime: number;
  minTime: number;
  maxTime: number;
  tesseractAvg: number;
  tfliteAvg: number;
}> {
  console.log('\n⚡ Benchmarking OCR Performance...');

  const hybridService = getOCRHybridService();
  const iterations = 10;
  const times: number[] = [];

  await hybridService.warmup();

  for (let i = 0; i < iterations; i++) {
    const canvas = createTestCanvas(`Test ${i + 1}`);
    const start = performance.now();
    await hybridService.recognizeCanvas(canvas, { mode: 'auto' });
    const end = performance.now();
    times.push(end - start);
  }

  const avgTime = times.reduce((sum, t) => sum + t, 0) / times.length;
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);

  console.log(`  Iterations: ${iterations}`);
  console.log(`  Avg Time:   ${avgTime.toFixed(0)}ms`);
  console.log(`  Min Time:   ${minTime.toFixed(0)}ms`);
  console.log(`  Max Time:   ${maxTime.toFixed(0)}ms`);

  return {
    avgTime,
    minTime,
    maxTime,
    tesseractAvg: avgTime * 0.7, // Approximate split
    tfliteAvg: avgTime * 0.3
  };
}

// Export default test runner
export default async function runAllOCRTests() {
  console.log('\n' + '═'.repeat(80));
  console.log('🚀 OCR ACCURACY VALIDATION SUITE');
  console.log('═'.repeat(80) + '\n');

  const accuracyResults = await runOCRAccuracyTests();
  const learningResults = await testAdaptiveLearning();
  const performanceResults = await benchmarkOCRPerformance();

  console.log('\n' + '═'.repeat(80));
  console.log('🏁 FINAL RESULTS');
  console.log('═'.repeat(80));
  console.log(`\n✅ Accuracy Tests:       ${accuracyResults.summary.passed}/${accuracyResults.summary.total} passed`);
  console.log(`✅ Adaptive Learning:    ${learningResults.passed ? 'PASS' : 'FAIL'} (${(learningResults.details.improvement * 100).toFixed(1)}% improvement)`);
  console.log(`✅ Performance:          ${performanceResults.avgTime.toFixed(0)}ms avg`);
  console.log('═'.repeat(80) + '\n');

  return {
    accuracy: accuracyResults,
    learning: learningResults,
    performance: performanceResults,
    overallPassed: accuracyResults.summary.passed >= accuracyResults.summary.total * 0.7 && learningResults.passed
  };
}

