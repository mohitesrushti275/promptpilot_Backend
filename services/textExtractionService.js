import { createRequire } from 'module';

const require = createRequire(import.meta.url);

let pdfParse;
let mammoth;
let WordExtractor;

function getPdfParse() {
  if (!pdfParse) pdfParse = require('pdf-parse');
  return pdfParse;
}

function getMammoth() {
  if (!mammoth) mammoth = require('mammoth');
  return mammoth;
}

function getWordExtractor() {
  if (!WordExtractor) WordExtractor = require('word-extractor');
  return WordExtractor;
}

/**
 * Extracts text from various file formats.
 * Supports: .pdf, .docx, .doc, .txt, .md, .json
 */
export async function extractTextFromBuffer(buffer, originalname) {
  const extension = originalname.split('.').pop().toLowerCase();

  try {
    switch (extension) {
      case 'pdf': {
        const pdf = getPdfParse();
        const pdfData = await pdf(buffer);
        return pdfData.text;
      }

      case 'docx': {
        const mammothLib = getMammoth();
        const docxResult = await mammothLib.extractRawText({ buffer });
        return docxResult.value;
      }

      case 'doc': {
        const WordExtractorClass = getWordExtractor();
        const extractor = new WordExtractorClass();
        const doc = await extractor.extract(buffer);
        return doc.getBody();
      }

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
