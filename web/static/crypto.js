// crypto.js

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

// --- Public Key Functions ---

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

// --- Private Key Functions (for manual handling) ---

async function exportPrivateKeyJwk(key) {
    return window.crypto.subtle.exportKey('jwk', key);
}

async function importPrivateKeyJwk(jwk) {
    return window.crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        true,
        ['decrypt']
    );
}


// --- Symmetric (AES) Key Functions ---

async function generateSymmetricKey() {
    return window.crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true, // extractable
        ['encrypt', 'decrypt']
    );
}

async function exportSymmetricKeyRaw(key) {
    return window.crypto.subtle.exportKey('raw', key);
}

async function importSymmetricKeyRaw(keyData) {
    return window.crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'AES-GCM' },
        true,
        ['encrypt', 'decrypt']
    );
}

// --- AES-GCM Symmetric Encryption/Decryption Functions ---

async function encryptSymmetric(key, plaintext) {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoder = new TextEncoder();
    const encodedPlaintext = encoder.encode(plaintext);

    const ciphertext = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        encodedPlaintext
    );

    // Prepend IV to ciphertext for use in decryption
    const result = new Uint8Array(iv.length + ciphertext.byteLength);
    result.set(iv, 0);
    result.set(new Uint8Array(ciphertext), iv.length);

    return result.buffer;
}

async function decryptSymmetric(key, combined) {
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const decrypted = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        ciphertext
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
}


// --- RSA Asymmetric Encryption/Decryption Functions ---

async function encryptMessage(publicKey, data) {
    // This function can now encrypt any ArrayBuffer, not just text messages
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
    // The return value is an ArrayBuffer, the caller will decide how to decode it
    return decrypted;
}

// --- Helper Functions ---

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
