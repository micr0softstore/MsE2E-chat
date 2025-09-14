import socket
import threading
import json
import storage

HOST = '127.0.0.1'
PORT = 65432

clients = {} # To store client connections, mapping username to socket

def handle_client(conn, addr):
    print(f"[NEW CONNECTION] {addr} connected.")
    logged_in_user = None

    try:
        while True:
            data = conn.recv(4096).decode('utf-8')
            if not data:
                break

            # Process each JSON object received
            for line in data.strip().split('\n'):
                try:
                    request = json.loads(line)
                    command = request.get("command")

                    response = {}

                    if command == "REGISTER":
                        username = request.get("username")
                        password = request.get("password")
                        public_key = request.get("public_key")
                        if storage.add_user(username, password, public_key):
                            response = {"status": "success", "message": "User registered successfully."}
                        else:
                            response = {"status": "error", "message": "Username already exists."}

                    elif command == "LOGIN":
                        username = request.get("username")
                        password = request.get("password")
                        if storage.verify_password(username, password):
                            logged_in_user = username
                            clients[logged_in_user] = conn
                            response = {"status": "success", "message": "Login successful."}
                        else:
                            response = {"status": "error", "message": "Invalid credentials."}

                    # The following commands require the user to be logged in
                    elif logged_in_user:
                        if command == "GET_USERS":
                            users = storage.get_all_users()
                            response = {"status": "success", "users": users}

                        elif command == "SEND_MESSAGE":
                            recipient = request.get("recipient")
                            message_content = request.get("message")

                            # The message is already encrypted by the client
                            storage.add_message(logged_in_user, recipient, message_content)

                            # If the recipient is online, forward the message
                            if recipient in clients:
                                forward_message = {
                                    "command": "RECEIVE_MESSAGE",
                                    "sender": logged_in_user,
                                    "message": message_content
                                }
                                clients[recipient].sendall((json.dumps(forward_message) + '\n').encode('utf-8'))

                            response = {"status": "success", "message": "Message sent."}

                        elif command == "GET_HISTORY":
                            messages = storage.get_messages_for_user(logged_in_user)
                            response = {"status": "success", "history": messages}

                        else:
                            response = {"status": "error", "message": "Unknown command or not logged in."}

                    else:
                         response = {"status": "error", "message": "You must be logged in to perform this action."}


                    conn.sendall((json.dumps(response) + '\n').encode('utf-8'))

                except json.JSONDecodeError:
                    error_response = {"status": "error", "message": "Invalid JSON format."}
                    conn.sendall((json.dumps(error_response) + '\n').encode('utf-8'))
                except Exception as e:
                    print(f"[ERROR] {e}")
                    error_response = {"status": "error", "message": str(e)}
                    conn.sendall((json.dumps(error_response) + '\n').encode('utf-8'))


    except ConnectionResetError:
        print(f"[CONNECTION LOST] {addr} disconnected.")
    except Exception as e:
        print(f"[ERROR] An error occurred with {addr}: {e}")
    finally:
        if logged_in_user and logged_in_user in clients:
            del clients[logged_in_user]
        conn.close()
        print(f"[DISCONNECTED] {addr} disconnected.")


def main():
    storage.init_storage()
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.bind((HOST, PORT))
    server.listen()
    print(f"[LISTENING] Server is listening on {HOST}:{PORT}")

    try:
        while True:
            conn, addr = server.accept()
            thread = threading.Thread(target=handle_client, args=(conn, addr))
            thread.start()
    except KeyboardInterrupt:
        print("\n[SHUTTING DOWN] Server is shutting down.")
    finally:
        server.close()


if __name__ == "__main__":
    main()
