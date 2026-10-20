const FILE_NAME = 'awc_tracker_users.json';

export async function writeDataToFile(dataObj) {
  const jsonStr = JSON.stringify(dataObj, null, 2);
  if (navigator.storage && navigator.storage.getDirectory) {
    try {
      const root = await navigator.storage.getDirectory();
      const fileHandle = await root.getFileHandle(FILE_NAME, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(jsonStr);
      await writable.close();
      return true;
    } catch (e) {
      console.warn('Failed writing to OPFS file:', e);
    }
  }
  localStorage.setItem('awc_tracker_users_fallback', jsonStr);
  return false;
}

export async function readDataFromFile() {
  if (navigator.storage && navigator.storage.getDirectory) {
    try {
      const root = await navigator.storage.getDirectory();
      const fileHandle = await root.getFileHandle(FILE_NAME);
      const file = await fileHandle.getFile();
      const text = await file.text();
      return JSON.parse(text);
    } catch (e) {
      // First boot: file may not exist yet
    }
  }
  const fallback = localStorage.getItem('awc_tracker_users_fallback');
  if (fallback) {
    try {
      return JSON.parse(fallback);
    } catch (e) {}
  }
  return null;
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