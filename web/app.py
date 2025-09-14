import sys
import os
from flask import Flask, render_template, request, jsonify, session
from flask_socketio import SocketIO, emit

# Adjust the path to import from the root directory
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
import storage

app = Flask(__name__, static_folder='static', template_folder='templates')
# A real app would get this from an environment variable
app.config['SECRET_KEY'] = 'a-very-secret-key-that-should-be-changed'
socketio = SocketIO(app, cors_allowed_origins="*")

# In-memory store for online users. Maps username to session ID (sid).
online_users = {}

# Initialize storage to ensure JSON files exist
storage.init_storage()

# --- HTTP Routes ---

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data: return jsonify({"status": "error", "message": "Invalid JSON"}), 400
    username = data.get('username')
    password = data.get('password')
    public_key = data.get('public_key')
    if not all([username, password, public_key]):
        return jsonify({"status": "error", "message": "Missing required fields"}), 400
    if storage.add_user(username, password, public_key):
        return jsonify({"status": "success", "message": "User registered successfully"})
    else:
        return jsonify({"status": "error", "message": "Username already exists"}), 409

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data: return jsonify({"status": "error", "message": "Invalid JSON"}), 400
    username = data.get('username')
    password = data.get('password')
    if not all([username, password]):
        return jsonify({"status": "error", "message": "Missing required fields"}), 400
    if storage.verify_password(username, password):
        session['username'] = username # Set the user in the session
        return jsonify({"status": "success", "message": "Login successful"})
    else:
        return jsonify({"status": "error", "message": "Invalid credentials"}), 401

@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear() # Clear the session
    return jsonify({"status": "success", "message": "Logout successful"})

@app.route('/api/users', methods=['GET'])
def get_users():
    if 'username' not in session:
        return jsonify({"status": "error", "message": "Not authenticated"}), 401
    users = storage.get_all_users()
    return jsonify({"status": "success", "users": users})

@app.route('/api/history', methods=['GET'])
def get_history():
    username = session.get('username')
    if not username:
        return jsonify({"status": "error", "message": "Not authenticated"}), 401
    messages = storage.get_messages_for_user(username)
    return jsonify({"status": "success", "history": messages})

# --- Group Management API Routes ---

@app.route('/api/groups', methods=['POST'])
def create_group():
    username = session.get('username')
    if not username: return jsonify({"status": "error", "message": "Not authenticated"}), 401

    data = request.get_json()
    group_name = data.get('group_name')
    creator_key = data.get('key')
    if not all([group_name, creator_key]):
        return jsonify({"status": "error", "message": "Missing fields"}), 400

    new_group = storage.create_group(group_name, username)
    storage.store_encrypted_group_key(new_group['id'], username, creator_key)
    updated_group = storage.get_group_by_id(new_group['id'])
    return jsonify({"status": "success", "group": updated_group})

@app.route('/api/groups', methods=['GET'])
def get_groups():
    username = session.get('username')
    if not username: return jsonify({"status": "error", "message": "Not authenticated"}), 401

    groups = storage.get_groups_for_user(username)
    return jsonify({"status": "success", "groups": groups})

@app.route('/api/groups/<group_id>/members', methods=['POST'])
def add_group_member(group_id):
    requesting_user = session.get('username')
    if not requesting_user: return jsonify({"status": "error", "message": "Not authenticated"}), 401

    group = storage.get_group_by_id(group_id)
    if not group or requesting_user not in group['members']:
        return jsonify({"status": "error", "message": "Not a member of this group"}), 403

    data = request.get_json()
    username_to_add = data.get('username')
    if not username_to_add:
        return jsonify({"status": "error", "message": "Username to add is required"}), 400

    if storage.add_user_to_group(group_id, username_to_add):
        return jsonify({"status": "success", "message": f"User {username_to_add} added."})
    else:
        return jsonify({"status": "error", "message": "Failed to add user."}), 500

@app.route('/api/groups/<group_id>/keys', methods=['POST'])
def add_group_key(group_id):
    requesting_user = session.get('username')
    if not requesting_user: return jsonify({"status": "error", "message": "Not authenticated"}), 401

    group = storage.get_group_by_id(group_id)
    if not group or requesting_user not in group['members']:
        return jsonify({"status": "error", "message": "Not a member of this group"}), 403

    data = request.get_json()
    username = data.get('username')
    key = data.get('key')
    if not all([username, key]):
        return jsonify({"status": "error", "message": "Missing fields"}), 400

    if storage.store_encrypted_group_key(group_id, username, key):
        return jsonify({"status": "success", "message": "Key stored."})
    else:
        return jsonify({"status": "error", "message": "Failed to store key."}), 500


# --- WebSocket Event Handlers ---
# (No changes needed here as they already rely on client-sent identity, which is fine for this context)

@socketio.on('connect')
def handle_connect():
    print(f'Client connected: {request.sid}')

@socketio.on('disconnect')
def handle_disconnect():
    username_to_remove = None
    for user, sid in online_users.items():
        if sid == request.sid:
            username_to_remove = user
            break
    if username_to_remove:
        del online_users[username_to_remove]
        print(f'User {username_to_remove} disconnected and went offline.')

@socketio.on('user_logged_in')
def handle_user_login(data):
    username = data.get('username')
    if username:
        online_users[username] = request.sid
        print(f"User {username} is online with SID: {request.sid}")

@socketio.on('send_message')
def handle_send_message(data):
    sender = data.get('sender')
    recipient = data.get('recipient')
    message_content = data.get('message')
    if not all([sender, recipient, message_content]): return
    storage.add_message(sender, recipient, message_content)
    if recipient in online_users:
        emit('receive_message', {'sender': sender, 'message': message_content}, room=online_users[recipient])

@socketio.on('send_group_message')
def handle_send_group_message(data):
    sender = data.get('sender')
    group_id = data.get('recipient')
    message_content = data.get('message')
    if not all([sender, group_id, message_content]): return
    storage.add_group_message(sender, group_id, message_content)
    group = storage.get_group_by_id(group_id)
    if not group: return
    for member in group['members']:
        if member != sender and member in online_users:
            emit('receive_group_message', {'sender': sender, 'group_id': group_id, 'message': message_content}, room=online_users[member])


if __name__ == '__main__':
    print("Starting web server with WebSocket support...")
    socketio.run(app, host='0.0.0.0', port=5001, debug=True)
