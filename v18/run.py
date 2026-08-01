import os
from flask import Flask
from ocarina_tabs import ocarina_bp

app = Flask(__name__, static_folder=None)
app.secret_key = os.getenv("SECRET_KEY", "dev-secret-change-me")
app.register_blueprint(ocarina_bp)

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
