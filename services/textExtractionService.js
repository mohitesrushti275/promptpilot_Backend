import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');
const mammoth = require('mammoth');

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

      case 'doc': {
        let WordExtractor;
        try {
          WordExtractor = require('word-extractor');
        } catch {
          throw new Error('.doc extraction unavailable: word-extractor is not installed on this server.');
        }
        const extractor = new WordExtractor();
        const doc = await extractor.extract(buffer);
        return doc.getBody();
      }

      case 'txt':
      case 'md':
      case 'json':
      case 'csv':
        return buffer.toString('utf8');

      default:
        return buffer.toString('utf8');
    }
  } catch (error) {
    console.error(`[Extraction Service] Failed to extract text from ${originalname}:`, error);
    throw new Error(`Failed to extract text from ${originalname}: ${error.message}`);
  }
}
