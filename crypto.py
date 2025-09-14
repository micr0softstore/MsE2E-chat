# Cryptography functions will go here.
# I will use the 'cryptography' library.
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import serialization, hashes

def generate_keys():
    """Generate RSA private and public keys."""
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )
    public_key = private_key.public_key()
    return private_key, public_key

def serialize_public_key(public_key):
    """Serialize a public key to PEM format."""
    return public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo
    )

def serialize_private_key(private_key):
    """Serialize a private key to PEM format."""
    return private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()
    )

def load_public_key(public_key_bytes):
    """Load a public key from PEM format."""
    return serialization.load_pem_public_key(public_key_bytes)

def load_private_key(private_key_bytes):
    """Load a private key from PEM format."""
    return serialization.load_pem_private_key(private_key_bytes, password=None)

def encrypt_message(message, public_key):
    """Encrypt a message using a public key."""
    return public_key.encrypt(
        message.encode('utf-8'),
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None
        )
    )

def decrypt_message(encrypted_message, private_key):
    """Decrypt a message using a private key."""
    return private_key.decrypt(
        encrypted_message,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None
        )
    ).decode('utf-8')
