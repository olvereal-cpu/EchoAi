import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db: ReturnType<typeof getFirestore>;

try {
  let configPath = path.join(__dirname, '..', 'firebase-applet-config.json');
  if (!fs.existsSync(configPath)) {
      // try fallback to cwd
      configPath = path.join(process.cwd(), 'firebase-applet-config.json');
  }
  
  if (fs.existsSync(configPath)) {
    const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
    console.log("🔥 Firebase initialized.");
  } else {
    console.warn("⚠️ Firebase config not found at path:", configPath);
  }
} catch (error) {
  console.error("🔥 Error initializing Firebase", error);
}

export { db };
