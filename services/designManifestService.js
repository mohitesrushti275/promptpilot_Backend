import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '..', 'data.json');

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
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('[DesignManifestService] Error writing data:', err);
  }
}

/**
 * Persists the generated design manifest from a reference URL.
 * @param {Object} manifestData 
 */
export function saveManifest(manifestData) {
  console.log(`[DesignManifestService] Saving manifest for ${manifestData.referenceUrl || 'Manual Input'}`);
  const data = readData();
  
  const newManifest = {
    id: manifestData.id || Date.now().toString(),
    createdAt: new Date().toISOString(),
    ...manifestData
  };
  
  // If manifest with same ID exists, update it, otherwise push
  const index = data.designManifests.findIndex(m => m.id === newManifest.id);
  if (index !== -1) {
    data.designManifests[index] = newManifest;
  } else {
    data.designManifests.push(newManifest);
  }
  
  writeData(data);
  
  console.log(`[DesignManifestService] Manifest saved successfully with ID: ${newManifest.id}`);
  return newManifest;
}

/**
 * Retrieves a stored manifest by ID.
 * @param {string} id 
 */
export function getManifest(id) {
  const data = readData();
  return data.designManifests.find(m => m.id === id);
}
