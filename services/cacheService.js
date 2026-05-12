import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_DIR = path.join(__dirname, '..', 'cache');
const PROMPT_CACHE_FILE = path.join(CACHE_DIR, 'prompt_cache.json');
const CONTENT_CACHE_FILE = path.join(CACHE_DIR, 'content_cache.json');
const ANALYSIS_CACHE_FILE = path.join(CACHE_DIR, 'analysis_cache.json');

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function loadCache(file) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (err) {
    console.error(`[CacheService] Error loading cache ${file}:`, err.message);
  }
  return {};
}

function saveCache(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`[CacheService] Error saving cache ${file}:`, err.message);
  }
}

let promptCache = loadCache(PROMPT_CACHE_FILE);
let contentCache = loadCache(CONTENT_CACHE_FILE);
let analysisCache = loadCache(ANALYSIS_CACHE_FILE);

export function getPromptFromCache(hash) {
  return promptCache[hash];
}

export function setPromptToCache(hash, prompt) {
  promptCache[hash] = prompt;
  saveCache(PROMPT_CACHE_FILE, promptCache);
}

export function getContentSummaryFromCache(hash) {
  return contentCache[hash];
}

export function setContentSummaryToCache(hash, summary) {
  contentCache[hash] = summary;
  saveCache(CONTENT_CACHE_FILE, contentCache);
}

export function getAnalysisFromCache(hash) {
  return analysisCache[hash];
}

export function setAnalysisToCache(hash, analysis) {
  analysisCache[hash] = analysis;
  saveCache(ANALYSIS_CACHE_FILE, analysisCache);
}

export function generateHash(data) {
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  return crypto.createHash('md5').update(str).digest('hex');
}
