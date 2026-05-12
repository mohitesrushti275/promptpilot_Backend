import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const WordExtractor = require('word-extractor');

/**
 * Extracts text from various file formats.
 * Supports: .pdf, .docx, .doc, .txt, .md, .json
 */
export async function extractTextFromBuffer(buffer, originalname) {
  const extension = originalname.split('.').pop().toLowerCase();

  try {
    switch (extension) {
      case 'pdf':
        const pdfData = await pdf(buffer);
        return pdfData.text;

      case 'docx':
        const docxResult = await mammoth.extractRawText({ buffer });
        return docxResult.value;

      case 'doc':
        const extractor = new WordExtractor();
        const doc = await extractor.extract(buffer);
        return doc.getBody();

      case 'txt':
      case 'md':
      case 'json':
      case 'csv':
        return buffer.toString('utf8');

      default:
        // Try as text as a fallback if it's a known text-like extension or no extension
        return buffer.toString('utf8');
    }
  } catch (error) {
    console.error(`[Extraction Service] Failed to extract text from ${originalname}:`, error);
    throw new Error(`Failed to extract text from ${originalname}: ${error.message}`);
  }
}
