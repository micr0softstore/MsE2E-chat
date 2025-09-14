import socket
import json
import os
import getpass
import threading
import crypto

HOST = '127.0.0.1'
PORT = 65432

class ChatClient:
    def __init__(self):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.private_key = None
        self.username = None

    def get_private_key_path(self, username):
        """Return the path for the user's private key file."""
        return f"{username}_private_key.pem"

    def _send_request(self, request):
        """Send a JSON request to the server and get the response."""
        self.sock.sendall((json.dumps(request) + '\n').encode('utf-8'))

        # Buffer to handle multiple JSON objects in one recv
        buffer = ""
        while True:
            buffer += self.sock.recv(4096).decode('utf-8')
            if '\n' in buffer:
                response_data, buffer = buffer.split('\n', 1)
                return json.loads(response_data)


    def listen_for_messages(self):
        """Listen for incoming messages from the server in a separate thread."""
        try:
            buffer = ""
            while True:
                buffer += self.sock.recv(4096).decode('utf-8')
                while '\n' in buffer:
                    line, buffer = buffer.split('\n', 1)
                    if not line:
                        continue

                    try:
                        message = json.loads(line)
                        if message.get("command") == "RECEIVE_MESSAGE":
                            sender = message.get("sender")
                            encrypted_content = message.get("message")

                            encrypted_bytes = eval(encrypted_content)

                            decrypted_message = crypto.decrypt_message(encrypted_bytes, self.private_key)
                            print(f"\n[New Message from {sender}]: {decrypted_message}")
                            print("Enter command: ", end="", flush=True) # Reprompt
                    except json.JSONDecodeError:
                        # Ignore lines that are not valid JSON
                        pass
        except (ConnectionResetError, ConnectionAbortedError):
            print("\n[Disconnected from server.]")
        except Exception as e:
            print(f"An error occurred while listening for messages: {e}")


    def register(self):
        """Register a new user."""
        username = input("Enter username: ")
        password = getpass.getpass("Enter password: ")

        private_key_path = self.get_private_key_path(username)
        if os.path.exists(private_key_path):
            print(f"A private key for user '{username}' already exists. Please login or delete the key file.")
            return

        private_key, public_key = crypto.generate_keys()
        public_key_pem = crypto.serialize_public_key(public_key).decode('utf-8')

        with open(private_key_path, "wb") as f:
            f.write(crypto.serialize_private_key(private_key))

        print(f"Private key saved to {private_key_path}. Keep it safe!")

        request = {
            "command": "REGISTER",
            "username": username,
            "password": password,
            "public_key": public_key_pem
        }
        response = self._send_request(request)
        print(f"[SERVER] {response.get('message')}")

    def login(self):
        """Login to the server."""
        username = input("Enter username: ")
        password = getpass.getpass("Enter password: ")

        private_key_path = self.get_private_key_path(username)
        try:
            with open(private_key_path, "rb") as f:
                self.private_key = crypto.load_private_key(f.read())
        except FileNotFoundError:
            print(f"Error: Private key for '{username}' not found. Have you registered?")
            return

        self.username = username
        request = {"command": "LOGIN", "username": self.username, "password": password}
        response = self._send_request(request)
        print(f"[SERVER] {response.get('message')}")

        if response.get("status") == "success":
            listener_thread = threading.Thread(target=self.listen_for_messages, daemon=True)
            listener_thread.start()
            self.post_login_menu()
        else:
            self.username = None
            self.private_key = None

    def post_login_menu(self):
        """Menu for logged-in users."""
        while True:
            print("\n1. List Users\n2. Send Message\n3. Show History\n4. Logout")
            choice = input("Enter command: ")
            if choice == '1':
                self.get_users()
            elif choice == '2':
                self.send_message()
            elif choice == '3':
                self.get_history()
            elif choice == '4':
                break
            else:
                print("Invalid command.")

    def get_users(self):
        """Get a list of all users."""
        request = {"command": "GET_USERS"}
        response = self._send_request(request)
        if response.get("status") == "success":
            print("\n[Available Users]:")
            for user in response.get("users", {}):
                print(f"- {user}")
        else:
            print(f"[SERVER] {response.get('message')}")

    def send_message(self):
        """Send an encrypted message to a user."""
        recipient = input("Enter recipient's username: ")
        message = input("Enter message: ")

        users_response = self._send_request({"command": "GET_USERS"})
        if users_response.get("status") != "success":
            print("[SERVER] Could not fetch users.")
            return

        users = users_response.get("users")
        if recipient not in users:
            print(f"User '{recipient}' not found.")
            return

        public_key_pem = users[recipient]
        public_key = crypto.load_public_key(public_key_pem.encode('utf-8'))

        encrypted_message = crypto.encrypt_message(message, public_key)

        request = {
            "command": "SEND_MESSAGE",
            "recipient": recipient,
            "message": str(encrypted_message)
        }
        response = self._send_request(request)
        print(f"[SERVER] {response.get('message')}")


    def get_history(self):
        """Get and display chat history."""
        request = {"command": "GET_HISTORY"}
        response = self._send_request(request)
        if response.get("status") == "success":
            print("\n[Chat History]:")
            history = response.get("history", [])
            if not history:
                print("No messages yet.")
            for msg in history:
                sender = msg['sender']
                recipient = msg['recipient']
                encrypted_content = msg['message']

                encrypted_bytes = eval(encrypted_content)

                try:
                    # Only try to decrypt if we are the recipient
                    if recipient == self.username:
                        decrypted_message = crypto.decrypt_message(encrypted_bytes, self.private_key)
                        print(f"{sender} to you: {decrypted_message}")
                    else: # We are the sender
                        print(f"You to {recipient}: [Message sent - cannot decrypt]")

                except Exception as e:
                    print(f"From {sender} to {recipient}: [Could not decrypt message: {e}]")
        else:
            print(f"[SERVER] {response.get('message')}")


    def start(self):
        """Start the client and connect to the server."""
        try:
            self.sock.connect((HOST, PORT))
            print(f"Connected to server at {HOST}:{PORT}")
        except ConnectionRefusedError:
            print("Connection refused. Is the server running?")
            return

        while True:
            print("\n1. Register\n2. Login\n3. Quit")
            choice = input("Enter command: ")
            if choice == '1':
                self.register()
            elif choice == '2':
                self.login()
            elif choice == '3':
                break
            else:
                print("Invalid command.")

        self.sock.close()
        print("Disconnected.")


def main():
    client = ChatClient()
    client.start()

if __name__ == "__main__":
    main()
