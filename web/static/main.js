// main.js

document.addEventListener('DOMContentLoaded', () => {
    // --- State ---
    let socket = null;
    let currentUser = null;
    let activeChatUser = null;
    let userPublicKeys = {}; // Cache for public keys
    let userPrivateKey = null;

    // --- DOM Elements ---
    const authContainer = document.getElementById('auth-container');
    const chatContainer = document.getElementById('chat-container');

    // Auth Forms
    const registerForm = document.getElementById('register-form');
    const loginForm = document.getElementById('login-form');
    const showLoginLink = document.getElementById('show-login');
    const showRegisterLink = document.getElementById('show-register');

    // Register Inputs
    const registerUsernameInput = document.getElementById('register-username');
    const registerPasswordInput = document.getElementById('register-password');
    const registerButton = document.getElementById('register-button');

    // Login Inputs
    const loginUsernameInput = document.getElementById('login-username');
    const loginPasswordInput = document.getElementById('login-password');
    const loginButton = document.getElementById('login-button');

    // Chat UI
    const userList = document.getElementById('user-list');
    const currentUsernameSpan = document.getElementById('current-username');
    const logoutButton = document.getElementById('logout-button');
    const messagesDiv = document.getElementById('messages');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');

    // --- API Functions ---
    async function apiCall(endpoint, method = 'GET', body = null) {
        const options = {
            method,
            headers: { 'Content-Type': 'application/json' },
        };
        if (body) {
            options.body = JSON.stringify(body);
        }
        const response = await fetch(`/api${endpoint}`, options);
        if (!response.ok) {
            const error = await response.json();
            alert(`Error: ${error.message}`);
            throw new Error(error.message);
        }
        return response.json();
    }

    // --- Authentication Logic ---
    showLoginLink.addEventListener('click', (e) => {
        e.preventDefault();
        registerForm.style.display = 'none';
        loginForm.style.display = 'block';
    });

    showRegisterLink.addEventListener('click', (e) => {
        e.preventDefault();
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
    });

    registerButton.addEventListener('click', async () => {
        const username = registerUsernameInput.value;
        const password = registerPasswordInput.value;
        if (!username || !password) {
            alert('Username and password are required.');
            return;
        }

        try {
            // 1. Generate crypto keys
            const keyPair = await generateKeys();
            const publicKeyPem = await exportPublicKey(keyPair.publicKey);

            // 2. Register user with the server
            await apiCall('/register', 'POST', { username, password, public_key: publicKeyPem });

            // 3. Save private key to IndexedDB
            await saveKeyToDB(username, keyPair.privateKey);

            alert('Registration successful! Please log in.');
            showLoginLink.click();
        } catch (error) {
            console.error('Registration failed:', error);
        }
    });

    loginButton.addEventListener('click', async () => {
        const username = loginUsernameInput.value;
        const password = loginPasswordInput.value;
        if (!username || !password) {
            alert('Username and password are required.');
            return;
        }

        try {
            // 1. Verify credentials with the server
            await apiCall('/login', 'POST', { username, password });

            // 2. Get private key from IndexedDB
            const privateKey = await getKeyFromDB(username);
            if (!privateKey) {
                alert('Could not find your private key. Please try registering again.');
                return;
            }
            userPrivateKey = privateKey;
            currentUser = username;

            // 3. Transition to chat view
            authContainer.style.display = 'none';
            chatContainer.style.display = 'flex';
            currentUsernameSpan.textContent = currentUser;

            // 4. Initialize chat application
            await initializeChat();

        } catch (error) {
            console.error('Login failed:', error);
        }
    });

    logoutButton.addEventListener('click', () => {
        if (socket) {
            socket.disconnect();
        }
        currentUser = null;
        userPrivateKey = null;
        activeChatUser = null;
        userPublicKeys = {};
        authContainer.style.display = 'block';
        chatContainer.style.display = 'none';
        userList.innerHTML = '';
        messagesDiv.innerHTML = '';
    });

    // --- Chat Initialization ---
    async function initializeChat() {
        console.log(`[${currentUser}] Initializing chat...`);
        // 1. Connect to WebSocket server
        socket = io();
        socket.on('connect', () => {
            console.log(`[${currentUser}] Connected to WebSocket. Emitting user_logged_in.`);
            socket.emit('user_logged_in', { username: currentUser });
        });

        // 2. Listen for incoming messages
        socket.on('receive_message', async (data) => {
            console.log(`[${currentUser}] Received message from ${data.sender}:`, data);
            if (data.sender === activeChatUser) {
                try {
                    const decryptedMessage = await decryptMessage(userPrivateKey, base64ToArrayBuffer(data.message));
                    displayMessage(decryptedMessage, 'received');
                } catch (e) {
                    console.error("Decryption failed:", e);
                    displayMessage("[Decryption Error]", 'system-message');
                }
            } else {
                console.log(`[${currentUser}] Received message from inactive chat user ${data.sender}.`);
                alert(`New message from ${data.sender}!`);
            }
        });

        // 3. Fetch user list
        await updateUserList();
    }

    // --- UI and Chat Logic ---
    async function updateUserList() {
        const data = await apiCall('/users');
        userPublicKeys = data.users;
        userList.innerHTML = '';
        for (const username in userPublicKeys) {
            if (username !== currentUser) {
                const li = document.createElement('li');
                li.textContent = username;
                li.dataset.username = username;
                li.addEventListener('click', () => selectUser(username));
                userList.appendChild(li);
            }
        }
    }

    async function selectUser(username) {
        activeChatUser = username;

        // Highlight active user in the list
        document.querySelectorAll('#user-list li').forEach(li => {
            li.classList.toggle('active', li.dataset.username === username);
        });

        // Enable message input
        messageInput.disabled = false;
        sendButton.disabled = false;
        messageInput.placeholder = `Message ${username}...`;

        // Fetch and display chat history
        await loadChatHistory(username);
    }

    async function loadChatHistory(otherUser) {
        messagesDiv.innerHTML = '<p class="system-message">Loading history...</p>';
        const data = await apiCall(`/history?username=${currentUser}`);
        const history = data.history;
        messagesDiv.innerHTML = ''; // Clear loading message

        for (const msg of history) {
            if ((msg.sender === currentUser && msg.recipient === otherUser) || (msg.sender === otherUser && msg.recipient === currentUser)) {
                let decryptedText;
                let messageType;

                try {
                    if (msg.sender === currentUser) {
                        // We can't decrypt our own sent messages from history
                        // A better client would store sent messages locally
                        // For now, we will just not display them from history
                        continue;
                    } else {
                        decryptedText = await decryptMessage(userPrivateKey, base64ToArrayBuffer(msg.message));
                        messageType = 'received';
                        displayMessage(decryptedText, messageType);
                    }
                } catch (e) {
                    console.error("Could not decrypt message from history:", e);
                    displayMessage("[This message could not be decrypted]", 'system-message');
                }
            }
        }
    }

    sendButton.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });

    async function sendMessage() {
        const messageText = messageInput.value;
        if (!messageText || !activeChatUser) return;

        console.log(`[${currentUser}] Sending message to ${activeChatUser}: "${messageText}"`);

        try {
            // 1. Get recipient's public key
            const recipientPublicKeyPem = userPublicKeys[activeChatUser];
            if (!recipientPublicKeyPem) {
                console.error("Could not find public key for recipient:", activeChatUser);
                alert("Could not find recipient's public key.");
                return;
            }
            const recipientPublicKey = await importPublicKey(recipientPublicKeyPem);
            console.log(`[${currentUser}] Successfully imported public key for ${activeChatUser}.`);

            // 2. Encrypt the message
            const encryptedMessageBuffer = await encryptMessage(recipientPublicKey, messageText);
            const encryptedMessageBase64 = arrayBufferToBase64(encryptedMessageBuffer);
            console.log(`[${currentUser}] Message encrypted.`);

            // 3. Send via WebSocket
            const payload = {
                sender: currentUser,
                recipient: activeChatUser,
                message: encryptedMessageBase64
            };
            socket.emit('send_message', payload);
            console.log(`[${currentUser}] Emitted 'send_message' event with payload:`, payload);


            // 4. Display sent message in UI
            displayMessage(messageText, 'sent');
            messageInput.value = '';

        } catch (error) {
            console.error('Failed to send message:', error);
            alert('Failed to send message.');
        }
    }

    function displayMessage(text, type) {
        const messageEl = document.createElement('div');
        messageEl.classList.add('message', type);
        messageEl.textContent = text;
        messagesDiv.appendChild(messageEl);
        messagesDiv.scrollTop = messagesDiv.scrollHeight; // Auto-scroll
    }
});
