"""
Ocarina Tab Sheet - Flask blueprint.
Library + editor for ABC-notation ocarina tabs, with a reader/creator
mode split and MySQL persistence. PDF export happens client-side
(captures the rendered staff+glyphs directly) - see static/js/script.js.
"""

import os
import hmac
from contextlib import contextmanager
from datetime import datetime, timezone
from urllib.parse import unquote

import mysql.connector
from dotenv import load_dotenv
from flask import Blueprint, render_template, request, jsonify, session

load_dotenv()

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


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

@contextmanager
def get_db(dictionary=True):
    """Context manager yielding (conn, cursor). Commits on success,
    rolls back on any exception, always closes the cursor/connection."""
    conn = mysql.connector.connect(
        host=os.getenv("DB_HOST"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        database=os.getenv("DB_NAME"),
    )
    cursor = conn.cursor(dictionary=dictionary)
    try:
        yield conn, cursor
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()


def init_db():
    with get_db() as (conn, cursor):
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS songs (
                id            INT AUTO_INCREMENT PRIMARY KEY,
                title         VARCHAR(255) UNIQUE NOT NULL,
                raw_abc       MEDIUMTEXT NOT NULL,
                created_at    DATETIME NOT NULL,
                updated_at    DATETIME NOT NULL
            )
        ''')
        cursor.execute('SELECT COUNT(*) AS n FROM songs')
        count = cursor.fetchone()['n']
        if count == 0:
            now = datetime.now(timezone.utc)
            default_abc = "C D E F G A B c\nc B A G F E D C\n"
            cursor.execute(
                'INSERT INTO songs (title, raw_abc, created_at, updated_at) '
                'VALUES (%s, %s, %s, %s)',
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
    with get_db() as (conn, cursor):
        cursor.execute(
            'SELECT id, title, raw_abc, created_at, updated_at '
            'FROM songs ORDER BY updated_at DESC'
        )
        songs = cursor.fetchall()
    return render_template('index.html', mode='library', songs=songs,
                            creator_mode=_is_creator_mode(),
                            password_required=bool(os.getenv("ADMIN_PASSWORD")))


@ocarina_bp.route('/sheet/<path:title>')
def sheet(title):
    decoded = unquote(title)
    create_new = request.args.get('action') == 'new'

    if create_new and not _is_creator_mode():
        return 'Creator mode required to create songs', 403

    with get_db() as (conn, cursor):
        cursor.execute('SELECT * FROM songs WHERE title = %s', (decoded,))
        row = cursor.fetchone()
        if row is None:
            if not create_new:
                return 'Song not found', 404
            now = datetime.now(timezone.utc)
            cursor.execute(
                'INSERT INTO songs (title, raw_abc, created_at, updated_at) '
                'VALUES (%s, %s, %s, %s)',
                (decoded, "", now, now)
            )
            cursor.execute('SELECT * FROM songs WHERE id = %s', (cursor.lastrowid,))
            row = cursor.fetchone()

    return render_template('index.html', mode='sheet', song=row,
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
    if not _is_creator_mode():
        return jsonify(error='Creator mode required'), 403
    data = request.get_json(force=True)
    title = (data.get('title') or '').strip()
    raw_abc = data.get('raw_abc', '')
    song_id = data.get('id')

    if not title:
        return jsonify(error='Title is required'), 400

    now = datetime.now(timezone.utc)

    with get_db() as (conn, cursor):
        if song_id is None:
            cursor.execute('SELECT id FROM songs WHERE title = %s', (title,))
            if cursor.fetchone():
                return jsonify(error='Title already exists'), 409
            cursor.execute(
                'INSERT INTO songs (title, raw_abc, created_at, updated_at) '
                'VALUES (%s, %s, %s, %s)',
                (title, raw_abc, now, now)
            )
            return jsonify(id=cursor.lastrowid, title=title), 200

        cursor.execute('SELECT id FROM songs WHERE id = %s', (song_id,))
        if not cursor.fetchone():
            return jsonify(error='Song not found'), 404

        cursor.execute(
            'SELECT id FROM songs WHERE title = %s AND id != %s', (title, song_id)
        )
        if cursor.fetchone():
            return jsonify(error='Title already exists'), 409

        cursor.execute(
            'UPDATE songs SET title=%s, raw_abc=%s, updated_at=%s WHERE id=%s',
            (title, raw_abc, now, song_id)
        )
        return jsonify(id=song_id, title=title), 200


@ocarina_bp.route('/api/sheet/<path:title>', methods=['DELETE'])
def delete_song(title):
    if not _is_creator_mode():
        return jsonify(error='Creator mode required'), 403
    decoded = unquote(title)
    with get_db() as (conn, cursor):
        cursor.execute('SELECT id FROM songs WHERE title = %s', (decoded,))
        if not cursor.fetchone():
            return jsonify(success=False, error='Not found'), 404
        cursor.execute('DELETE FROM songs WHERE title = %s', (decoded,))
    return jsonify(success=True), 200
