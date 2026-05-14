import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '..', 'data.json');

const MAX_MANIFESTS = 50;

function readData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return { components: [], designManifests: [] };
    }
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!data.designManifests) {
      data.designManifests = [];
    }
    return data;
  } catch (err) {
    console.error('[DesignManifestService] Error reading data:', err);
    return { components: [], designManifests: [] };
  }
}

function writeData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data));
  } catch (err) {
    console.error('[DesignManifestService] Error writing data:', err);
  }
}

export function saveManifest(manifestData) {
  console.log(`[DesignManifestService] Saving manifest for ${manifestData.referenceUrl || 'Manual Input'}`);
  const data = readData();

  // Strip base64 screenshot — it's returned in the API response but not stored on disk
  const { screenshotUrl, ...persistable } = manifestData;

  const newManifest = {
    id: persistable.id || Date.now().toString(),
    createdAt: new Date().toISOString(),
    ...persistable
  };

  const index = data.designManifests.findIndex(m => m.id === newManifest.id);
  if (index !== -1) {
    data.designManifests[index] = newManifest;
  } else {
    data.designManifests.push(newManifest);
    // Keep only the most recent manifests to prevent unbounded growth
    if (data.designManifests.length > MAX_MANIFESTS) {
      data.designManifests = data.designManifests.slice(-MAX_MANIFESTS);
    }
  }

  writeData(data);

  console.log(`[DesignManifestService] Manifest saved successfully with ID: ${newManifest.id}`);
  return newManifest;
}

export function getManifest(id) {
  const data = readData();
  return data.designManifests.find(m => m.id === id);
}
