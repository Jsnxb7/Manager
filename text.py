import secrets
import hashlib
import base64
import urllib.parse

CLIENT_ID = "d84333da14a9a43118d3d484b8625b9a"
REDIRECT_URI = "http://localhost:5000/callback"

# 1. Generate code_verifier
code_verifier = secrets.token_urlsafe(64)

# 2. Generate code_challenge (S256)
code_challenge = base64.urlsafe_b64encode(
    hashlib.sha256(code_verifier.encode()).digest()
).decode().rstrip("=")

state = secrets.token_hex(16)

params = {
    "response_type": "code",
    "client_id": CLIENT_ID,
    "redirect_uri": REDIRECT_URI,
    "state": state,
    "code_challenge": code_challenge,
    "code_challenge_method": "S256",
}

auth_url = "https://myanimelist.net/v1/oauth2/authorize?" + urllib.parse.urlencode(params)

print("Open this URL in browser:")
print(auth_url)

# IMPORTANT: Save this securely (you will need it later)
print("CODE_VERIFIER (save this):", code_verifier)
