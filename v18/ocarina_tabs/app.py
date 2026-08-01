import os
import sqlite3
import hmac
from contextlib import contextmanager
from datetime import datetime, timezone
from urllib.parse import unquote

from flask import Blueprint, render_template, request, jsonify, session

# ---------------------------------------------------------------------------
# Blueprint + paths
# ---------------------------------------------------------------------------

ocarina_bp = Blueprint(
    'ocarina',
    __name__,
    template_folder='templates',
    static_folder='static',
    static_url_path='/static',
)

MODULE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(MODULE_DIR, 'songs.db')


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    with get_db() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS songs (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                title         TEXT    UNIQUE NOT NULL,
                raw_abc       TEXT    NOT NULL,
                created_at    TEXT    NOT NULL,
                updated_at    TEXT    NOT NULL
            )
        ''')
        count = conn.execute('SELECT COUNT(*) AS n FROM songs').fetchone()['n']
        if count == 0:
            now = datetime.now(timezone.utc).isoformat()
            default_abc = "C D E F G A B c\nc B A G F E D C\n"
            conn.execute(
                'INSERT INTO songs (title, raw_abc, created_at, updated_at) '
                'VALUES (?, ?, ?, ?)',
                ("Ocarina Warm-Up", default_abc, now, now)
            )


init_db()


def _is_creator_mode():
    return bool(session.get('ocarina_creator_mode', False))


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------

@ocarina_bp.route('/')
def index():
    with get_db() as conn:
        rows = conn.execute(
            'SELECT id, title, raw_abc, created_at, updated_at '
            'FROM songs ORDER BY updated_at DESC'
        ).fetchall()
    songs = [dict(r) for r in rows]
    return render_template('index.html', mode='library', songs=songs,
                            creator_mode=_is_creator_mode(),
                            password_required=bool(os.getenv("ADMIN_PASSWORD")))


@ocarina_bp.route('/sheet/<path:title>')
def sheet(title):
    decoded = unquote(title)
    create_new = request.args.get('action') == 'new'

    with get_db() as conn:
        row = conn.execute('SELECT * FROM songs WHERE title = ?', (decoded,)).fetchone()
        if row is None:
            if not create_new:
                return 'Song not found', 404
            now = datetime.now(timezone.utc).isoformat()
            cur = conn.execute(
                'INSERT INTO songs (title, raw_abc, created_at, updated_at) '
                'VALUES (?, ?, ?, ?)',
                (decoded, "", now, now)
            )
            row = conn.execute('SELECT * FROM songs WHERE id = ?', (cur.lastrowid,)).fetchone()

    return render_template('index.html', mode='sheet', song=dict(row),
                            creator_mode=_is_creator_mode(),
                            password_required=bool(os.getenv("ADMIN_PASSWORD")))


# ---------------------------------------------------------------------------
# API - creator mode
# ---------------------------------------------------------------------------

@ocarina_bp.route('/api/creator-mode', methods=['GET'])
def creator_mode_status():
    return jsonify({'creator_mode': _is_creator_mode()})


@ocarina_bp.route('/api/creator-mode', methods=['POST'])
def enable_creator_mode():
    data = request.get_json(silent=True) or {}
    password = str(data.get('password', ''))

    admin_password = os.getenv("ADMIN_PASSWORD")
    if admin_password:
        if not hmac.compare_digest(password, admin_password):
            return jsonify({'error': 'Incorrect password'}), 403
    # No ADMIN_PASSWORD configured -> nothing to gate against, so this is
    # a local/dev instance: let creator mode toggle on freely.

    session['ocarina_creator_mode'] = True
    return jsonify({'success': True, 'creator_mode': True})


@ocarina_bp.route('/api/creator-mode', methods=['DELETE'])
def disable_creator_mode():
    session.pop('ocarina_creator_mode', None)
    return jsonify({'success': True, 'creator_mode': False})


# ---------------------------------------------------------------------------
# API - songs
# ---------------------------------------------------------------------------

@ocarina_bp.route('/api/sheet/save', methods=['POST'])
def save_song():
    data = request.get_json(force=True)
    title = (data.get('title') or '').strip()
    raw_abc = data.get('raw_abc', '')
    song_id = data.get('id')

    if not title:
        return jsonify(error='Title is required'), 400

    now = datetime.now(timezone.utc).isoformat()

    with get_db() as conn:
        if song_id is None:
            exists = conn.execute('SELECT id FROM songs WHERE title = ?', (title,)).fetchone()
            if exists:
                return jsonify(error='Title already exists'), 409
            cur = conn.execute(
                'INSERT INTO songs (title, raw_abc, created_at, updated_at) '
                'VALUES (?, ?, ?, ?)',
                (title, raw_abc, now, now)
            )
            return jsonify(id=cur.lastrowid, title=title), 200

        existing = conn.execute('SELECT id FROM songs WHERE id = ?', (song_id,)).fetchone()
        if not existing:
            return jsonify(error='Song not found'), 404

        conflict = conn.execute(
            'SELECT id FROM songs WHERE title = ? AND id != ?', (title, song_id)
        ).fetchone()
        if conflict:
            return jsonify(error='Title already exists'), 409

        conn.execute(
            'UPDATE songs SET title=?, raw_abc=?, updated_at=? WHERE id=?',
            (title, raw_abc, now, song_id)
        )
        return jsonify(id=song_id, title=title), 200


@ocarina_bp.route('/api/sheet/<path:title>', methods=['DELETE'])
def delete_song(title):
    decoded = unquote(title)
    with get_db() as conn:
        row = conn.execute('SELECT id FROM songs WHERE title = ?', (decoded,)).fetchone()
        if not row:
            return jsonify(success=False, error='Not found'), 404
        conn.execute('DELETE FROM songs WHERE title = ?', (decoded,))
    return jsonify(success=True), 200
