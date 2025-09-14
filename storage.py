# User and message storage using JSON files.
import json
import os
import hashlib
import uuid

USERS_FILE = "users.json"
MESSAGES_FILE = "messages.json"
GROUPS_FILE = "groups.json"

# --- Initialization ---
def init_storage():
    """Initialize storage files if they don't exist."""
    for f in [USERS_FILE, GROUPS_FILE]:
        if not os.path.exists(f):
            with open(f, "w") as file:
                json.dump({}, file)
    if not os.path.exists(MESSAGES_FILE):
        with open(MESSAGES_FILE, "w") as f:
            json.dump([], f)

# --- Private Helper Functions ---
def _read_json(filepath):
    with open(filepath, "r") as f:
        return json.load(f)

def _write_json(filepath, data):
    with open(filepath, "w") as f:
        json.dump(data, f, indent=4)

def _read_users(): return _read_json(USERS_FILE)
def _write_users(data): _write_json(USERS_FILE, data)
def _read_messages(): return _read_json(MESSAGES_FILE)
def _write_messages(data): _write_json(MESSAGES_FILE, data)
def _read_groups(): return _read_json(GROUPS_FILE)
def _write_groups(data): _write_json(GROUPS_FILE, data)


# --- User Management ---
def hash_password(password):
    """Hash a password for storing."""
    return hashlib.sha256(password.encode()).hexdigest()

def add_user(username, password, public_key_pem):
    """Add a new user to the storage."""
    users = _read_users()
    if username in users:
        return False
    users[username] = {"password_hash": hash_password(password), "public_key": public_key_pem}
    _write_users(users)
    return True

def get_user(username):
    """Get user data from storage."""
    return _read_users().get(username)

def get_all_users():
    """Get all usernames and their public keys."""
    users = _read_users()
    return {username: data["public_key"] for username, data in users.items()}

def user_exists(username):
    """Check if a user exists."""
    return username in _read_users()

def verify_password(username, password):
    """Verify a user's password."""
    user = get_user(username)
    return user and user["password_hash"] == hash_password(password)


# --- Message History ---
def add_message(sender, recipient, message_content):
    """Add a private message to the chat history."""
    messages = _read_messages()
    messages.append({
        "type": "private",
        "sender": sender,
        "recipient": recipient,
        "message": message_content,
    })
    _write_messages(messages)

def add_group_message(sender, group_id, message_content):
    """Add a group message to the chat history."""
    messages = _read_messages()
    messages.append({
        "type": "group",
        "sender": sender,
        "recipient": group_id, # The recipient is the group
        "message": message_content,
    })
    _write_messages(messages)

def get_messages_for_user(username):
    """Retrieve all messages for a specific user, including group messages."""
    messages = _read_messages()
    user_messages = []
    user_groups = get_groups_for_user(username)
    user_group_ids = {g['id'] for g in user_groups}

    for msg in messages:
        if msg["type"] == "private" and (msg["sender"] == username or msg["recipient"] == username):
            user_messages.append(msg)
        elif msg["type"] == "group" and msg["recipient"] in user_group_ids:
            user_messages.append(msg)

    return user_messages


# --- Group Management ---
def create_group(group_name, creator_username):
    """Creates a new group and returns the group object."""
    groups = _read_groups()
    group_id = str(uuid.uuid4())
    new_group = {
        "id": group_id,
        "name": group_name,
        "creator": creator_username,
        "members": [creator_username],
        "keys": {} # { "username": "encrypted_group_key" }
    }
    groups[group_id] = new_group
    _write_groups(groups)
    return new_group

def get_group_by_id(group_id):
    """Retrieves a group by its ID."""
    return _read_groups().get(group_id)

def add_user_to_group(group_id, username):
    """Adds a user to a group's member list."""
    groups = _read_groups()
    if group_id in groups and username not in groups[group_id]["members"]:
        groups[group_id]["members"].append(username)
        _write_groups(groups)
        return True
    return False

def store_encrypted_group_key(group_id, username, encrypted_key):
    """Stores the encrypted group key for a specific user in a group."""
    groups = _read_groups()
    if group_id in groups and username in groups[group_id]["members"]:
        if "keys" not in groups[group_id]:
            groups[group_id]["keys"] = {}
        groups[group_id]["keys"][username] = encrypted_key
        _write_groups(groups)
        return True
    return False

def get_groups_for_user(username):
    """Retrieves all groups that a user is a member of."""
    groups = _read_groups()
    user_groups = []
    for group_id, group_data in groups.items():
        if username in group_data["members"]:
            # Return a list of group objects, not the whole dict
            user_groups.append(group_data)
    return user_groups
