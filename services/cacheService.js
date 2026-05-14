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

const MAX_ENTRIES = 50;

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

function evictIfNeeded(cache) {
  const keys = Object.keys(cache);
  if (keys.length <= MAX_ENTRIES) return;
  const toRemove = keys.slice(0, keys.length - MAX_ENTRIES);
  for (const k of toRemove) delete cache[k];
}

// Lazily loaded — not populated at module import time
let promptCache = null;
let contentCache = null;
let analysisCache = null;

function getPromptCache() {
  if (!promptCache) promptCache = loadCache(PROMPT_CACHE_FILE);
  return promptCache;
}

function getContentCache() {
  if (!contentCache) contentCache = loadCache(CONTENT_CACHE_FILE);
  return contentCache;
}

function getAnalysisCache() {
  if (!analysisCache) analysisCache = loadCache(ANALYSIS_CACHE_FILE);
  return analysisCache;
}

export function getPromptFromCache(hash) {
  return getPromptCache()[hash];
}

export function setPromptToCache(hash, prompt) {
  const cache = getPromptCache();
  cache[hash] = prompt;
  evictIfNeeded(cache);
  saveCache(PROMPT_CACHE_FILE, cache);
}

export function getContentSummaryFromCache(hash) {
  return getContentCache()[hash];
}

export function setContentSummaryToCache(hash, summary) {
  const cache = getContentCache();
  cache[hash] = summary;
  evictIfNeeded(cache);
  saveCache(CONTENT_CACHE_FILE, cache);
}

export function getAnalysisFromCache(hash) {
  return getAnalysisCache()[hash];
}

export function setAnalysisToCache(hash, analysis) {
  const cache = getAnalysisCache();
  cache[hash] = analysis;
  evictIfNeeded(cache);
  saveCache(ANALYSIS_CACHE_FILE, cache);
}

export function generateHash(data) {
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  return crypto.createHash('md5').update(str).digest('hex');
}
