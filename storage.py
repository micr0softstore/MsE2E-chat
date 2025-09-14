# User and message storage using JSON files.
import json
import os
import hashlib

USERS_FILE = "users.json"
MESSAGES_FILE = "messages.json"

def init_storage():
    """Initialize storage files if they don't exist."""
    if not os.path.exists(USERS_FILE):
        with open(USERS_FILE, "w") as f:
            json.dump({}, f)
    if not os.path.exists(MESSAGES_FILE):
        with open(MESSAGES_FILE, "w") as f:
            json.dump([], f)

def _read_users():
    """Read the users file."""
    with open(USERS_FILE, "r") as f:
        return json.load(f)

def _write_users(data):
    """Write to the users file."""
    with open(USERS_FILE, "w") as f:
        json.dump(data, f, indent=4)

def _read_messages():
    """Read the messages file."""
    with open(MESSAGES_FILE, "r") as f:
        return json.load(f)

def _write_messages(data):
    """Write to the messages file."""
    with open(MESSAGES_FILE, "w") as f:
        json.dump(data, f, indent=4)

def hash_password(password):
    """Hash a password for storing."""
    return hashlib.sha256(password.encode()).hexdigest()

def add_user(username, password, public_key_pem):
    """Add a new user to the storage."""
    users = _read_users()
    if username in users:
        return False  # User already exists

    users[username] = {
        "password_hash": hash_password(password),
        "public_key": public_key_pem
    }
    _write_users(users)
    return True

def get_user(username):
    """Get user data from storage."""
    users = _read_users()
    return users.get(username)

def get_all_users():
    """Get all usernames and their public keys."""
    users = _read_users()
    return {username: data["public_key"] for username, data in users.items()}


def user_exists(username):
    """Check if a user exists."""
    users = _read_users()
    return username in users

def verify_password(username, password):
    """Verify a user's password."""
    user = get_user(username)
    if not user:
        return False
    return user["password_hash"] == hash_password(password)

def add_message(sender, recipient, message_content):
    """Add a message to the chat history."""
    messages = _read_messages()
    messages.append({
        "sender": sender,
        "recipient": recipient,
        "message": message_content,
    })
    _write_messages(messages)

def get_messages_for_user(username):
    """Retrieve all messages for a specific user."""
    messages = _read_messages()
    user_messages = []
    for msg in messages:
        if msg["sender"] == username or msg["recipient"] == username:
            user_messages.append(msg)
    return user_messages
