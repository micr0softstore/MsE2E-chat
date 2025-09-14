import sys
import os
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit

# Adjust the path to import from the root directory
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
import storage

app = Flask(__name__, static_folder='static', template_folder='templates')
app.config['SECRET_KEY'] = 'secret!' # In a real app, use a proper secret key
socketio = SocketIO(app, cors_allowed_origins="*")

# In-memory store for online users. Maps username to session ID (sid).
online_users = {}

# Initialize storage to ensure JSON files exist
storage.init_storage()

# --- HTTP Routes ---

@app.route('/')
def index():
    # This will be created in a later step
    return render_template('index.html')

@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data:
        return jsonify({"status": "error", "message": "Invalid JSON"}), 400
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
    if not data:
        return jsonify({"status": "error", "message": "Invalid JSON"}), 400
    username = data.get('username')
    password = data.get('password')
    if not all([username, password]):
        return jsonify({"status": "error", "message": "Missing required fields"}), 400
    if storage.verify_password(username, password):
        return jsonify({"status": "success", "message": "Login successful"})
    else:
        return jsonify({"status": "error", "message": "Invalid credentials"}), 401

@app.route('/api/users', methods=['GET'])
def get_users():
    users = storage.get_all_users()
    return jsonify({"status": "success", "users": users})

@app.route('/api/history', methods=['GET'])
def get_history():
    username = request.args.get('username')
    if not username:
        return jsonify({"status": "error", "message": "Username parameter is required"}), 400
    messages = storage.get_messages_for_user(username)
    return jsonify({"status": "success", "history": messages})

# --- WebSocket Event Handlers ---

@socketio.on('connect')
def handle_connect():
    print(f'Client connected: {request.sid}')

@socketio.on('disconnect')
def handle_disconnect():
    print(f'Client disconnected: {request.sid}')
    # Find and remove the user from our online list
    disconnected_user = None
    for user, sid in online_users.items():
        if sid == request.sid:
            disconnected_user = user
            break
    if disconnected_user:
        del online_users[disconnected_user]
        print(f'User {disconnected_user} went offline.')

@socketio.on('user_logged_in')
def handle_user_login(data):
    """Associates a username with their session ID upon login."""
    username = data.get('username')
    if username:
        online_users[username] = request.sid
        print(f"User {username} is online with SID: {request.sid}")
        print("Currently online users:", online_users)

@socketio.on('send_message')
def handle_send_message(data):
    """Handles receiving and relaying a message."""
    sender = data.get('sender')
    recipient = data.get('recipient')
    message_content = data.get('message')

    if not all([sender, recipient, message_content]):
        # Can't easily send an error response here without a callback
        print("Received incomplete message data.")
        return

    # Store the message
    storage.add_message(sender, recipient, message_content)

    # Forward the message to the recipient if they are online
    if recipient in online_users:
        recipient_sid = online_users[recipient]
        emit('receive_message', {
            'sender': sender,
            'message': message_content
        }, room=recipient_sid)
        print(f"Message from {sender} forwarded to {recipient}.")
    else:
        print(f"Recipient {recipient} is offline. Message stored.")


if __name__ == '__main__':
    print("Starting web server with WebSocket support...")
    # Eventlet will be used automatically if installed
    socketio.run(app, host='0.0.0.0', port=5001, debug=True)
