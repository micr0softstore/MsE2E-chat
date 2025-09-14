// main.js

document.addEventListener('DOMContentLoaded', () => {
    // --- State ---
    let socket = null;
    let currentUser = null;
    let activeChatTarget = null; // Can be a user {id, type} or group {id, name, type}
    let userPublicKeys = {}; // Cache for public keys
    let userPrivateKey = null;
    let groupSymmetricKeys = {}; // Cache for decrypted group keys { groupId: CryptoKey }

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
    const groupList = document.getElementById('group-list');
    const currentUsernameSpan = document.getElementById('current-username');
    const logoutButton = document.getElementById('logout-button');
    const messagesDiv = document.getElementById('messages');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');

    // Group Management UI
    const groupManagementArea = document.getElementById('group-management-area');
    const addMemberInput = document.getElementById('add-member-input');
    const addMemberBtn = document.getElementById('add-member-btn');


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

            // 3. Export private key and trigger download
            const privateKeyJwk = await exportPrivateKeyJwk(keyPair.privateKey);
            const keyFileData = JSON.stringify(privateKeyJwk, null, 2);
            const blob = new Blob([keyFileData], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${username}_private_key.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            alert('Registration successful! Your private key has been downloaded. Keep it safe and use it to log in.');
            showLoginLink.click();
        } catch (error) {
            console.error('Registration failed:', error);
        }
    });

    const loginKeyFileInput = document.getElementById('login-key-file');

    loginButton.addEventListener('click', async () => {
        const username = loginUsernameInput.value;
        const password = loginPasswordInput.value;
        const keyFile = loginKeyFileInput.files[0];

        if (!username || !password || !keyFile) {
            alert('Username, password, and key file are required.');
            return;
        }

        try {
            // 1. Read and import the private key from the file
            const keyFileContent = await keyFile.text();
            const privateKeyJwk = JSON.parse(keyFileContent);
            const privateKey = await importPrivateKeyJwk(privateKeyJwk);

            // 2. Verify credentials with the server
            await apiCall('/login', 'POST', { username, password });

            // 3. Set state and transition to chat view
            userPrivateKey = privateKey;
            currentUser = username;

            authContainer.style.display = 'none';
            chatContainer.style.display = 'flex';
            currentUsernameSpan.textContent = currentUser;

            // 4. Initialize chat application
            await initializeChat();

        } catch (error) {
            console.error('Login failed:', error);
            alert('Login failed. Please check your credentials and key file.');
        }
    });

    const createGroupBtn = document.getElementById('create-group-btn');
    const createGroupModal = document.getElementById('create-group-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const submitCreateGroupBtn = document.getElementById('submit-create-group-btn');
    const groupNameInput = document.getElementById('group-name-input');

    logoutButton.addEventListener('click', async () => {
        await apiCall('/logout', 'POST');
        if (socket) {
            socket.disconnect();
        }
        currentUser = null;
        userPrivateKey = null;
        activeChatTarget = null;
        userPublicKeys = {};
        groupSymmetricKeys = {};
        authContainer.style.display = 'block';
        chatContainer.style.display = 'none';
        userList.innerHTML = '';
        groupList.innerHTML = '';
        messagesDiv.innerHTML = '';
        // Also clear the file input
        loginKeyFileInput.value = '';
    });

    createGroupBtn.addEventListener('click', () => {
        createGroupModal.style.display = 'flex';
    });

    closeModalBtn.addEventListener('click', () => {
        createGroupModal.style.display = 'none';
    });

    submitCreateGroupBtn.addEventListener('click', async () => {
        const groupName = groupNameInput.value;
        if (groupName) {
            await createGroup(groupName);
            groupNameInput.value = '';
            createGroupModal.style.display = 'none';
            // Refresh lists
            await updateUserAndGroupLists();
        }
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

        // 2. Listen for incoming private messages
        socket.on('receive_message', async (data) => {
            console.log(`[${currentUser}] Received private message from ${data.sender}:`, data);
            if (activeChatTarget && activeChatTarget.type === 'private' && activeChatTarget.id === data.sender) {
                try {
                    const decryptedBuffer = await decryptMessage(userPrivateKey, base64ToArrayBuffer(data.message));
                    const decryptedText = new TextDecoder().decode(decryptedBuffer);
                    displayMessage(decryptedText, 'received');
                } catch (e) {
                    console.error("Decryption failed:", e);
                    displayMessage("[Decryption Error]", 'system-message');
                }
            } else {
                console.log(`[${currentUser}] Received message from inactive chat user ${data.sender}.`);
                alert(`New private message from ${data.sender}!`);
            }
        });

        // 3. Listen for incoming group messages
        socket.on('receive_group_message', async (data) => {
            console.log(`[${currentUser}] Received group message from ${data.sender} for group ${data.group_id}:`, data);
            if (activeChatTarget && activeChatTarget.type === 'group' && activeChatTarget.id === data.group_id) {
                try {
                    const key = groupSymmetricKeys[data.group_id];
                    if (!key) throw new Error("Group key not found.");
                    const decryptedMessage = await decryptSymmetric(key, base64ToArrayBuffer(data.message));
                    displayMessage(`${data.sender}: ${decryptedMessage}`, 'received');
                } catch (e) {
                    console.error("Group message decryption failed:", e);
                    displayMessage("[Group Decryption Error]", 'system-message');
                }
            } else {
                console.log(`[${currentUser}] Received message for inactive group ${data.group_id}.`);
                alert(`New message in group!`); // A real UI would show a badge
            }
        });

        // 4. Fetch user and group lists
        await updateUserAndGroupLists();
    }

    // --- Group Logic ---
    async function createGroup(groupName) {
        try {
            // 1. Generate a new symmetric key for the group
            const symmetricKey = await generateSymmetricKey();
            const rawKey = await exportSymmetricKeyRaw(symmetricKey);

            // 2. Encrypt the symmetric key with the creator's own public key
            // We need our own public key. Let's fetch it from the server cache.
            const selfPublicKeyPem = userPublicKeys[currentUser];
            const selfPublicKey = await importPublicKey(selfPublicKeyPem);
            const encryptedKey = await encryptMessage(selfPublicKey, rawKey);
            const encryptedKeyBase64 = arrayBufferToBase64(encryptedKey);

            // 3. Call the API to create the group
            const result = await apiCall('/groups', 'POST', {
                group_name: groupName,
                creator: currentUser,
                key: encryptedKeyBase64
            });

            console.log("Group created:", result.group);
            alert(`Group "${groupName}" created successfully!`);

            // 4. Store the decrypted symmetric key in our state
            groupSymmetricKeys[result.group.id] = symmetricKey;

            // TODO: Refresh the group list in the UI
            // await updateUserAndGroupLists();

        } catch (error) {
            console.error("Failed to create group:", error);
            alert("Failed to create group.");
        }
    }

    async function addUserToGroup(groupId, usernameToAdd) {
        try {
            // 1. Get the symmetric key for the group from our state
            const symmetricKey = groupSymmetricKeys[groupId];
            if (!symmetricKey) {
                alert("Error: You don't have the key for this group.");
                return;
            }
            const rawKey = await exportSymmetricKeyRaw(symmetricKey);

            // 2. Get the public key of the user to add
            const userToAddPublicKeyPem = userPublicKeys[usernameToAdd];
            if (!userToAddPublicKeyPem) {
                alert("Could not find the public key for the user to add.");
                return;
            }
            const userToAddPublicKey = await importPublicKey(userToAddPublicKeyPem);

            // 3. Encrypt the symmetric key with the new user's public key
            const encryptedKey = await encryptMessage(userToAddPublicKey, rawKey);
            const encryptedKeyBase64 = arrayBufferToBase64(encryptedKey);

            // 4. Add the user to the group on the server
            await apiCall(`/groups/${groupId}/members`, 'POST', { username: usernameToAdd });

            // 5. Store the new user's encrypted key on the server
            await apiCall(`/groups/${groupId}/keys`, 'POST', { username: usernameToAdd, key: encryptedKeyBase64 });

            alert(`User ${usernameToAdd} added to the group successfully!`);
            // The other user will not get a real-time update, they would need to refresh.
            // A full implementation would use a WebSocket message to notify the added user.
        } catch (error) {
            console.error(`Failed to add user ${usernameToAdd} to group:`, error);
        }
    }


    // --- UI and Chat Logic ---
    async function updateUserAndGroupLists() {
        // Fetch and display users
        const usersData = await apiCall('/users');
        userPublicKeys = usersData.users;
        userList.innerHTML = '';
        for (const username in userPublicKeys) {
            if (username !== currentUser) {
                const li = document.createElement('li');
                li.textContent = username;
                li.dataset.id = username;
                li.dataset.type = 'private';
                li.addEventListener('click', () => selectChatTarget({ id: username, type: 'private' }));
                userList.appendChild(li);
            }
        }

        // Fetch and display groups
        const groupsData = await apiCall(`/groups`); // No username needed
        groupList.innerHTML = '';
        for (const group of groupsData.groups) {
            const li = document.createElement('li');
            li.textContent = group.name;
            li.dataset.id = group.id;
            li.dataset.type = 'group';
            li.addEventListener('click', () => selectChatTarget({ id: group.id, name: group.name, type: 'group', keys: group.keys }));
            groupList.appendChild(li);
        }
    }

    addMemberBtn.addEventListener('click', async () => {
        const usernameToAdd = addMemberInput.value;
        if (!usernameToAdd) {
            alert("Please enter a username to add.");
            return;
        }
        if (activeChatTarget && activeChatTarget.type === 'group') {
            await addUserToGroup(activeChatTarget.id, usernameToAdd);
            addMemberInput.value = '';
        } else {
            alert("You must have a group selected to add a member.");
        }
    });

    async function selectChatTarget(target) {
        activeChatTarget = target; // e.g., { id: 'some_user', type: 'private' } or { id: 'group_id', name: '...', type: 'group' }

        // Highlight active chat in the lists
        document.querySelectorAll('.chat-list li').forEach(li => {
            li.classList.toggle('active', li.dataset.id === target.id);
        });

        // Show/hide group management area
        if (target.type === 'group') {
            groupManagementArea.style.display = 'flex';
        } else {
            groupManagementArea.style.display = 'none';
        }

        // Enable message input
        messageInput.disabled = false;
        sendButton.disabled = false;
        messageInput.placeholder = `Message ${target.name || target.id}...`;

        // If it's a group and we don't have the key, decrypt and store it
        if (target.type === 'group' && !groupSymmetricKeys[target.id]) {
            try {
                const encryptedKeyBase64 = target.keys[currentUser];
                const encryptedKey = base64ToArrayBuffer(encryptedKeyBase64);
                const rawKey = await decryptMessage(userPrivateKey, encryptedKey);
                const symmetricKey = await importSymmetricKeyRaw(rawKey);
                groupSymmetricKeys[target.id] = symmetricKey;
                console.log(`Decrypted and stored key for group ${target.name}`);
            } catch (e) {
                console.error(`Failed to decrypt key for group ${target.name}:`, e);
                alert(`Could not decrypt the key for group "${target.name}". You may not have access.`);
                return;
            }
        }

        // Fetch and display chat history
        await loadChatHistory(target);
    }

    async function loadChatHistory(target) {
        messagesDiv.innerHTML = '<p class="system-message">Loading history...</p>';
        const data = await apiCall(`/history`); // No username needed
        const history = data.history;
        messagesDiv.innerHTML = ''; // Clear loading message

        for (const msg of history) {
            const isPrivateMatch = (msg.type === 'private' && target.type === 'private' && (msg.sender === currentUser && msg.recipient === target.id) || (msg.sender === target.id && msg.recipient === currentUser));
            const isGroupMatch = (msg.type === 'group' && target.type === 'group' && msg.recipient === target.id);

            if (isPrivateMatch || isGroupMatch) {
                let decryptedText;
                let messageType = (msg.sender === currentUser) ? 'sent' : 'received';

                try {
                    if (messageType === 'sent') {
                        // For now, we can't decrypt our own messages from history.
                        // A better client would store sent plaintext locally.
                        // To make this work for the demo, we'll just skip them.
                        // Or better, let's try to decrypt group messages we sent.
                        if (isGroupMatch) {
                             const key = groupSymmetricKeys[target.id];
                             decryptedText = await decryptSymmetric(key, base64ToArrayBuffer(msg.message));
                        } else {
                            continue; // Skip sent private messages
                        }
                    } else { // 'received'
                        if (isPrivateMatch) {
                            const decryptedBuffer = await decryptMessage(userPrivateKey, base64ToArrayBuffer(msg.message));
                            decryptedText = new TextDecoder().decode(decryptedBuffer);
                        } else { // Group message
                            const key = groupSymmetricKeys[target.id];
                            if (!key) { throw new Error("No key found for this group."); }
                            decryptedText = await decryptSymmetric(key, base64ToArrayBuffer(msg.message));
                        }
                    }
                    displayMessage(decryptedText, messageType);
                } catch (e) {
                    console.error("Could not decrypt message from history:", e);
                    displayMessage(`[Message from ${msg.sender} could not be decrypted]`, 'system-message');
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
        if (!messageText || !activeChatTarget) return;

        try {
            if (activeChatTarget.type === 'private') {
                console.log(`[${currentUser}] Sending private message to ${activeChatTarget.id}: "${messageText}"`);
                const recipientPublicKeyPem = userPublicKeys[activeChatTarget.id];
                const recipientPublicKey = await importPublicKey(recipientPublicKeyPem);
                const encryptedMessageBuffer = await encryptMessage(recipientPublicKey, new TextEncoder().encode(messageText));
                const encryptedMessageBase64 = arrayBufferToBase64(encryptedMessageBuffer);

                socket.emit('send_message', {
                    sender: currentUser,
                    recipient: activeChatTarget.id,
                    message: encryptedMessageBase64
                });
            } else { // Group message
                console.log(`[${currentUser}] Sending group message to ${activeChatTarget.name}: "${messageText}"`);
                const groupKey = groupSymmetricKeys[activeChatTarget.id];
                if (!groupKey) {
                    alert("Cannot send message: group key not available.");
                    return;
                }
                const encryptedMessageBuffer = await encryptSymmetric(groupKey, messageText);
                const encryptedMessageBase64 = arrayBufferToBase64(encryptedMessageBuffer);

                socket.emit('send_group_message', {
                    sender: currentUser,
                    recipient: activeChatTarget.id, // recipient is the group_id
                    message: encryptedMessageBase64
                });
            }

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
