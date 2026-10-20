const FILE_NAME = 'awc_tracker_users.json';
const LS_KEY = 'awc_tracker_users';
const LS_FALLBACK_KEY = 'awc_tracker_users_fallback';

export async function writeDataToFile(dataObj) {
  if (!dataObj) return false;
  const jsonStr = JSON.stringify(dataObj, null, 2);

  // 1. Always guarantee synchronous persistence to LocalStorage
  try {
    localStorage.setItem(LS_KEY, jsonStr);
    localStorage.setItem(LS_FALLBACK_KEY, jsonStr);
  } catch (lsErr) {
    console.warn('LocalStorage write warning:', lsErr);
  }

  // 2. Also persist to OPFS if supported in this environment
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.getDirectory) {
    try {
      const root = await navigator.storage.getDirectory();
      const fileHandle = await root.getFileHandle(FILE_NAME, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(jsonStr);
      await writable.close();
      return true;
    } catch (opfsErr) {
      console.warn('OPFS write warning (fallback to localStorage active):', opfsErr);
    }
  }

  return true;
}

export async function readDataFromFile() {
  let result = null;

  // 1. Try reading from OPFS first if available
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.getDirectory) {
    try {
      const root = await navigator.storage.getDirectory();
      const fileHandle = await root.getFileHandle(FILE_NAME);
      const file = await fileHandle.getFile();
      const text = await file.text();
      if (text && text.trim().length > 0) {
        result = JSON.parse(text);
      }
    } catch (e) {
      // OPFS file may not exist yet or iframe restricted
    }
  }

  // 2. Check LocalStorage (which is always kept up to date)
  if (!result || !result.users || Object.keys(result.users).length === 0) {
    const raw = localStorage.getItem(LS_KEY) || localStorage.getItem(LS_FALLBACK_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && (parsed.users || parsed.lastActiveUser)) {
          result = parsed;
        }
      } catch (e) {
        console.warn('Failed parsing localStorage data:', e);
      }
    }
  }

  return result;
}

export function exportJsonFile(dataObj, fileName) {
  const jsonStr = JSON.stringify(dataObj, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}