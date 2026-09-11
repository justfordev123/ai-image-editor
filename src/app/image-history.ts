import type { GeneratedImage } from './models';

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('creaition-images', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('images', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readHistory(): Promise<GeneratedImage[]> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('images').objectStore('images').getAll();
      request.onsuccess = () =>
        resolve((request.result as GeneratedImage[]).sort((a, b) => b.createdAt - a.createdAt));
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function saveHistory(images: GeneratedImage[]): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('images', 'readwrite');
      const store = transaction.objectStore('images');
      store.clear();
      images.forEach((image) => store.put(image));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
