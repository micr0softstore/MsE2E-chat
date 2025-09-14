// crypto.js

const dbName = 'E2EEChatDB';
const keyStoreName = 'userKeys';

// --- IndexedDB Functions ---

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onerror = () => reject("Error opening IndexedDB.");
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = event => {
            const db = event.target.result;
            db.createObjectStore(keyStoreName, { keyPath: 'username' });
        };
    });
}

async function saveKeyToDB(username, key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([keyStoreName], 'readwrite');
        const store = transaction.objectStore(keyStoreName);
        const request = store.put({ username: username, privateKey: key });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject("Error saving key to DB.");
    });
}

async function getKeyFromDB(username) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([keyStoreName], 'readonly');
        const store = transaction.objectStore(keyStoreName);
        const request = store.get(username);
        request.onsuccess = () => resolve(request.result ? request.result.privateKey : null);
        request.onerror = () => reject("Error fetching key from DB.");
    });
}

// --- Web Crypto API Functions ---

async function generateKeys() {
    const keyPair = await window.crypto.subtle.generateKey(
        {
            name: 'RSA-OAEP',
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]), // 65537
            hash: 'SHA-256',
        },
        true, // extractable
        ['encrypt', 'decrypt']
    );
    return keyPair;
}

async function exportPublicKey(key) {
    const exported = await window.crypto.subtle.exportKey('spki', key);
    return window.btoa(String.fromCharCode.apply(null, new Uint8Array(exported)));
}

async function importPublicKey(pem) {
    const binaryDer = window.atob(pem);
    const binaryDerArr = new Uint8Array(binaryDer.length);
    for (let i = 0; i < binaryDer.length; i++) {
        binaryDerArr[i] = binaryDer.charCodeAt(i);
    }
    return window.crypto.subtle.importKey(
        'spki',
        binaryDerArr,
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        true,
        ['encrypt']
    );
}

async function encryptMessage(publicKey, message) {
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    return window.crypto.subtle.encrypt(
        { name: 'RSA-OAEP' },
        publicKey,
        data
    );
}

async function decryptMessage(privateKey, ciphertext) {
    const decrypted = await window.crypto.subtle.decrypt(
        { name: 'RSA-OAEP' },
        privateKey,
        ciphertext
    );
    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
}

// Helper to convert ArrayBuffer to Base64 for storing in JSON
function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

// Helper to convert Base64 back to ArrayBuffer
function base64ToArrayBuffer(base64) {
    const binary_string = window.atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
}
